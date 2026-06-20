-- Migração incremental:
-- corrige a fila para rodar entre todos os motoqueiros disponíveis.
-- A ordem deixa de usar "last_seen" (GPS) e passa a usar "last_assigned_at" (última chamada).

alter table motorcyclists add column if not exists last_assigned_at timestamptz;

drop index if exists idx_motorcyclists_queue;
create index if not exists idx_motorcyclists_queue
on motorcyclists(current_shop_id, is_online, available, last_assigned_at, created_at);

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
  order by last_assigned_at asc nulls first, created_at asc
  for update skip locked
  limit 1;

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

grant execute on function public.create_delivery_and_assign(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.reject_delivery(uuid) to authenticated;

notify pgrst, 'reload schema';
