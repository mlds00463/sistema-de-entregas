-- Sistema real de entregas com Supabase Auth, RLS, fila de motoqueiros, QR Code e relatórios.
-- Rode este arquivo no SQL Editor do Supabase.

create extension if not exists "pgcrypto";

drop view if exists delivery_reports;
drop function if exists public.create_delivery_and_assign(uuid, text, text, text, text);
drop function if exists public.create_delivery_and_assign(uuid, text, text, text, text, text, text, text, text, text, text);
drop function if exists public.create_delivery_and_assign(uuid, text, text, text, text, text, text, text, text, text, text, uuid);
drop function if exists public.reassign_delivery_motorcyclist(uuid, uuid);
drop function if exists public.driver_check_in(uuid, text, double precision, double precision);
drop function if exists public.get_my_motorcyclist();
drop function if exists public.driver_set_online(boolean, double precision, double precision);
drop function if exists public.driver_update_location(double precision, double precision);
drop function if exists public.accept_delivery(uuid);
drop function if exists public.reject_delivery(uuid);
drop function if exists public.mark_delivery_departed(uuid);
drop function if exists public.mark_delivery_delivered(uuid);
drop function if exists public.create_driver_payout(uuid, uuid);
drop function if exists public.manager_update_motorcyclist(uuid, text, text, text, text, text);
drop function if exists public.update_driver_payout_payment(uuid, text, text, text, text);
drop function if exists public.current_profile_id();
drop function if exists public.current_profile_role();
drop function if exists public.touch_updated_at();
drop table if exists deliveries cascade;
drop table if exists driver_payouts cascade;
drop table if exists motorcyclists cascade;
drop table if exists shops cascade;
drop table if exists profiles cascade;

create table profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('gestor', 'loja', 'motoqueiro')),
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table shops (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references profiles(id) on delete restrict,
  name text not null,
  legal_name text,
  cnpj text,
  address text not null,
  number text,
  complement text,
  neighborhood text,
  city text not null,
  state text,
  zipcode text,
  contact_name text,
  contact_phone text,
  contact_email text,
  latitude double precision,
  longitude double precision,
  payout_amount_per_delivery numeric(10,2) not null default 0,
  minimum_guaranteed_deliveries integer not null default 10,
  qr_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shops_coordinates_valid check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create table motorcyclists (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  name text not null,
  document text,
  phone text,
  pix_key text,
  pix_key_type text,
  payout_name text,
  is_online boolean not null default false,
  available boolean not null default false,
  current_shop_id uuid references shops(id) on delete set null,
  latitude double precision,
  longitude double precision,
  last_seen timestamptz,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint motorcyclist_location_valid check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create table driver_payouts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete restrict,
  motorcyclist_id uuid not null references motorcyclists(id) on delete restrict,
  delivery_count integer not null default 0,
  guaranteed_deliveries integer not null default 10,
  covered_days integer not null default 1,
  paid_units integer not null default 0,
  amount_per_delivery numeric(10,2) not null default 0,
  amount_total numeric(10,2) not null default 0,
  pix_key text,
  pix_key_type text,
  recipient_name text not null,
  period_start timestamptz,
  period_end timestamptz not null default now(),
  paid_at timestamptz not null default now(),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'not_paid')),
  payment_confirmed_at timestamptz,
  payment_marked_by uuid references profiles(id) on delete set null,
  receipt_path text,
  receipt_file_name text,
  payment_note text,
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete restrict,
  motorcyclist_id uuid references motorcyclists(id) on delete set null,
  origin_address text not null,
  destination_address text not null,
  destination_zipcode text,
  destination_number text,
  destination_complement text,
  destination_neighborhood text,
  destination_city text,
  destination_state text,
  destination_latitude double precision,
  destination_longitude double precision,
  arrival_notified_at timestamptz,
  customer_name text,
  customer_phone text,
  status text not null default 'pending' check (
    status in ('pending','assigned','accepted','rejected','out_for_delivery','delivered','cancelled')
  ),
  assigned_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  departed_at timestamptz,
  delivered_at timestamptz,
  total_duration_seconds integer,
  driver_payout_id uuid references driver_payouts(id) on delete set null,
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table driver_location_points (
  id uuid primary key default gen_random_uuid(),
  motorcyclist_id uuid not null references motorcyclists(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  recorded_at timestamptz not null default now(),
  constraint driver_location_point_valid check (
    latitude between -90 and 90 and longitude between -180 and 180
  )
);

create index idx_profiles_user_id on profiles(user_id);
create index idx_shops_created_by on shops(created_by);
create unique index idx_shops_cnpj_unique on shops(cnpj) where cnpj is not null and cnpj <> '';
create index idx_motorcyclists_queue on motorcyclists(current_shop_id, is_online, available, last_assigned_at, created_at);
create index idx_driver_payouts_shop_driver_paid_at on driver_payouts(shop_id, motorcyclist_id, paid_at desc);
create index idx_deliveries_shop_status on deliveries(shop_id, status, created_at desc);
create index idx_deliveries_motorcyclist_status on deliveries(motorcyclist_id, status, created_at desc);
create index idx_deliveries_driver_payout on deliveries(driver_payout_id);
create index idx_driver_location_points_rider_time on driver_location_points(motorcyclist_id, recorded_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on profiles
for each row execute function public.touch_updated_at();
create trigger shops_touch_updated_at before update on shops
for each row execute function public.touch_updated_at();
create trigger motorcyclists_touch_updated_at before update on motorcyclists
for each row execute function public.touch_updated_at();
create trigger deliveries_touch_updated_at before update on deliveries
for each row execute function public.touch_updated_at();

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from profiles where user_id = auth.uid() limit 1;
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where user_id = auth.uid() limit 1;
$$;

alter table profiles enable row level security;
alter table shops enable row level security;
alter table motorcyclists enable row level security;
alter table driver_payouts enable row level security;
alter table deliveries enable row level security;
alter table driver_location_points enable row level security;

create policy profiles_select_own_or_manager on profiles
for select using (
  user_id = auth.uid()
  or public.current_profile_role() = 'gestor'
);

create policy profiles_insert_own on profiles
for insert with check (user_id = auth.uid());

create policy profiles_update_own on profiles
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy shops_select_authenticated on shops
for select using (auth.role() = 'authenticated' and active = true);

create policy shops_insert_manager on shops
for insert with check (
  public.current_profile_role() = 'gestor'
  and public.current_profile_id() = created_by
);

create policy shops_update_manager_owner on shops
for update using (
  public.current_profile_role() = 'gestor'
  and public.current_profile_id() = shops.created_by
) with check (
  public.current_profile_role() = 'gestor'
  and public.current_profile_id() = shops.created_by
);

create policy motorcyclists_select_authenticated on motorcyclists
for select using (auth.role() = 'authenticated');

create policy motorcyclists_insert_own on motorcyclists
for insert with check (
  public.current_profile_role() = 'motoqueiro'
  and public.current_profile_id() = motorcyclists.profile_id
);

create policy motorcyclists_update_own on motorcyclists
for update using (
  public.current_profile_role() = 'motoqueiro'
  and public.current_profile_id() = motorcyclists.profile_id
) with check (
  public.current_profile_role() = 'motoqueiro'
  and public.current_profile_id() = motorcyclists.profile_id
);

create policy driver_payouts_select_manager_or_driver on driver_payouts
for select using (
  public.current_profile_role() = 'gestor'
  or exists (
    select 1 from motorcyclists m
    where m.profile_id = public.current_profile_id()
      and m.id = driver_payouts.motorcyclist_id
  )
);

create policy driver_payouts_insert_manager on driver_payouts
for insert with check (
  public.current_profile_role() = 'gestor'
  and public.current_profile_id() = created_by
);

insert into storage.buckets (id, name, public)
values ('payout-receipts', 'payout-receipts', false)
on conflict (id) do update set public = false;

drop policy if exists payout_receipts_select_manager on storage.objects;
drop policy if exists payout_receipts_insert_manager on storage.objects;
drop policy if exists payout_receipts_update_manager on storage.objects;

create policy payout_receipts_select_manager on storage.objects
for select to authenticated using (
  bucket_id = 'payout-receipts'
  and public.current_profile_role() = 'gestor'
);

create policy payout_receipts_insert_manager on storage.objects
for insert to authenticated with check (
  bucket_id = 'payout-receipts'
  and public.current_profile_role() = 'gestor'
);

create policy payout_receipts_update_manager on storage.objects
for update to authenticated using (
  bucket_id = 'payout-receipts'
  and public.current_profile_role() = 'gestor'
) with check (
  bucket_id = 'payout-receipts'
  and public.current_profile_role() = 'gestor'
);

create policy deliveries_select_manager_shop_or_driver on deliveries
for select using (
  public.current_profile_role() = 'gestor'
  or exists (
    select 1 from motorcyclists m
    where m.profile_id = public.current_profile_id()
      and m.id = deliveries.motorcyclist_id
  )
);

create policy deliveries_insert_manager on deliveries
for insert with check (
  public.current_profile_role() = 'gestor'
  and public.current_profile_id() = created_by
);

create policy deliveries_update_manager_or_assigned_driver on deliveries
for update using (
  public.current_profile_role() = 'gestor'
  or exists (
    select 1 from motorcyclists m
    where m.profile_id = public.current_profile_id()
      and m.id = deliveries.motorcyclist_id
  )
) with check (
  public.current_profile_role() = 'gestor'
  or exists (
    select 1 from motorcyclists m
    where m.profile_id = public.current_profile_id()
      and m.id = deliveries.motorcyclist_id
  )
);

create policy driver_location_points_select_manager_or_own on driver_location_points
for select using (
  public.current_profile_role() = 'gestor'
  or exists (
    select 1 from motorcyclists m
    where m.profile_id = public.current_profile_id()
      and m.id = driver_location_points.motorcyclist_id
  )
);

create or replace function public.driver_check_in(
  shop_id_input uuid,
  qr_token_input text,
  latitude_input double precision,
  longitude_input double precision
)
returns motorcyclists
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record profiles;
  rider motorcyclists;
begin
  select * into profile_record from profiles where user_id = auth.uid() and role = 'motoqueiro';
  if profile_record.id is null then
    raise exception 'Perfil de motoqueiro não encontrado';
  end if;

  if not exists (
    select 1 from shops where id = shop_id_input and qr_token = qr_token_input and active = true
  ) then
    raise exception 'QR Code inválido ou loja inativa';
  end if;

  insert into motorcyclists (profile_id, name, phone)
  values (profile_record.id, profile_record.name, profile_record.phone)
  on conflict (profile_id) do nothing;

  update motorcyclists
  set is_online = true,
      available = true,
      current_shop_id = shop_id_input,
      latitude = latitude_input,
      longitude = longitude_input,
      last_seen = now()
  where profile_id = profile_record.id
  returning * into rider;

  return rider;
end;
$$;

create or replace function public.get_my_motorcyclist()
returns motorcyclists
language plpgsql
security definer
set search_path = public
as $$
declare
  rider motorcyclists;
begin
  select m.* into rider
  from motorcyclists m
  join profiles p on p.id = m.profile_id
  where p.user_id = auth.uid()
    and p.role = 'motoqueiro';

  return rider;
end;
$$;

create or replace function public.driver_set_online(
  online_input boolean,
  latitude_input double precision,
  longitude_input double precision
)
returns motorcyclists
language plpgsql
security definer
set search_path = public
as $$
declare
  rider motorcyclists;
begin
  update motorcyclists m
  set is_online = online_input,
      available = online_input and not exists (
        select 1 from deliveries d
        where d.motorcyclist_id = m.id
          and d.status in ('assigned','accepted','out_for_delivery')
      ),
      latitude = latitude_input,
      longitude = longitude_input,
      last_seen = now()
  where m.profile_id in (select p.id from profiles p where p.user_id = auth.uid() and p.role = 'motoqueiro')
  returning * into rider;

  if rider.id is null then
    raise exception 'Motoqueiro não encontrado';
  end if;

  insert into driver_location_points (motorcyclist_id, latitude, longitude)
  values (rider.id, latitude_input, longitude_input);

  return rider;
end;
$$;

create or replace function public.driver_update_location(
  latitude_input double precision,
  longitude_input double precision
)
returns motorcyclists
language plpgsql
security definer
set search_path = public
as $$
declare
  rider motorcyclists;
begin
  update motorcyclists
  set latitude = latitude_input,
      longitude = longitude_input,
      last_seen = now()
  where profile_id in (select p.id from profiles p where p.user_id = auth.uid() and p.role = 'motoqueiro')
  returning * into rider;

  if rider.id is null then
    raise exception 'Motoqueiro não encontrado';
  end if;

  insert into driver_location_points (motorcyclist_id, latitude, longitude)
  values (rider.id, latitude_input, longitude_input);

  return rider;
end;
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
returns deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record profiles;
  selected_rider_id uuid;
  delivery deliveries;
begin
  select * into profile_record from profiles where user_id = auth.uid() and role = 'gestor';
  if profile_record.id is null then
    raise exception 'Apenas gestores podem criar entregas';
  end if;

  if not exists (select 1 from shops where id = shop_id_input and active = true) then
    raise exception 'Loja inválida ou inativa';
  end if;

  if assigned_motorcyclist_id_input is not null then
    select id into selected_rider_id
    from motorcyclists
    where id = assigned_motorcyclist_id_input
      and current_shop_id = shop_id_input
      and is_online = true
    for update skip locked;

    if selected_rider_id is null then
      raise exception 'Motoqueiro escolhido não está online nesta loja';
    end if;
  else
    select id into selected_rider_id
    from motorcyclists
    where current_shop_id = shop_id_input
      and is_online = true
      and available = true
    order by last_assigned_at asc nulls first, created_at asc
    for update skip locked
    limit 1;
  end if;

  if selected_rider_id is not null then
    update motorcyclists
    set available = false,
        last_assigned_at = now()
    where id = selected_rider_id;
  end if;

  insert into deliveries (
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
returns deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record profiles;
  delivery_record deliveries;
  selected_rider_id uuid;
  previous_rider_id uuid;
  updated_delivery deliveries;
begin
  select * into profile_record from profiles where user_id = auth.uid() and role = 'gestor';
  if profile_record.id is null then
    raise exception 'Apenas gestores podem trocar o motoqueiro da entrega';
  end if;

  select * into delivery_record
  from deliveries
  where id = delivery_id_input
    and status in ('pending', 'assigned', 'accepted')
  for update;

  if delivery_record.id is null then
    raise exception 'Entrega não encontrada ou já saiu para entrega';
  end if;

  select id into selected_rider_id
  from motorcyclists
  where id = motorcyclist_id_input
    and current_shop_id = delivery_record.shop_id
    and is_online = true
  for update skip locked;

  if selected_rider_id is null then
    raise exception 'Motoqueiro escolhido não está online nesta loja';
  end if;

  previous_rider_id := delivery_record.motorcyclist_id;

  if previous_rider_id is not null and previous_rider_id <> selected_rider_id then
    update motorcyclists m
    set available = m.is_online and not exists (
      select 1 from deliveries d
      where d.motorcyclist_id = m.id
        and d.id <> delivery_id_input
        and d.status in ('assigned', 'accepted', 'out_for_delivery')
    )
    where m.id = previous_rider_id;
  end if;

  update motorcyclists
  set available = false,
      last_assigned_at = now()
  where id = selected_rider_id;

  update deliveries
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

create or replace function public.accept_delivery(delivery_id_input uuid)
returns deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  rider_id uuid;
  delivery deliveries;
begin
  select m.id into rider_id
  from motorcyclists m
  join profiles p on p.id = m.profile_id
  where p.user_id = auth.uid() and p.role = 'motoqueiro';

  update deliveries
  set status = 'accepted',
      accepted_at = coalesce(accepted_at, now())
  where id = delivery_id_input
    and motorcyclist_id = rider_id
    and status = 'assigned'
  returning * into delivery;

  if delivery.id is null then
    raise exception 'Entrega não encontrada ou não pode ser aceita';
  end if;

  return delivery;
end;
$$;

create or replace function public.reject_delivery(delivery_id_input uuid)
returns deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  rider_id uuid;
  next_rider_id uuid;
  delivery deliveries;
begin
  select m.id into rider_id
  from motorcyclists m
  join profiles p on p.id = m.profile_id
  where p.user_id = auth.uid() and p.role = 'motoqueiro';

  update deliveries
  set status = 'rejected',
      rejected_at = coalesce(rejected_at, now())
  where id = delivery_id_input
    and motorcyclist_id = rider_id
    and status = 'assigned'
  returning * into delivery;

  if delivery.id is null then
    raise exception 'Entrega não encontrada ou não pode ser recusada';
  end if;

  update motorcyclists set available = true where id = rider_id and is_online = true;

  select id into next_rider_id
  from motorcyclists
  where current_shop_id = delivery.shop_id
    and is_online = true
    and available = true
    and id <> rider_id
  order by last_assigned_at asc nulls first, created_at asc
  for update skip locked
  limit 1;

  if next_rider_id is not null then
    update motorcyclists
    set available = false,
        last_assigned_at = now()
    where id = next_rider_id;
    insert into deliveries (
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
      customer_name,
      customer_phone,
      status,
      assigned_at,
      created_by
    )
    values (
      delivery.shop_id,
      next_rider_id,
      delivery.origin_address,
      delivery.destination_address,
      delivery.destination_zipcode,
      delivery.destination_number,
      delivery.destination_complement,
      delivery.destination_neighborhood,
      delivery.destination_city,
      delivery.destination_state,
      delivery.customer_name,
      delivery.customer_phone,
      'assigned',
      now(),
      delivery.created_by
    );
  end if;

  return delivery;
end;
$$;

create or replace function public.mark_delivery_departed(delivery_id_input uuid)
returns deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  rider_id uuid;
  delivery deliveries;
begin
  select m.id into rider_id
  from motorcyclists m
  join profiles p on p.id = m.profile_id
  where p.user_id = auth.uid() and p.role = 'motoqueiro';

  update deliveries
  set status = 'out_for_delivery',
      departed_at = coalesce(departed_at, now())
  where id = delivery_id_input
    and motorcyclist_id = rider_id
    and status = 'accepted'
  returning * into delivery;

  if delivery.id is null then
    raise exception 'Entrega não encontrada ou não pode sair para entrega';
  end if;

  return delivery;
end;
$$;

create or replace function public.mark_delivery_arrived(delivery_id_input uuid)
returns deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  rider_id uuid;
  delivery deliveries;
begin
  select m.id into rider_id
  from motorcyclists m
  join profiles p on p.id = m.profile_id
  where p.user_id = auth.uid() and p.role = 'motoqueiro';

  update deliveries
  set arrival_notified_at = coalesce(arrival_notified_at, now())
  where id = delivery_id_input
    and motorcyclist_id = rider_id
    and status = 'out_for_delivery'
  returning * into delivery;

  if delivery.id is null then
    raise exception 'Entrega não encontrada ou ainda não saiu para entrega';
  end if;

  return delivery;
end;
$$;

create or replace function public.mark_delivery_delivered(delivery_id_input uuid)
returns deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  rider_id uuid;
  delivery deliveries;
begin
  select m.id into rider_id
  from motorcyclists m
  join profiles p on p.id = m.profile_id
  where p.user_id = auth.uid() and p.role = 'motoqueiro';

  update deliveries
  set status = 'delivered',
      delivered_at = coalesce(delivered_at, now()),
      total_duration_seconds = greatest(0, extract(epoch from (coalesce(delivered_at, now()) - created_at))::integer)
  where id = delivery_id_input
    and motorcyclist_id = rider_id
    and status = 'out_for_delivery'
  returning * into delivery;

  if delivery.id is null then
    raise exception 'Entrega não encontrada ou não pode ser finalizada';
  end if;

  update motorcyclists
  set available = is_online and not exists (
    select 1 from deliveries d
    where d.motorcyclist_id = rider_id
      and d.id <> delivery_id_input
      and d.status in ('assigned','accepted','out_for_delivery')
  )
  where id = rider_id;

  return delivery;
end;
$$;

create or replace function public.manager_update_motorcyclist(
  motorcyclist_id_input uuid,
  name_input text,
  phone_input text,
  pix_key_input text,
  pix_key_type_input text,
  payout_name_input text
)
returns motorcyclists
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record profiles;
  updated_rider motorcyclists;
  normalized_name text;
  normalized_pix_key text;
begin
  select * into profile_record from profiles where user_id = auth.uid() and role = 'gestor';
  if profile_record.id is null then
    raise exception 'Apenas gestores podem editar motoqueiros';
  end if;

  normalized_name := nullif(trim(coalesce(name_input, '')), '');
  if normalized_name is null then
    raise exception 'Informe o nome do motoqueiro';
  end if;

  normalized_pix_key := nullif(trim(coalesce(pix_key_input, '')), '');

  update motorcyclists
  set name = normalized_name,
      phone = nullif(trim(coalesce(phone_input, '')), ''),
      pix_key = normalized_pix_key,
      pix_key_type = case
        when normalized_pix_key is null then null
        else nullif(trim(coalesce(pix_key_type_input, '')), '')
      end,
      payout_name = nullif(trim(coalesce(payout_name_input, '')), '')
  where id = motorcyclist_id_input
  returning * into updated_rider;

  if updated_rider.id is null then
    raise exception 'Motoqueiro não encontrado';
  end if;

  return updated_rider;
end;
$$;

create or replace function public.create_driver_payout(
  shop_id_input uuid,
  motorcyclist_id_input uuid
)
returns driver_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record profiles;
  shop_record shops;
  rider_record motorcyclists;
  delivery_ids uuid[];
  delivery_count_value integer;
  paid_units_value integer;
  covered_days_value integer;
  amount_total_value numeric(10,2);
  last_paid_at timestamptz;
  last_paid_day date;
  min_unpaid_day date;
  period_start_day date;
  current_day_value date;
  period_start_value timestamptz;
  payout driver_payouts;
begin
  select * into profile_record from profiles where user_id = auth.uid() and role = 'gestor';
  if profile_record.id is null then
    raise exception 'Apenas gestores podem registrar pagamentos';
  end if;

  select * into shop_record from shops where id = shop_id_input and active = true;
  if shop_record.id is null then
    raise exception 'Loja inválida ou inativa';
  end if;

  select * into rider_record from motorcyclists where id = motorcyclist_id_input;
  if rider_record.id is null then
    raise exception 'Motoqueiro não encontrado';
  end if;

  if coalesce(rider_record.pix_key, '') = '' then
    raise exception 'Motoqueiro sem chave Pix cadastrada';
  end if;

  select max(paid_at) into last_paid_at
  from driver_payouts
  where shop_id = shop_id_input
    and motorcyclist_id = motorcyclist_id_input
    and payment_status = 'paid';

  select
    coalesce(array_agg(id order by delivered_at, created_at), '{}'),
    count(*)::integer,
    min(timezone('America/Sao_Paulo', coalesce(delivered_at, created_at))::date)
  into delivery_ids, delivery_count_value, min_unpaid_day
  from deliveries
  where shop_id = shop_id_input
    and motorcyclist_id = motorcyclist_id_input
    and status = 'delivered'
    and driver_payout_id is null;

  if rider_record.current_shop_id is distinct from shop_id_input and delivery_count_value = 0 then
    raise exception 'Motoqueiro sem vínculo com esta loja e sem corridas abertas para pagamento';
  end if;

  current_day_value := timezone('America/Sao_Paulo', now())::date;

  if last_paid_at is not null then
    last_paid_day := timezone('America/Sao_Paulo', last_paid_at)::date;
    period_start_day := last_paid_day + 1;

    if min_unpaid_day is not null and min_unpaid_day <= last_paid_day then
      period_start_day := min_unpaid_day;
    end if;
  else
    period_start_day := coalesce(min_unpaid_day, current_day_value);
  end if;

  if period_start_day > current_day_value then
    raise exception 'Nenhum dia em aberto para pagamento';
  end if;

  with days as (
    select generate_series(period_start_day::timestamp, current_day_value::timestamp, interval '1 day')::date as payout_day
  ),
  daily_deliveries as (
    select
      timezone('America/Sao_Paulo', coalesce(delivered_at, created_at))::date as payout_day,
      count(*)::integer as delivery_count
    from deliveries
    where shop_id = shop_id_input
      and motorcyclist_id = motorcyclist_id_input
      and status = 'delivered'
      and driver_payout_id is null
    group by 1
  )
  select
    count(*)::integer,
    coalesce(sum(greatest(coalesce(daily_deliveries.delivery_count, 0), coalesce(shop_record.minimum_guaranteed_deliveries, 10)))::integer, 0)
  into covered_days_value, paid_units_value
  from days
  left join daily_deliveries on daily_deliveries.payout_day = days.payout_day;

  amount_total_value := paid_units_value * coalesce(shop_record.payout_amount_per_delivery, 0);
  period_start_value := period_start_day::timestamp at time zone 'America/Sao_Paulo';

  insert into driver_payouts (
    shop_id,
    motorcyclist_id,
    delivery_count,
    guaranteed_deliveries,
    covered_days,
    paid_units,
    amount_per_delivery,
    amount_total,
    pix_key,
    pix_key_type,
    recipient_name,
    period_start,
    period_end,
    paid_at,
    created_by
  )
  values (
    shop_id_input,
    motorcyclist_id_input,
    delivery_count_value,
    coalesce(shop_record.minimum_guaranteed_deliveries, 10),
    covered_days_value,
    paid_units_value,
    coalesce(shop_record.payout_amount_per_delivery, 0),
    amount_total_value,
    rider_record.pix_key,
    rider_record.pix_key_type,
    coalesce(nullif(rider_record.payout_name, ''), rider_record.name),
    period_start_value,
    now(),
    now(),
    profile_record.id
  )
  returning * into payout;

  if array_length(delivery_ids, 1) is not null then
    update deliveries
    set driver_payout_id = payout.id
    where id = any(delivery_ids);
  end if;

  return payout;
end;
$$;

create or replace function public.update_driver_payout_payment(
  payout_id_input uuid,
  payment_status_input text,
  receipt_path_input text default null,
  receipt_file_name_input text default null,
  payment_note_input text default null
)
returns driver_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record profiles;
  updated_payout driver_payouts;
begin
  select * into profile_record from profiles where user_id = auth.uid() and role = 'gestor';
  if profile_record.id is null then
    raise exception 'Apenas gestores podem alterar o status do pagamento';
  end if;

  if payment_status_input not in ('pending', 'paid', 'not_paid') then
    raise exception 'Status de pagamento inválido';
  end if;

  update driver_payouts
  set payment_status = payment_status_input,
      payment_confirmed_at = case when payment_status_input = 'paid' then now() else null end,
      payment_marked_by = profile_record.id,
      receipt_path = coalesce(nullif(trim(coalesce(receipt_path_input, '')), ''), receipt_path),
      receipt_file_name = coalesce(nullif(trim(coalesce(receipt_file_name_input, '')), ''), receipt_file_name),
      payment_note = nullif(trim(coalesce(payment_note_input, '')), '')
  where id = payout_id_input
  returning * into updated_payout;

  if updated_payout.id is null then
    raise exception 'Pagamento não encontrado';
  end if;

  if payment_status_input = 'not_paid' then
    update deliveries
    set driver_payout_id = null
    where driver_payout_id = payout_id_input;
  end if;

  return updated_payout;
end;
$$;

create or replace view delivery_reports
with (security_invoker = true)
as
select
  d.id,
  d.shop_id,
  s.name as shop_name,
  d.motorcyclist_id,
  m.name as motorcyclist_name,
  d.status,
  d.created_at::date as delivery_day,
  d.created_at,
  d.assigned_at,
  d.accepted_at,
  d.departed_at,
  d.delivered_at,
  d.total_duration_seconds,
  round((d.total_duration_seconds::numeric / 60), 2) as total_duration_minutes
from deliveries d
join shops s on s.id = d.shop_id
left join motorcyclists m on m.id = d.motorcyclist_id;

alter table public.motorcyclists
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_username text,
  add column if not exists telegram_first_name text,
  add column if not exists telegram_last_name text,
  add column if not exists telegram_linked_at timestamptz;

create unique index if not exists motorcyclists_telegram_chat_id_key
  on public.motorcyclists (telegram_chat_id)
  where telegram_chat_id is not null;

create table if not exists public.telegram_events (
  id uuid primary key default gen_random_uuid(),
  update_id bigint,
  chat_id text,
  telegram_user_id text,
  username text,
  first_name text,
  last_name text,
  message_text text,
  callback_data text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists telegram_events_created_at_idx
  on public.telegram_events (created_at desc);

create index if not exists telegram_events_chat_id_idx
  on public.telegram_events (chat_id);

alter table public.telegram_events enable row level security;

drop policy if exists "Gestores visualizam eventos do Telegram" on public.telegram_events;
create policy "Gestores visualizam eventos do Telegram"
  on public.telegram_events
  for select
  to authenticated
  using (public.current_profile_role() = 'gestor');

create or replace function public.telegram_find_motorcyclist_by_chat_id(telegram_chat_id_input text)
returns motorcyclists
language plpgsql
security definer
set search_path = public
as $$
declare
  rider motorcyclists;
begin
  select *
  into rider
  from motorcyclists m
  where m.telegram_chat_id = telegram_chat_id_input
  order by m.telegram_linked_at desc nulls last, m.updated_at desc
  limit 1;

  if rider.id is null then
    raise exception 'Motoqueiro ainda nao conectou o Telegram';
  end if;

  return rider;
end;
$$;

create or replace function public.telegram_handle_driver_command(
  telegram_chat_id_input text,
  command_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rider motorcyclists;
  delivery deliveries;
  command_value text;
begin
  command_value := lower(trim(coalesce(command_input, '')));
  rider := public.telegram_find_motorcyclist_by_chat_id(telegram_chat_id_input);

  if command_value = 'available' then
    update motorcyclists m
    set is_online = true,
        available = not exists (
          select 1 from deliveries d
          where d.motorcyclist_id = m.id
            and d.status in ('assigned', 'accepted', 'out_for_delivery')
        ),
        last_seen = now()
    where m.id = rider.id
    returning * into rider;

    return jsonb_build_object('ok', true, 'command', command_value, 'motorcyclist_id', rider.id, 'message', 'Disponibilidade confirmada.');
  end if;

  if command_value = 'accept' then
    update deliveries
    set status = 'accepted',
        accepted_at = coalesce(accepted_at, now())
    where id = (
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'assigned'
      order by d.assigned_at desc nulls last, d.created_at desc
      limit 1
    )
    returning * into delivery;

    if delivery.id is null then raise exception 'Nenhuma corrida pendente para aceitar'; end if;
    return jsonb_build_object('ok', true, 'command', command_value, 'delivery_id', delivery.id, 'message', 'Corrida aceita.');
  end if;

  if command_value = 'reject' then
    return public.reject_delivery((
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'assigned'
      order by d.assigned_at desc nulls last, d.created_at desc
      limit 1
    ))::jsonb || jsonb_build_object('command', command_value, 'message', 'Corrida recusada.');
  end if;

  if command_value = 'departed' then
    return public.mark_delivery_departed((
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'accepted'
      order by d.accepted_at desc nulls last, d.created_at desc
      limit 1
    ))::jsonb || jsonb_build_object('command', command_value, 'message', 'Saida registrada.');
  end if;

  if command_value = 'arrived' then
    return public.mark_delivery_arrived((
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'out_for_delivery'
      order by d.departed_at desc nulls last, d.created_at desc
      limit 1
    ))::jsonb || jsonb_build_object('command', command_value, 'message', 'Chegada registrada.');
  end if;

  if command_value = 'delivered' then
    return public.mark_delivery_delivered((
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'out_for_delivery'
      order by d.departed_at desc nulls last, d.created_at desc
      limit 1
    ))::jsonb || jsonb_build_object('command', command_value, 'message', 'Entrega finalizada.');
  end if;

  return jsonb_build_object('ok', false, 'command', command_value, 'motorcyclist_id', rider.id, 'message', 'Comando nao reconhecido.');
end;
$$;

revoke execute on function public.telegram_find_motorcyclist_by_chat_id(text) from public, anon, authenticated;
revoke execute on function public.telegram_handle_driver_command(text, text) from public, anon, authenticated;
grant execute on function public.telegram_find_motorcyclist_by_chat_id(text) to service_role;
grant execute on function public.telegram_handle_driver_command(text, text) to service_role;

grant execute on function public.driver_check_in(uuid, text, double precision, double precision) to authenticated;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.get_my_motorcyclist() to authenticated;
grant execute on function public.driver_set_online(boolean, double precision, double precision) to authenticated;
grant execute on function public.driver_update_location(double precision, double precision) to authenticated;
grant execute on function public.create_delivery_and_assign(uuid, text, text, text, text, text, text, text, text, double precision, double precision, text, text, uuid) to authenticated;
grant execute on function public.reassign_delivery_motorcyclist(uuid, uuid) to authenticated;
grant execute on function public.accept_delivery(uuid) to authenticated;
grant execute on function public.reject_delivery(uuid) to authenticated;
grant execute on function public.mark_delivery_departed(uuid) to authenticated;
grant execute on function public.mark_delivery_arrived(uuid) to authenticated;
grant execute on function public.mark_delivery_delivered(uuid) to authenticated;
grant execute on function public.manager_update_motorcyclist(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.create_driver_payout(uuid, uuid) to authenticated;
grant execute on function public.update_driver_payout_payment(uuid, text, text, text, text) to authenticated;
grant select on table public.driver_location_points to authenticated;
