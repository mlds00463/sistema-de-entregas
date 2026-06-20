-- Migração incremental:
-- controle de Pix pago/não pago e armazenamento de comprovantes.

alter table driver_payouts add column if not exists payment_status text not null default 'pending';
alter table driver_payouts add column if not exists payment_confirmed_at timestamptz;
alter table driver_payouts add column if not exists payment_marked_by uuid references profiles(id) on delete set null;
alter table driver_payouts add column if not exists receipt_path text;
alter table driver_payouts add column if not exists receipt_file_name text;
alter table driver_payouts add column if not exists payment_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'driver_payouts_payment_status_check'
  ) then
    alter table driver_payouts
    add constraint driver_payouts_payment_status_check
    check (payment_status in ('pending', 'paid', 'not_paid'));
  end if;
end;
$$;

insert into storage.buckets (id, name, public)
values ('payout-receipts', 'payout-receipts', false)
on conflict (id) do update set public = false;

drop policy if exists payout_receipts_select_manager on storage.objects;
drop policy if exists payout_receipts_insert_manager on storage.objects;
drop policy if exists payout_receipts_update_manager on storage.objects;

create policy payout_receipts_select_manager on storage.objects
for select to authenticated using (
  bucket_id = 'payout-receipts'
  and public.current_profile_role() = 'gestor'
);

create policy payout_receipts_insert_manager on storage.objects
for insert to authenticated with check (
  bucket_id = 'payout-receipts'
  and public.current_profile_role() = 'gestor'
);

create policy payout_receipts_update_manager on storage.objects
for update to authenticated using (
  bucket_id = 'payout-receipts'
  and public.current_profile_role() = 'gestor'
) with check (
  bucket_id = 'payout-receipts'
  and public.current_profile_role() = 'gestor'
);

create or replace function public.update_driver_payout_payment(
  payout_id_input uuid,
  payment_status_input text,
  receipt_path_input text default null,
  receipt_file_name_input text default null,
  payment_note_input text default null
)
returns driver_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record profiles;
  updated_payout driver_payouts;
begin
  select * into profile_record from profiles where user_id = auth.uid() and role = 'gestor';
  if profile_record.id is null then
    raise exception 'Apenas gestores podem alterar o status do pagamento';
  end if;

  if payment_status_input not in ('pending', 'paid', 'not_paid') then
    raise exception 'Status de pagamento inválido';
  end if;

  update driver_payouts
  set payment_status = payment_status_input,
      payment_confirmed_at = case when payment_status_input = 'paid' then now() else null end,
      payment_marked_by = profile_record.id,
      receipt_path = coalesce(nullif(trim(coalesce(receipt_path_input, '')), ''), receipt_path),
      receipt_file_name = coalesce(nullif(trim(coalesce(receipt_file_name_input, '')), ''), receipt_file_name),
      payment_note = nullif(trim(coalesce(payment_note_input, '')), '')
  where id = payout_id_input
  returning * into updated_payout;

  if updated_payout.id is null then
    raise exception 'Pagamento não encontrado';
  end if;

  if payment_status_input = 'not_paid' then
    update deliveries
    set driver_payout_id = null
    where driver_payout_id = payout_id_input;
  end if;

  return updated_payout;
end;
$$;

grant execute on function public.update_driver_payout_payment(uuid, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
