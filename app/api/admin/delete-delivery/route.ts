import { NextRequest, NextResponse } from 'next/server';
import { getRouteContext, jsonError } from '@/lib/serverAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;

  if (context.role !== 'ADMIN_MASTER') {
    return jsonError('Apenas Admin Master pode excluir pedidos.', 403);
  }

  const body = await request.json().catch(() => null) as { deliveryId?: string } | null;
  const deliveryId = body?.deliveryId;

  if (!deliveryId) {
    return jsonError('Pedido não informado.');
  }

  const { data: delivery, error: deliveryError } = await context.admin
    .from('deliveries')
    .select('id,motorcyclist_id,status')
    .eq('id', deliveryId)
    .maybeSingle();

  if (deliveryError) return jsonError(deliveryError.message, 400);
  if (!delivery) return jsonError('Pedido não encontrado.', 404);

  const now = new Date().toISOString();

  const { error: unlinkPayoutError } = await context.admin
    .from('deliveries')
    .update({ driver_payout_id: null, updated_at: now })
    .eq('id', deliveryId);

  if (unlinkPayoutError) return jsonError(unlinkPayoutError.message, 400);

  const { error: deleteError } = await context.admin
    .from('deliveries')
    .delete()
    .eq('id', deliveryId);

  if (deleteError) return jsonError(deleteError.message, 400);

  if (delivery.motorcyclist_id && ['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status)) {
    const { count } = await context.admin
      .from('deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('motorcyclist_id', delivery.motorcyclist_id)
      .in('status', ['assigned', 'accepted', 'out_for_delivery']);

    if ((count ?? 0) === 0) {
      await context.admin
        .from('motorcyclists')
        .update({ available: true, updated_at: now })
        .eq('id', delivery.motorcyclist_id);
    }
  }

  return NextResponse.json({ ok: true });
}
