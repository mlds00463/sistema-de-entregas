import { NextRequest, NextResponse } from 'next/server';
import { getRouteContext, jsonError } from '@/lib/serverAuth';

export const runtime = 'nodejs';

type DeliveryForFinish = {
  id: string;
  motorcyclist_id: string | null;
  status: string;
  created_at: string;
  departed_at: string | null;
};

export async function POST(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;

  if (context.role !== 'MOTOQUEIRO') {
    return jsonError('Apenas motoqueiro pode finalizar por esta rota.', 403);
  }

  const body = await request.json().catch(() => null) as { deliveryId?: string } | null;
  const deliveryId = body?.deliveryId;

  if (!deliveryId) {
    return jsonError('Entrega não informada.');
  }

  const { data: rider, error: riderError } = await context.admin
    .from('motorcyclists')
    .select('id,is_online')
    .eq('profile_id', context.profile.id)
    .maybeSingle();

  if (riderError) return jsonError(riderError.message, 400);
  if (!rider) return jsonError('Motoqueiro não encontrado.', 404);

  const { data: deliveryData, error: deliveryError } = await context.admin
    .from('deliveries')
    .select('id,motorcyclist_id,status,created_at,departed_at')
    .eq('id', deliveryId)
    .eq('motorcyclist_id', rider.id)
    .maybeSingle();

  if (deliveryError) return jsonError(deliveryError.message, 400);
  if (!deliveryData) return jsonError('Entrega não encontrada para este motoqueiro.', 404);

  const delivery = deliveryData as DeliveryForFinish;

  if (delivery.status !== 'out_for_delivery') {
    return jsonError('A entrega precisa estar em rota para ser finalizada.', 409);
  }

  const now = new Date();
  const createdAt = new Date(delivery.created_at);
  const totalDurationSeconds = Number.isNaN(createdAt.getTime())
    ? 0
    : Math.max(0, Math.round((now.getTime() - createdAt.getTime()) / 1000));

  const { data: updatedDelivery, error: updateError } = await context.admin
    .from('deliveries')
    .update({
      status: 'delivered',
      arrival_notified_at: now.toISOString(),
      departed_at: delivery.departed_at ?? now.toISOString(),
      delivered_at: now.toISOString(),
      total_duration_seconds: totalDurationSeconds,
      updated_at: now.toISOString(),
    })
    .eq('id', delivery.id)
    .eq('motorcyclist_id', rider.id)
    .eq('status', 'out_for_delivery')
    .select('*, shops(name,address,number,complement,neighborhood,city,state,zipcode,cnpj,latitude,longitude), motorcyclists(id,name,phone,latitude,longitude,last_seen,telegram_chat_id,pix_key,pix_key_type,payout_name)')
    .single();

  if (updateError) return jsonError(updateError.message, 400);

  const { count } = await context.admin
    .from('deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('motorcyclist_id', rider.id)
    .in('status', ['assigned', 'accepted', 'out_for_delivery']);

  if ((count ?? 0) === 0) {
    await context.admin
      .from('motorcyclists')
      .update({
        available: Boolean(rider.is_online),
        updated_at: now.toISOString(),
      })
      .eq('id', rider.id);
  }

  return NextResponse.json({ delivery: updatedDelivery });
}
