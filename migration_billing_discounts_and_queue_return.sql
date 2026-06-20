-- Billing controls for shops and future driver billing.
alter table public.shops
  add column if not exists base_monthly_price numeric(10,2) not null default 99,
  add column if not exists discount_type text not null default 'none',
  add column if not exists discount_value numeric(10,2) not null default 0,
  add column if not exists billing_note text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shops'
      and column_name = 'monthly_price'
  ) then
    execute $sql$
      update public.shops
      set base_monthly_price = coalesce(base_monthly_price, monthly_price, 99),
          discount_type = coalesce(nullif(discount_type, ''), 'none'),
          discount_value = coalesce(discount_value, 0)
    $sql$;
  else
    update public.shops
    set base_monthly_price = coalesce(base_monthly_price, 99),
        discount_type = coalesce(nullif(discount_type, ''), 'none'),
        discount_value = coalesce(discount_value, 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shops_discount_type_check'
  ) then
    alter table public.shops
      add constraint shops_discount_type_check
      check (discount_type in ('none', 'fixed', 'percent'));
  end if;
end $$;

alter table public.motorcyclists
  add column if not exists billing_mode text not null default 'none',
  add column if not exists billing_base_amount numeric(10,2) not null default 0,
  add column if not exists billing_percentage numeric(5,2) not null default 0,
  add column if not exists billing_discount_type text not null default 'none',
  add column if not exists billing_discount_value numeric(10,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'motorcyclists_billing_mode_check'
  ) then
    alter table public.motorcyclists
      add constraint motorcyclists_billing_mode_check
      check (billing_mode in ('none', 'monthly', 'percentage'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'motorcyclists_billing_discount_type_check'
  ) then
    alter table public.motorcyclists
      add constraint motorcyclists_billing_discount_type_check
      check (billing_discount_type in ('none', 'fixed', 'percent'));
  end if;
end $$;

drop function if exists public.distance_meters(
  double precision,
  double precision,
  double precision,
  double precision
);

create or replace function public.distance_meters(
  latitude_a double precision,
  longitude_a double precision,
  latitude_b double precision,
  longitude_b double precision
)
returns double precision
language sql
immutable
strict
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(latitude_b - latitude_a) / 2), 2)
    + cos(radians(latitude_a))
    * cos(radians(latitude_b))
    * power(sin(radians(longitude_b - longitude_a) / 2), 2)
  ));
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
  where profile_id in (select p.id from profiles p where p.user_id = auth.uid() and p.role = 'motoqueiro')
  returning * into rider;

  if rider.id is null then
    raise exception 'Motoqueiro não encontrado';
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

grant execute on function public.distance_meters(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.driver_update_location(double precision, double precision) to authenticated;
