-- Migração incremental para CEP, CNPJ, fila e mapa ao vivo.
-- Rode no SQL Editor do Supabase sem apagar dados existentes.

alter table shops add column if not exists legal_name text;
alter table shops add column if not exists cnpj text;
alter table shops add column if not exists number text;
alter table shops add column if not exists complement text;
alter table shops add column if not exists neighborhood text;
alter table shops add column if not exists state text;
alter table shops add column if not exists zipcode text;
alter table shops add column if not exists contact_name text;
alter table shops add column if not exists contact_phone text;
alter table shops add column if not exists contact_email text;

create unique index if not exists idx_shops_cnpj_unique
on shops(cnpj)
where cnpj is not null and cnpj <> '';

alter table deliveries add column if not exists destination_zipcode text;
alter table deliveries add column if not exists destination_number text;
alter table deliveries add column if not exists destination_complement text;
alter table deliveries add column if not exists destination_neighborhood text;
alter table deliveries add column if not exists destination_city text;
alter table deliveries add column if not exists destination_state text;
alter table deliveries add column if not exists driver_payout_id uuid;

drop function if exists public.create_delivery_and_assign(uuid, text, text, text, text);
drop function if exists public.create_delivery_and_assign(uuid, text, text, text, text, text, text, text, text, text, text);

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
  customer_name_input text default null,
  customer_phone_input text default null
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

  select id into selected_rider_id
  from motorcyclists
  where current_shop_id = shop_id_input
    and is_online = true
    and available = true
  order by last_seen asc nulls first, created_at asc
  for update skip locked
  limit 1;

  if selected_rider_id is not null then
    update motorcyclists set available = false where id = selected_rider_id;
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

grant execute on function public.create_delivery_and_assign(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
