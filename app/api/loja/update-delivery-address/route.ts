import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/access';
import { getRouteContext, jsonError } from '@/lib/serverAuth';

export const runtime = 'nodejs';

type Related<T> = T | T[] | null;

type DeliveryForEdit = {
  id: string;
  shop_id: string;
  status: string;
  shops: Related<{
    id: string;
    created_by: string | null;
  }>;
};

function firstRelated<T>(value: Related<T>) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function canEditDelivery(context: Awaited<ReturnType<typeof getRouteContext>>, delivery: DeliveryForEdit) {
  if ('error' in context) return false;
  if (context.role === 'ADMIN_MASTER') return true;

  const shop = firstRelated(delivery.shops);
  const sameProfileStore = Boolean(context.profile.store_id && context.profile.store_id === delivery.shop_id);
  const ownsShop = Boolean(shop?.created_by && shop.created_by === context.profile.id);

  if (context.role === 'LOJISTA') return sameProfileStore || ownsShop;
  if (context.role === 'COLABORADOR_LOJISTA') return sameProfileStore && can(context.profile, 'editar_pedidos');

  return false;
}

export async function POST(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;

  const body = await request.json().catch(() => null) as {
    deliveryId?: string;
    originAddress?: string;
    destinationAddress?: string;
    destinationZipcode?: string;
    destinationNumber?: string;
    destinationComplement?: string;
    destinationNeighborhood?: string;
    destinationCity?: string;
    destinationState?: string;
    destinationLatitude?: number | null;
    destinationLongitude?: number | null;
    customerName?: string;
    customerPhone?: string;
  } | null;

  const deliveryId = cleanText(body?.deliveryId);
  const originAddress = cleanText(body?.originAddress);
  const destinationAddress = cleanText(body?.destinationAddress);

  if (!deliveryId) return jsonError('Pedido não informado.');
  if (!originAddress) return jsonError('Informe o endereço de origem.');
  if (!destinationAddress) return jsonError('Informe o endereço de destino.');

  const { data: deliveryData, error: deliveryError } = await context.admin
    .from('deliveries')
    .select('id,shop_id,status,shops(id,created_by)')
    .eq('id', deliveryId)
    .maybeSingle();

  if (deliveryError) return jsonError(deliveryError.message, 400);
  if (!deliveryData) return jsonError('Pedido não encontrado.', 404);

  const delivery = deliveryData as unknown as DeliveryForEdit;

  if (!canEditDelivery(context, delivery)) {
    return jsonError('Sem permissão para editar este pedido.', 403);
  }

  if (['delivered', 'cancelled'].includes(delivery.status)) {
    return jsonError('Pedido entregue ou cancelado não pode ter endereço alterado.', 409);
  }

  const now = new Date().toISOString();
  const { data: updatedDelivery, error } = await context.admin
    .from('deliveries')
    .update({
      origin_address: originAddress,
      destination_address: destinationAddress,
      destination_zipcode: body?.destinationZipcode?.replace(/\D/g, '') || null,
      destination_number: cleanText(body?.destinationNumber) || null,
      destination_complement: cleanText(body?.destinationComplement) || null,
      destination_neighborhood: cleanText(body?.destinationNeighborhood) || null,
      destination_city: cleanText(body?.destinationCity) || null,
      destination_state: cleanText(body?.destinationState).toUpperCase() || null,
      destination_latitude: typeof body?.destinationLatitude === 'number' ? body.destinationLatitude : null,
      destination_longitude: typeof body?.destinationLongitude === 'number' ? body.destinationLongitude : null,
      customer_name: cleanText(body?.customerName) || null,
      customer_phone: cleanText(body?.customerPhone) || null,
      updated_at: now,
    })
    .eq('id', delivery.id)
    .select('*, shops(name,address,city,cnpj,latitude,longitude), motorcyclists(name,phone,latitude,longitude,last_seen,telegram_chat_id,pix_key,pix_key_type,payout_name)')
    .single();

  if (error) return jsonError(error.message, 400);

  return NextResponse.json({ delivery: updatedDelivery });
}
