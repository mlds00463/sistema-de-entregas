-- Migração incremental:
-- 1. Coordenadas do destino e aviso de chegada por GPS.
-- 2. Histórico de pontos do motoqueiro para desenhar rota percorrida no mapa.
-- 3. Permite chamar manualmente o mesmo motoqueiro para 2 ou mais entregas.

alter table deliveries add column if not exists destination_latitude double precision;
alter table deliveries add column if not exists destination_longitude double precision;
alter table deliveries add column if not exists arrival_notified_at timestamptz;

create table if not exists driver_location_points (
  id uuid primary key default gen_random_uuid(),
  motorcyclist_id uuid not null references motorcyclists(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  recorded_at timestamptz not null default now(),
  constraint driver_location_point_valid check (
    latitude between -90 and 90 and longitude between -180 and 180
  )
);

create index if not exists idx_driver_location_points_rider_time
on driver_location_points(motorcyclist_id, recorded_at desc);

alter table driver_location_points enable row level security;

drop policy if exists driver_location_points_select_manager_or_own on driver_location_points;
create policy driver_location_points_select_manager_or_own on driver_location_points
for select using (
  public.current_profile_role() = 'gestor'
  or exists (
    select 1 from motorcyclists m
    where m.profile_id = public.current_profile_id()
      and m.id = driver_location_points.motorcyclist_id
  )
);

drop function if exists public.create_delivery_and_assign(uuid, text, text, text, text, text, text, text, text, text, text, uuid);

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

grant execute on function public.driver_set_online(boolean, double precision, double precision) to authenticated;
grant execute on function public.driver_update_location(double precision, double precision) to authenticated;
grant execute on function public.create_delivery_and_assign(uuid, text, text, text, text, text, text, text, text, double precision, double precision, text, text, uuid) to authenticated;
grant execute on function public.reassign_delivery_motorcyclist(uuid, uuid) to authenticated;
grant execute on function public.mark_delivery_arrived(uuid) to authenticated;
grant execute on function public.mark_delivery_delivered(uuid) to authenticated;
grant select on table public.driver_location_points to authenticated;

notify pgrst, 'reload schema';
