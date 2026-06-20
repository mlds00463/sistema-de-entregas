-- Make Telegram inline buttons act on the exact delivery they were created for.
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
  new_delivery deliveries;
  next_rider_id uuid;
  requested_delivery_id uuid;
  command_raw text;
  command_value text;
  delivery_id_text text;
  distance_to_destination double precision;
begin
  command_raw := lower(trim(coalesce(command_input, '')));
  command_value := split_part(command_raw, ':', 1);
  delivery_id_text := nullif(split_part(command_raw, ':', 2), '');

  if delivery_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    requested_delivery_id := delivery_id_text::uuid;
  end if;

  rider := public.telegram_find_motorcyclist_by_chat_id(telegram_chat_id_input);

  if command_value = 'available' then
    update motorcyclists m
    set is_online = true,
        available = not exists (
          select 1 from deliveries d
          where d.motorcyclist_id = m.id
            and d.status in ('assigned', 'accepted', 'out_for_delivery')
        ),
        last_seen = now(),
        updated_at = now()
    where m.id = rider.id
    returning * into rider;

    return jsonb_build_object('ok', true, 'command', command_value, 'motorcyclist_id', rider.id, 'message', 'Disponibilidade confirmada.');
  end if;

  if command_value = 'accept' then
    update deliveries
    set status = 'accepted',
        accepted_at = coalesce(accepted_at, now()),
        updated_at = now()
    where id = coalesce(requested_delivery_id, (
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'assigned'
      order by d.assigned_at desc nulls last, d.created_at desc
      limit 1
    ))
      and motorcyclist_id = rider.id
      and status = 'assigned'
    returning * into delivery;

    if delivery.id is null then
      raise exception 'Corrida nao encontrada ou ja respondida';
    end if;

    return jsonb_build_object('ok', true, 'command', command_value, 'delivery_id', delivery.id, 'message', 'Corrida aceita.');
  end if;

  if command_value = 'reject' then
    update deliveries
    set status = 'rejected',
        rejected_at = coalesce(rejected_at, now()),
        updated_at = now()
    where id = coalesce(requested_delivery_id, (
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'assigned'
      order by d.assigned_at desc nulls last, d.created_at desc
      limit 1
    ))
      and motorcyclist_id = rider.id
      and status = 'assigned'
    returning * into delivery;

    if delivery.id is null then
      raise exception 'Corrida nao encontrada ou ja respondida';
    end if;

    update motorcyclists
    set available = is_online,
        updated_at = now()
    where id = rider.id;

    select id into next_rider_id
    from motorcyclists
    where current_shop_id = delivery.shop_id
      and is_online = true
      and available = true
      and coalesce(active, true) = true
      and id <> rider.id
    order by last_assigned_at asc nulls first, created_at asc
    for update skip locked
    limit 1;

    if next_rider_id is not null then
      update motorcyclists
      set available = false,
          last_assigned_at = now(),
          updated_at = now()
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
        destination_latitude,
        destination_longitude,
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
        delivery.destination_latitude,
        delivery.destination_longitude,
        delivery.customer_name,
        delivery.customer_phone,
        'assigned',
        now(),
        delivery.created_by
      )
      returning * into new_delivery;
    end if;

    return jsonb_build_object(
      'ok', true,
      'command', command_value,
      'delivery_id', delivery.id,
      'next_delivery_id', new_delivery.id,
      'message', 'Corrida recusada.'
    );
  end if;

  if command_value in ('departed', 'arrived') then
    return jsonb_build_object(
      'ok', false,
      'command', command_value,
      'motorcyclist_id', rider.id,
      'message', 'Essa etapa agora e feita pela loja ou liberada automaticamente pelo mapa.'
    );
  end if;

  if command_value = 'delivered' then
    select *
    into delivery
    from deliveries d
    where d.motorcyclist_id = rider.id
      and d.status = 'out_for_delivery'
      and (requested_delivery_id is null or d.id = requested_delivery_id)
    order by d.departed_at desc nulls last, d.created_at desc
    limit 1;

    if delivery.id is null then
      raise exception 'Nenhuma corrida em rota para finalizar';
    end if;

    if delivery.arrival_notified_at is null then
      if rider.latitude is null
        or rider.longitude is null
        or delivery.destination_latitude is null
        or delivery.destination_longitude is null
      then
        raise exception 'Chegada ainda nao liberada pelo mapa. Abra o painel do motoqueiro e ative o GPS perto do destino.';
      end if;

      distance_to_destination := public.distance_meters(
        rider.latitude,
        rider.longitude,
        delivery.destination_latitude,
        delivery.destination_longitude
      );

      if distance_to_destination > 120 then
        raise exception 'Entregue sera liberado quando voce estiver perto do destino. Distancia atual: % metros', round(distance_to_destination);
      end if;
    end if;

    update deliveries
    set status = 'delivered',
        arrival_notified_at = coalesce(arrival_notified_at, now()),
        delivered_at = coalesce(delivered_at, now()),
        total_duration_seconds = greatest(0, extract(epoch from (coalesce(delivered_at, now()) - created_at))::integer),
        updated_at = now()
    where id = delivery.id
    returning * into delivery;

    update motorcyclists
    set available = is_online and not exists (
          select 1
          from deliveries d
          where d.motorcyclist_id = rider.id
            and d.id <> delivery.id
            and d.status in ('assigned', 'accepted', 'out_for_delivery')
        ),
        updated_at = now()
    where id = rider.id;

    return to_jsonb(delivery) || jsonb_build_object('ok', true, 'command', command_value, 'delivery_id', delivery.id, 'message', 'Entrega finalizada.');
  end if;

  return jsonb_build_object('ok', false, 'command', command_value, 'motorcyclist_id', rider.id, 'message', 'Comando nao reconhecido.');
end;
$$;

revoke execute on function public.telegram_handle_driver_command(text, text) from public, anon, authenticated;
grant execute on function public.telegram_handle_driver_command(text, text) to service_role;
