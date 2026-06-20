import { NextRequest, NextResponse } from 'next/server';
import { can, isAdminMaster, isCollaborator, isShopOwner } from '@/lib/access';
import { getRouteContext, jsonError } from '@/lib/serverAuth';
import type { Delivery, DriverLocationPoint, Motorcyclist } from '@/lib/types';

type DeliveryForAccess = Pick<Delivery, 'id' | 'shop_id' | 'motorcyclist_id'>;
type RiderForAccess = Pick<Motorcyclist, 'id' | 'current_shop_id'>;

function canReadRiderPoints(
  context: Awaited<ReturnType<typeof getRouteContext>>,
  rider: RiderForAccess | null,
  delivery: DeliveryForAccess | null
) {
  if ('error' in context) return false;
  if (isAdminMaster(context.profile)) return true;

  const storeId = context.profile.store_id;
  const shopId = delivery?.shop_id ?? rider?.current_shop_id ?? null;
  if (!storeId || shopId !== storeId) return false;

  if (isShopOwner(context.profile)) return true;
  if (isCollaborator(context.profile)) return can(context.profile, 'ver_pedidos') || can(context.profile, 'ver_relatorios');

  return false;
}

export async function GET(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;

  const searchParams = request.nextUrl.searchParams;
  const motorcyclistId = searchParams.get('motorcyclistId');
  const deliveryId = searchParams.get('deliveryId');
  const startAt = searchParams.get('startAt');
  const endAt = searchParams.get('endAt');

  if (!motorcyclistId) {
    return jsonError('Motoqueiro não informado.', 400);
  }

  let delivery: DeliveryForAccess | null = null;
  if (deliveryId) {
    const { data, error } = await context.admin
      .from('deliveries')
      .select('id, shop_id, motorcyclist_id')
      .eq('id', deliveryId)
      .maybeSingle<DeliveryForAccess>();

    if (error) return jsonError('Não foi possível validar a corrida.', 500);
    delivery = data ?? null;

    if (delivery && delivery.motorcyclist_id !== motorcyclistId) {
      return jsonError('Motoqueiro não pertence a esta corrida.', 403);
    }
  }

  const { data: rider, error: riderError } = await context.admin
    .from('motorcyclists')
    .select('id, current_shop_id')
    .eq('id', motorcyclistId)
    .maybeSingle<RiderForAccess>();

  if (riderError) return jsonError('Não foi possível validar o motoqueiro.', 500);
  if (!rider) return jsonError('Motoqueiro não encontrado.', 404);
  if (!canReadRiderPoints(context, rider, delivery)) {
    return jsonError('Sem permissão para ver o rastro do motoqueiro.', 403);
  }

  let query = context.admin
    .from('driver_location_points')
    .select('*')
    .eq('motorcyclist_id', motorcyclistId)
    .order('recorded_at', { ascending: true });

  if (startAt) query = query.gte('recorded_at', startAt);
  if (endAt) query = query.lte('recorded_at', endAt);

  const { data, error } = await query.returns<DriverLocationPoint[]>();
  if (error) return jsonError('Não foi possível carregar o rastro do motoqueiro.', 500);

  return NextResponse.json({ points: data ?? [] });
}
