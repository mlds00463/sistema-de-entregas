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
  next_rider_id uuid;
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

    return jsonb_build_object(
      'ok', true,
      'command', command_value,
      'motorcyclist_id', rider.id,
      'message', 'Disponibilidade confirmada.'
    );
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

    if delivery.id is null then
      raise exception 'Nenhuma corrida pendente para aceitar';
    end if;

    return jsonb_build_object('ok', true, 'command', command_value, 'delivery_id', delivery.id, 'message', 'Corrida aceita.');
  end if;

  if command_value = 'reject' then
    update deliveries
    set status = 'rejected',
        rejected_at = coalesce(rejected_at, now())
    where id = (
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'assigned'
      order by d.assigned_at desc nulls last, d.created_at desc
      limit 1
    )
    returning * into delivery;

    if delivery.id is null then
      raise exception 'Nenhuma corrida pendente para recusar';
    end if;

    update motorcyclists set available = true where id = rider.id and is_online = true;

    select id into next_rider_id
    from motorcyclists
    where current_shop_id = delivery.shop_id
      and is_online = true
      and available = true
      and id <> rider.id
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

    return jsonb_build_object('ok', true, 'command', command_value, 'delivery_id', delivery.id, 'message', 'Corrida recusada.');
  end if;

  if command_value = 'departed' then
    update deliveries
    set status = 'out_for_delivery',
        departed_at = coalesce(departed_at, now())
    where id = (
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'accepted'
      order by d.accepted_at desc nulls last, d.created_at desc
      limit 1
    )
    returning * into delivery;

    if delivery.id is null then
      raise exception 'Nenhuma corrida aceita para iniciar';
    end if;

    return jsonb_build_object('ok', true, 'command', command_value, 'delivery_id', delivery.id, 'message', 'Saida registrada.');
  end if;

  if command_value = 'arrived' then
    update deliveries
    set arrival_notified_at = coalesce(arrival_notified_at, now())
    where id = (
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'out_for_delivery'
      order by d.departed_at desc nulls last, d.created_at desc
      limit 1
    )
    returning * into delivery;

    if delivery.id is null then
      raise exception 'Nenhuma corrida em rota para registrar chegada';
    end if;

    return jsonb_build_object('ok', true, 'command', command_value, 'delivery_id', delivery.id, 'message', 'Chegada registrada.');
  end if;

  if command_value = 'delivered' then
    update deliveries
    set status = 'delivered',
        delivered_at = coalesce(delivered_at, now()),
        total_duration_seconds = greatest(0, extract(epoch from (coalesce(delivered_at, now()) - created_at))::integer)
    where id = (
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'out_for_delivery'
      order by d.departed_at desc nulls last, d.created_at desc
      limit 1
    )
    returning * into delivery;

    if delivery.id is null then
      raise exception 'Nenhuma corrida em rota para finalizar';
    end if;

    update motorcyclists m
    set available = m.is_online and not exists (
      select 1 from deliveries d
      where d.motorcyclist_id = m.id
        and d.status in ('assigned', 'accepted', 'out_for_delivery')
    )
    where m.id = rider.id;

    return jsonb_build_object('ok', true, 'command', command_value, 'delivery_id', delivery.id, 'message', 'Entrega finalizada.');
  end if;

  return jsonb_build_object(
    'ok', false,
    'command', command_value,
    'motorcyclist_id', rider.id,
    'message', 'Comando nao reconhecido.'
  );
end;
$$;

revoke execute on function public.telegram_find_motorcyclist_by_chat_id(text) from public, anon, authenticated;
revoke execute on function public.telegram_handle_driver_command(text, text) from public, anon, authenticated;
grant execute on function public.telegram_find_motorcyclist_by_chat_id(text) to service_role;
grant execute on function public.telegram_handle_driver_command(text, text) to service_role;
