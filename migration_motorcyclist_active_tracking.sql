-- Motoqueiro ativo/cancelado e rastreamento com retorno automatico para fila.
alter table public.motorcyclists
  add column if not exists active boolean not null default true;

update public.motorcyclists
set active = true
where active is null;

drop function if exists public.driver_set_online(
  boolean,
  double precision,
  double precision
);

drop function if exists public.driver_update_location(
  double precision,
  double precision
);

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
  set is_online = case when m.active then online_input else false end,
      available = case
        when not m.active then false
        else online_input and not exists (
          select 1 from deliveries d
          where d.motorcyclist_id = m.id
            and d.status in ('assigned','accepted','out_for_delivery')
        )
      end,
      latitude = latitude_input,
      longitude = longitude_input,
      last_seen = now()
  where m.profile_id in (
    select p.id from profiles p where p.user_id = auth.uid() and p.role = 'motoqueiro'
  )
  returning * into rider;

  if rider.id is null then
    raise exception 'Motoqueiro não encontrado';
  end if;

  if rider.active = false then
    raise exception 'Cadastro do motoqueiro está cancelado';
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
  shop_record shops;
begin
  update motorcyclists
  set latitude = latitude_input,
      longitude = longitude_input,
      last_seen = now()
  where active = true
    and profile_id in (
      select p.id from profiles p where p.user_id = auth.uid() and p.role = 'motoqueiro'
    )
  returning * into rider;

  if rider.id is null then
    raise exception 'Motoqueiro não encontrado ou cadastro cancelado';
  end if;

  insert into driver_location_points (motorcyclist_id, latitude, longitude)
  values (rider.id, latitude_input, longitude_input);

  select * into shop_record
  from shops
  where id = rider.current_shop_id
    and latitude is not null
    and longitude is not null;

  if shop_record.id is not null
    and public.distance_meters(latitude_input, longitude_input, shop_record.latitude, shop_record.longitude) <= 20
    and not exists (
      select 1
      from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status in ('assigned', 'accepted', 'out_for_delivery')
    )
  then
    update motorcyclists
    set available = is_online,
        last_seen = now()
    where id = rider.id
    returning * into rider;
  end if;

  return rider;
end;
$$;

grant execute on function public.driver_set_online(boolean, double precision, double precision) to authenticated;
grant execute on function public.driver_update_location(double precision, double precision) to authenticated;
