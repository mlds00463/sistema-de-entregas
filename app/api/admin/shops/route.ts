import { NextRequest, NextResponse } from 'next/server';
import { getRouteContext, jsonError } from '@/lib/serverAuth';

export const runtime = 'nodejs';

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;
  if (context.role !== 'ADMIN_MASTER') return jsonError('Apenas Admin Master pode alterar assinaturas.', 403);

  const body = await request.json().catch(() => null) as {
    action?: 'subscription' | 'block' | 'unblock';
    shopId?: string;
    subscriptionStatus?: string;
    monthlyPrice?: number;
    baseMonthlyPrice?: number;
    discountType?: 'none' | 'fixed' | 'percent';
    discountValue?: number;
    billingNote?: string;
    dueDate?: string | null;
    trialDays?: number;
  } | null;

  if (!body?.shopId || !body.action) return jsonError('Dados incompletos.');

  if (body.action === 'block' || body.action === 'unblock') {
    const { data, error } = await context.admin
      .from('shops')
      .update({
        subscription_status: body.action === 'block' ? 'blocked' : 'active',
        subscription_blocked_at: body.action === 'block' ? new Date().toISOString() : null,
      })
      .eq('id', body.shopId)
      .select()
      .single();

    if (error) return jsonError(error.message, 400);
    return NextResponse.json({ shop: data });
  }

  const patch: Record<string, unknown> = {};

  if (body.subscriptionStatus) patch.subscription_status = body.subscriptionStatus;
  if (typeof body.monthlyPrice === 'number') patch.monthly_price = body.monthlyPrice;
  if (typeof body.baseMonthlyPrice === 'number') patch.base_monthly_price = body.baseMonthlyPrice;
  if (body.discountType) patch.discount_type = body.discountType;
  if (typeof body.discountValue === 'number') patch.discount_value = body.discountValue;
  if (typeof body.billingNote === 'string') patch.billing_note = body.billingNote;
  if ('dueDate' in body) patch.due_date = body.dueDate || null;
  if (typeof body.trialDays === 'number' && body.trialDays >= 0) {
    const start = new Date();
    patch.trial_start_date = start.toISOString().slice(0, 10);
    patch.trial_end_date = addDays(start, body.trialDays);
    patch.subscription_status = 'trial';
    patch.subscription_blocked_at = null;
  }
  if (patch.subscription_status !== 'blocked') patch.subscription_blocked_at = null;

  let updatePayload = patch;
  let { data, error } = await context.admin
    .from('shops')
    .update(updatePayload)
    .eq('id', body.shopId)
    .select()
    .single();

  if (error && /base_monthly_price|discount_type|discount_value|billing_note/i.test(error.message)) {
    updatePayload = { ...patch };
    delete updatePayload.base_monthly_price;
    delete updatePayload.discount_type;
    delete updatePayload.discount_value;
    delete updatePayload.billing_note;
    const fallback = await context.admin
      .from('shops')
      .update(updatePayload)
      .eq('id', body.shopId)
      .select()
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) return jsonError(error.message, 400);
  return NextResponse.json({ shop: data });
}
