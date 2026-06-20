create or replace function public.distance_meters(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
)
returns double precision
language sql
immutable
as $$
  with haversine as (
    select greatest(0, least(1,
      pow(sin(radians(($3 - $1) / 2)), 2) +
      cos(radians($1)) * cos(radians($3)) *
      pow(sin(radians(($4 - $2) / 2)), 2)
    )) as value
  )
  select 6371000 * 2 * atan2(sqrt(value), sqrt(1 - value))
  from haversine;
$$;

create or replace function public.shop_dispatch_delivery(delivery_id_input uuid)
returns deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record profiles;
  delivery deliveries;
begin
  select *
  into profile_record
  from profiles
  where user_id = auth.uid()
  limit 1;

  if profile_record.id is null then
    raise exception 'Perfil nao encontrado';
  end if;

  update deliveries d
  set status = 'out_for_delivery',
      departed_at = coalesce(d.departed_at, now()),
      updated_at = now()
  where d.id = delivery_id_input
    and d.status = 'accepted'
    and (
      profile_record.role in ('gestor', 'admin_master')
      or (
        d.shop_id = profile_record.store_id
        and (
          profile_record.role in ('loja', 'lojista')
          or coalesce((profile_record.permissions ->> 'chamar_motoqueiro')::boolean, false)
          or coalesce((profile_record.permissions ->> 'editar_pedidos')::boolean, false)
        )
      )
      or d.shop_id in (
        select s.id
        from shops s
        where s.created_by = profile_record.id
      )
    )
  returning * into delivery;

  if delivery.id is null then
    raise exception 'Entrega nao encontrada, nao aceita ou sem permissao para despachar';
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
  rider_record motorcyclists;
  delivery deliveries;
  distance_to_destination double precision;
begin
  select m.*
  into rider_record
  from motorcyclists m
  join profiles p on p.id = m.profile_id
  where p.user_id = auth.uid()
    and p.role = 'motoqueiro'
  limit 1;

  if rider_record.id is null then
    raise exception 'Motoqueiro nao encontrado';
  end if;

  select *
  into delivery
  from deliveries
  where id = delivery_id_input
    and motorcyclist_id = rider_record.id
    and status = 'out_for_delivery'
  limit 1;

  if delivery.id is null then
    raise exception 'Entrega nao encontrada ou nao pode ser finalizada';
  end if;

  if delivery.arrival_notified_at is null then
    if rider_record.latitude is null
      or rider_record.longitude is null
      or delivery.destination_latitude is null
      or delivery.destination_longitude is null
    then
      raise exception 'Chegada ainda nao liberada pelo mapa. Atualize sua localizacao perto do destino.';
    end if;

    distance_to_destination := public.distance_meters(
      rider_record.latitude,
      rider_record.longitude,
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
  where id = delivery_id_input
    and motorcyclist_id = rider_record.id
    and status = 'out_for_delivery'
  returning * into delivery;

  update motorcyclists
  set available = is_online and not exists (
        select 1
        from deliveries d
        where d.motorcyclist_id = rider_record.id
          and d.id <> delivery_id_input
          and d.status in ('assigned', 'accepted', 'out_for_delivery')
      ),
      updated_at = now()
  where id = rider_record.id;

  return delivery;
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
  distance_to_destination double precision;
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
    return to_jsonb(public.reject_delivery((
      select d.id from deliveries d
      where d.motorcyclist_id = rider.id
        and d.status = 'assigned'
      order by d.assigned_at desc nulls last, d.created_at desc
      limit 1
    ))) || jsonb_build_object('command', command_value, 'message', 'Corrida recusada.');
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

grant execute on function public.distance_meters(double precision, double precision, double precision, double precision) to authenticated, service_role;
grant execute on function public.shop_dispatch_delivery(uuid) to authenticated;
grant execute on function public.mark_delivery_delivered(uuid) to authenticated;
revoke execute on function public.telegram_handle_driver_command(text, text) from public, anon, authenticated;
grant execute on function public.telegram_handle_driver_command(text, text) to service_role;
