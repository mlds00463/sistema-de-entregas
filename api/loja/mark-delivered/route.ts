import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/access';
import { getRouteContext, jsonError } from '@/lib/serverAuth';

export const runtime = 'nodejs';

type Related<T> = T | T[] | null;

type DeliveryForFinish = {
  id: string;
  shop_id: string;
  motorcyclist_id: string | null;
  status: string;
  created_at: string;
  departed_at: string | null;
  shops: Related<{
    id: string;
    created_by: string | null;
  }>;
};

function firstRelated<T>(value: Related<T>) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function canFinishDelivery(context: Awaited<ReturnType<typeof getRouteContext>>, delivery: DeliveryForFinish) {
  if ('error' in context) return false;
  if (context.role === 'ADMIN_MASTER') return true;

  const shop = firstRelated(delivery.shops);
  const sameProfileStore = Boolean(context.profile.store_id && context.profile.store_id === delivery.shop_id);
  const ownsShop = Boolean(shop?.created_by && shop.created_by === context.profile.id);

  if (context.role === 'LOJISTA') {
    return sameProfileStore || ownsShop;
  }

  if (context.role === 'COLABORADOR_LOJISTA') {
    return sameProfileStore && can(context.profile, 'editar_pedidos');
  }

  return false;
}

export async function POST(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;

  const body = await request.json().catch(() => null) as { deliveryId?: string } | null;
  const deliveryId = body?.deliveryId;

  if (!deliveryId) {
    return jsonError('Pedido não informado.');
  }

  const { data: deliveryData, error: deliveryError } = await context.admin
    .from('deliveries')
    .select('id,shop_id,motorcyclist_id,status,created_at,departed_at,shops(id,created_by)')
    .eq('id', deliveryId)
    .maybeSingle();

  if (deliveryError) return jsonError(deliveryError.message, 400);
  if (!deliveryData) return jsonError('Pedido não encontrado.', 404);

  const delivery = deliveryData as unknown as DeliveryForFinish;

  if (!canFinishDelivery(context, delivery)) {
    return jsonError('Sem permissão para finalizar este pedido.', 403);
  }

  if (!['accepted', 'out_for_delivery'].includes(delivery.status)) {
    return jsonError('Esse pedido precisa estar aceito ou em rota para ser marcado como entregue.', 409);
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
      departed_at: delivery.departed_at ?? now.toISOString(),
      delivered_at: now.toISOString(),
      total_duration_seconds: totalDurationSeconds,
      updated_at: now.toISOString(),
    })
    .eq('id', delivery.id)
    .in('status', ['accepted', 'out_for_delivery'])
    .select('*, shops(name,address,number,complement,neighborhood,city,state,zipcode,cnpj,latitude,longitude), motorcyclists(id,name,phone,latitude,longitude,last_seen,telegram_chat_id,pix_key,pix_key_type,payout_name)')
    .single();

  if (updateError) return jsonError(updateError.message, 400);

  if (delivery.motorcyclist_id) {
    const { count } = await context.admin
      .from('deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('motorcyclist_id', delivery.motorcyclist_id)
      .in('status', ['assigned', 'accepted', 'out_for_delivery']);

    if ((count ?? 0) === 0) {
      const { data: rider } = await context.admin
        .from('motorcyclists')
        .select('is_online')
        .eq('id', delivery.motorcyclist_id)
        .maybeSingle();

      await context.admin
        .from('motorcyclists')
        .update({
          available: Boolean(rider?.is_online),
          updated_at: now.toISOString(),
        })
        .eq('id', delivery.motorcyclist_id);
    }
  }

  return NextResponse.json({ delivery: updatedDelivery });
}
