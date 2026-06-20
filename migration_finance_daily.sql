-- Migração incremental:
-- 1. mínimo garantido passa a ser diário e acumulado até o pagamento;
-- 2. gestor pode editar dados do motoqueiro usados em telefone/Pix.

alter table driver_payouts add column if not exists covered_days integer not null default 1;

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
    and motorcyclist_id = motorcyclist_id_input;

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

grant execute on function public.manager_update_motorcyclist(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.create_driver_payout(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
