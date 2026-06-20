-- Controle de acesso, permissoes, assinatura e liberacao emergencial.
-- Rode este arquivo no SQL Editor do Supabase depois das migracoes anteriores.

create extension if not exists "pgcrypto";

do $$
begin
  alter table public.profiles drop constraint if exists profiles_role_check;
  alter table public.profiles add constraint profiles_role_check
    check (role in ('gestor', 'loja', 'motoqueiro', 'admin_master', 'lojista', 'colaborador_lojista'));
exception
  when duplicate_object then null;
end $$;

alter table public.profiles
  add column if not exists store_id uuid references public.shops(id) on delete set null,
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists emergency_access_until timestamptz,
  add column if not exists blocked_at timestamptz;

alter table public.shops
  add column if not exists trial_start_date date,
  add column if not exists trial_end_date date,
  add column if not exists subscription_status text not null default 'trial',
  add column if not exists monthly_price numeric(10,2) not null default 0,
  add column if not exists due_date date,
  add column if not exists subscription_blocked_at timestamptz;

do $$
begin
  alter table public.shops drop constraint if exists shops_subscription_status_check;
  alter table public.shops add constraint shops_subscription_status_check
    check (subscription_status in ('trial', 'active', 'overdue', 'blocked'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.emergency_access_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  target_user_id uuid references public.profiles(id) on delete cascade,
  target_store_id uuid references public.shops(id) on delete cascade,
  valid_until timestamptz not null,
  used_at timestamptz,
  expires_after_use_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint emergency_access_codes_target_check check (
    target_user_id is not null or target_store_id is not null
  )
);

create table if not exists public.shop_payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  amount numeric(10,2) not null default 0,
  paid_at timestamptz not null default now(),
  reference_month date,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_store_id on public.profiles(store_id);
create index if not exists idx_profiles_role_store on public.profiles(role, store_id);
create index if not exists idx_emergency_codes_code on public.emergency_access_codes(code);
create index if not exists idx_shop_payments_shop_paid_at on public.shop_payments(shop_id, paid_at desc);

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid() limit 1;
$$;

create or replace function public.current_profile_store_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select store_id from public.profiles where user_id = auth.uid() limit 1;
$$;

create or replace function public.current_profile_is_admin_master()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() in ('gestor', 'admin_master'), false);
$$;

create or replace function public.current_profile_has_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and (
        role in ('gestor', 'admin_master', 'loja', 'lojista')
        or coalesce((permissions ->> permission_name)::boolean, false)
      )
  );
$$;

create or replace function public.has_emergency_access_for_current_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and emergency_access_until is not null
      and emergency_access_until > now()
  );
$$;

create or replace function public.business_days_between(start_date date, end_date date)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from generate_series(start_date, end_date, interval '1 day') day
  where extract(isodow from day) between 1 and 5;
$$;

create or replace function public.refresh_shop_subscription_status(shop_id_input uuid)
returns public.shops
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_record public.shops;
  overdue_start date;
begin
  select * into shop_record
  from public.shops
  where id = shop_id_input
  for update;

  if not found then
    raise exception 'Loja nao encontrada.';
  end if;

  if shop_record.subscription_status = 'blocked' then
    return shop_record;
  end if;

  if shop_record.subscription_status = 'trial'
    and shop_record.trial_end_date is not null
    and shop_record.trial_end_date < current_date then
    update public.shops
      set subscription_status = 'overdue'
    where id = shop_id_input
    returning * into shop_record;
  end if;

  if shop_record.subscription_status = 'active'
    and shop_record.due_date is not null
    and shop_record.due_date < current_date then
    update public.shops
      set subscription_status = 'overdue'
    where id = shop_id_input
    returning * into shop_record;
  end if;

  if shop_record.subscription_status = 'overdue' then
    overdue_start := coalesce(shop_record.due_date, shop_record.trial_end_date, current_date);
    if public.business_days_between(overdue_start + 1, current_date) > 3 then
      update public.shops
        set subscription_status = 'blocked',
            subscription_blocked_at = coalesce(subscription_blocked_at, now())
      where id = shop_id_input
      returning * into shop_record;
    end if;
  end if;

  return shop_record;
end;
$$;

create or replace function public.refresh_all_shop_subscription_statuses()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_record record;
begin
  for shop_record in select id from public.shops loop
    perform public.refresh_shop_subscription_status(shop_record.id);
  end loop;
end;
$$;

create or replace function public.use_emergency_access_code(code_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code_record public.emergency_access_codes;
  current_profile public.profiles;
  access_until timestamptz := now() + interval '24 hours';
begin
  select * into current_profile
  from public.profiles
  where user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Perfil nao encontrado.';
  end if;

  select * into code_record
  from public.emergency_access_codes
  where code = trim(code_input)
  for update;

  if not found then
    raise exception 'Senha emergencial invalida.';
  end if;

  if code_record.used_at is not null then
    raise exception 'Senha emergencial ja utilizada.';
  end if;

  if code_record.valid_until <= now() then
    raise exception 'Senha emergencial expirada.';
  end if;

  if code_record.target_user_id is not null and code_record.target_user_id <> current_profile.id then
    raise exception 'Senha emergencial nao pertence a este usuario.';
  end if;

  if code_record.target_store_id is not null
    and current_profile.store_id <> code_record.target_store_id
    and current_profile.id not in (select created_by from public.shops where id = code_record.target_store_id) then
    raise exception 'Senha emergencial nao pertence a esta loja.';
  end if;

  update public.emergency_access_codes
    set used_at = now(),
        expires_after_use_at = access_until
    where id = code_record.id;

  if code_record.target_user_id is not null then
    update public.profiles
      set emergency_access_until = access_until
      where id = code_record.target_user_id;
  end if;

  if code_record.target_store_id is not null then
    update public.profiles
      set emergency_access_until = access_until
      where store_id = code_record.target_store_id
        or id in (select created_by from public.shops where id = code_record.target_store_id);
  end if;

  return jsonb_build_object('ok', true, 'valid_until', access_until);
end;
$$;

alter table public.emergency_access_codes enable row level security;
alter table public.shop_payments enable row level security;

drop policy if exists profiles_select_own_or_manager on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_select_access_control on public.profiles;
drop policy if exists profiles_insert_access_control on public.profiles;
drop policy if exists profiles_update_access_control on public.profiles;

create policy profiles_select_access_control on public.profiles
for select using (
  user_id = auth.uid()
  or public.current_profile_is_admin_master()
  or (
    public.current_profile_store_id() is not null
    and store_id = public.current_profile_store_id()
  )
);

create policy profiles_insert_access_control on public.profiles
for insert with check (
  user_id = auth.uid()
  or public.current_profile_is_admin_master()
  or (
    public.current_profile_role() in ('loja', 'lojista')
    and store_id = public.current_profile_store_id()
    and role = 'colaborador_lojista'
  )
);

create policy profiles_update_access_control on public.profiles
for update using (
  user_id = auth.uid()
  or public.current_profile_is_admin_master()
  or (
    public.current_profile_has_permission('cadastrar_colaboradores')
    and store_id = public.current_profile_store_id()
    and role = 'colaborador_lojista'
  )
) with check (
  user_id = auth.uid()
  or public.current_profile_is_admin_master()
  or (
    public.current_profile_has_permission('cadastrar_colaboradores')
    and store_id = public.current_profile_store_id()
    and role = 'colaborador_lojista'
  )
);

drop policy if exists shops_select_authenticated on public.shops;
drop policy if exists shops_insert_manager on public.shops;
drop policy if exists shops_update_manager_owner on public.shops;
drop policy if exists shops_select_access_control on public.shops;
drop policy if exists shops_insert_access_control on public.shops;
drop policy if exists shops_update_access_control on public.shops;

create policy shops_select_access_control on public.shops
for select using (
  public.current_profile_is_admin_master()
  or id = public.current_profile_store_id()
  or created_by = public.current_profile_id()
);

create policy shops_insert_access_control on public.shops
for insert with check (
  public.current_profile_is_admin_master()
  or (
    public.current_profile_role() in ('loja', 'lojista')
    and public.current_profile_id() = created_by
  )
);

create policy shops_update_access_control on public.shops
for update using (
  public.current_profile_is_admin_master()
  or created_by = public.current_profile_id()
) with check (
  public.current_profile_is_admin_master()
  or created_by = public.current_profile_id()
);

drop policy if exists deliveries_select_manager_shop_or_driver on public.deliveries;
drop policy if exists deliveries_insert_manager on public.deliveries;
drop policy if exists deliveries_update_manager_or_assigned_driver on public.deliveries;
drop policy if exists deliveries_select_access_control on public.deliveries;
drop policy if exists deliveries_insert_access_control on public.deliveries;
drop policy if exists deliveries_update_access_control on public.deliveries;

create policy deliveries_select_access_control on public.deliveries
for select using (
  public.current_profile_is_admin_master()
  or shop_id = public.current_profile_store_id()
  or exists (
    select 1 from public.motorcyclists m
    where m.id = deliveries.motorcyclist_id
      and m.profile_id = public.current_profile_id()
  )
);

create policy deliveries_insert_access_control on public.deliveries
for insert with check (
  public.current_profile_is_admin_master()
  or (
    shop_id = public.current_profile_store_id()
    and public.current_profile_has_permission('criar_pedidos')
  )
);

create policy deliveries_update_access_control on public.deliveries
for update using (
  public.current_profile_is_admin_master()
  or (
    shop_id = public.current_profile_store_id()
    and (
      public.current_profile_has_permission('editar_pedidos')
      or public.current_profile_has_permission('cancelar_pedidos')
      or public.current_profile_has_permission('chamar_motoqueiro')
    )
  )
  or exists (
    select 1 from public.motorcyclists m
    where m.id = deliveries.motorcyclist_id
      and m.profile_id = public.current_profile_id()
  )
) with check (
  public.current_profile_is_admin_master()
  or shop_id = public.current_profile_store_id()
  or exists (
    select 1 from public.motorcyclists m
    where m.id = deliveries.motorcyclist_id
      and m.profile_id = public.current_profile_id()
  )
);

drop policy if exists emergency_access_codes_select_access_control on public.emergency_access_codes;
drop policy if exists emergency_access_codes_insert_admin on public.emergency_access_codes;

create policy emergency_access_codes_select_access_control on public.emergency_access_codes
for select using (
  public.current_profile_is_admin_master()
  or target_user_id = public.current_profile_id()
  or target_store_id = public.current_profile_store_id()
);

create policy emergency_access_codes_insert_admin on public.emergency_access_codes
for insert with check (public.current_profile_is_admin_master());

drop policy if exists shop_payments_select_access_control on public.shop_payments;
drop policy if exists shop_payments_insert_admin on public.shop_payments;

create policy shop_payments_select_access_control on public.shop_payments
for select using (
  public.current_profile_is_admin_master()
  or shop_id = public.current_profile_store_id()
);

create policy shop_payments_insert_admin on public.shop_payments
for insert with check (public.current_profile_is_admin_master());

create or replace function public.current_profile_can_access_shop(shop_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_profile_is_admin_master()
    or exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and (
          p.store_id = shop_id_input
          or p.id in (select created_by from public.shops where id = shop_id_input)
        )
    ),
    false
  );
$$;

create or replace function public.create_delivery_and_assign(
  shop_id_input uuid,
  origin_address_input text,
  destination_address_input text,
  destination_zipcode_input text default null,
  destination_number_input text default null,
  destination_complement_input text default null,
  destination_neighborhood_input text default null,
  destination_city_input text default null,
  destination_state_input text default null,
  destination_latitude_input double precision default null,
  destination_longitude_input double precision default null,
  customer_name_input text default null,
  customer_phone_input text default null,
  assigned_motorcyclist_id_input uuid default null
)
returns public.deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record public.profiles;
  selected_rider_id uuid;
  delivery public.deliveries;
begin
  select * into profile_record
  from public.profiles
  where user_id = auth.uid();

  if profile_record.id is null then
    raise exception 'Perfil nao encontrado.';
  end if;

  if not public.current_profile_has_permission('criar_pedidos') then
    raise exception 'Usuario sem permissao para criar entregas.';
  end if;

  if not public.current_profile_can_access_shop(shop_id_input) then
    raise exception 'Usuario sem acesso a esta loja.';
  end if;

  if not exists (select 1 from public.shops where id = shop_id_input and active = true) then
    raise exception 'Loja invalida ou inativa.';
  end if;

  if assigned_motorcyclist_id_input is not null then
    if not public.current_profile_has_permission('chamar_motoqueiro') then
      raise exception 'Usuario sem permissao para chamar motoqueiro.';
    end if;

    select id into selected_rider_id
    from public.motorcyclists
    where id = assigned_motorcyclist_id_input
      and current_shop_id = shop_id_input
      and is_online = true
    for update skip locked;

    if selected_rider_id is null then
      raise exception 'Motoqueiro escolhido nao esta online nesta loja.';
    end if;
  else
    select id into selected_rider_id
    from public.motorcyclists
    where current_shop_id = shop_id_input
      and is_online = true
      and available = true
    order by last_assigned_at asc nulls first, created_at asc
    for update skip locked
    limit 1;
  end if;

  if selected_rider_id is not null then
    update public.motorcyclists
    set available = false,
        last_assigned_at = now()
    where id = selected_rider_id;
  end if;

  insert into public.deliveries (
    shop_id,
    motorcyclist_id,
    origin_address,
    destination_address,
    destination_zipcode,
    destination_number,
    destination_complement,
    destination_neighborhood,
    destination_city,
    destination_state,
    destination_latitude,
    destination_longitude,
    customer_name,
    customer_phone,
    status,
    assigned_at,
    created_by
  )
  values (
    shop_id_input,
    selected_rider_id,
    origin_address_input,
    destination_address_input,
    regexp_replace(coalesce(destination_zipcode_input, ''), '\D', '', 'g'),
    destination_number_input,
    destination_complement_input,
    destination_neighborhood_input,
    destination_city_input,
    upper(destination_state_input),
    destination_latitude_input,
    destination_longitude_input,
    customer_name_input,
    customer_phone_input,
    case when selected_rider_id is null then 'pending' else 'assigned' end,
    case when selected_rider_id is null then null else now() end,
    profile_record.id
  )
  returning * into delivery;

  return delivery;
end;
$$;

create or replace function public.reassign_delivery_motorcyclist(
  delivery_id_input uuid,
  motorcyclist_id_input uuid
)
returns public.deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record public.profiles;
  delivery_record public.deliveries;
  selected_rider_id uuid;
  previous_rider_id uuid;
  updated_delivery public.deliveries;
begin
  select * into profile_record
  from public.profiles
  where user_id = auth.uid();

  if profile_record.id is null then
    raise exception 'Perfil nao encontrado.';
  end if;

  if not public.current_profile_has_permission('chamar_motoqueiro') then
    raise exception 'Usuario sem permissao para trocar o motoqueiro da entrega.';
  end if;

  select * into delivery_record
  from public.deliveries
  where id = delivery_id_input
    and status in ('pending', 'assigned', 'accepted')
  for update;

  if delivery_record.id is null then
    raise exception 'Entrega nao encontrada ou ja saiu para entrega.';
  end if;

  if not public.current_profile_can_access_shop(delivery_record.shop_id) then
    raise exception 'Usuario sem acesso a esta loja.';
  end if;

  select id into selected_rider_id
  from public.motorcyclists
  where id = motorcyclist_id_input
    and current_shop_id = delivery_record.shop_id
    and is_online = true
  for update skip locked;

  if selected_rider_id is null then
    raise exception 'Motoqueiro escolhido nao esta online nesta loja.';
  end if;

  previous_rider_id := delivery_record.motorcyclist_id;

  if previous_rider_id is not null and previous_rider_id <> selected_rider_id then
    update public.motorcyclists m
    set available = m.is_online and not exists (
      select 1 from public.deliveries d
      where d.motorcyclist_id = m.id
        and d.id <> delivery_id_input
        and d.status in ('assigned', 'accepted', 'out_for_delivery')
    )
    where m.id = previous_rider_id;
  end if;

  update public.motorcyclists
  set available = false,
      last_assigned_at = now()
  where id = selected_rider_id;

  update public.deliveries
  set motorcyclist_id = selected_rider_id,
      status = 'assigned',
      assigned_at = now(),
      accepted_at = null,
      rejected_at = null,
      departed_at = null,
      delivered_at = null,
      total_duration_seconds = null
  where id = delivery_id_input
  returning * into updated_delivery;

  return updated_delivery;
end;
$$;
