-- Migração incremental:
-- quando um Pix for marcado como "não pago", as corridas voltam para a apuração aberta.
-- Assim o gestor pode gerar um novo Pix depois.

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
