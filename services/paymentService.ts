import { supabase } from '@/lib/supabaseClient';
import type { DriverPayout } from '@/lib/types';

export async function getDriverPayouts(shopId?: string) {
  let query = supabase
    .from('driver_payouts')
    .select('*, shops(name,cnpj), motorcyclists(name,pix_key,pix_key_type,payout_name)')
    .order('paid_at', { ascending: false });

  if (shopId) query = query.eq('shop_id', shopId);

  return query.returns<DriverPayout[]>();
}

export async function createDriverPayout(shopId: string, motorcyclistId: string) {
  return supabase
    .rpc('create_driver_payout', {
      shop_id_input: shopId,
      motorcyclist_id_input: motorcyclistId,
    });
}

export async function updateShopPayoutSettings(shopId: string, amount: number, minimum: number) {
  return supabase
    .from('shops')
    .update({
      payout_amount_per_delivery: amount,
      minimum_guaranteed_deliveries: minimum,
    })
    .eq('id', shopId)
    .select()
    .single();
}

export async function uploadPayoutReceipt(payoutId: string, file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `${payoutId}/${randomId}.${extension}`;

  return supabase.storage
    .from('payout-receipts')
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
}

export async function getPayoutReceiptUrl(path: string) {
  return supabase.storage
    .from('payout-receipts')
    .createSignedUrl(path, 60 * 60);
}

export async function updatePayoutPaymentStatus(input: {
  payoutId: string;
  paymentStatus: 'pending' | 'paid' | 'not_paid';
  receiptPath?: string | null;
  receiptFileName?: string | null;
  paymentNote?: string | null;
}) {
  return supabase.rpc('update_driver_payout_payment', {
    payout_id_input: input.payoutId,
    payment_status_input: input.paymentStatus,
    receipt_path_input: input.receiptPath ?? null,
    receipt_file_name_input: input.receiptFileName ?? null,
    payment_note_input: input.paymentNote ?? null,
  });
}
