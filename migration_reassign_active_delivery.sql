-- Migração incremental:
-- permite trocar manualmente o motoqueiro de uma entrega que já está em chamada.

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

  if exists (
    select 1
    from deliveries
    where motorcyclist_id = selected_rider_id
      and id <> delivery_id_input
      and status = 'out_for_delivery'
  ) then
    raise exception 'Motoqueiro escolhido já saiu para outra entrega';
  end if;

  update deliveries
  set motorcyclist_id = null,
      status = 'pending',
      assigned_at = null,
      accepted_at = null,
      rejected_at = null,
      departed_at = null,
      delivered_at = null,
      total_duration_seconds = null
  where motorcyclist_id = selected_rider_id
    and id <> delivery_id_input
    and status in ('pending', 'assigned', 'accepted');

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

grant execute on function public.reassign_delivery_motorcyclist(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
