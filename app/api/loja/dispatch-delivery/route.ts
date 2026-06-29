import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/access';
import { getRouteContext, jsonError } from '@/lib/serverAuth';
import { telegramText } from '@/lib/telegram';

export const runtime = 'nodejs';

type Related<T> = T | T[] | null;

type DeliveryForDispatch = {
  id: string;
  shop_id: string;
  motorcyclist_id: string | null;
  status: string;
  departed_at: string | null;
  destination_address: string;
  customer_name: string | null;
  customer_phone: string | null;
  shops: Related<{
    id: string;
    created_by: string | null;
    name: string | null;
    address: string | null;
    city: string | null;
  }>;
  motorcyclists: Related<{
    name: string | null;
    telegram_chat_id: string | null;
  }>;
};

function firstRelated<T>(value: Related<T>) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function canDispatchDelivery(context: Awaited<ReturnType<typeof getRouteContext>>, delivery: DeliveryForDispatch) {
  if ('error' in context) return false;
  if (context.role === 'ADMIN_MASTER') return true;

  const shop = firstRelated(delivery.shops);
  const sameProfileStore = Boolean(context.profile.store_id && context.profile.store_id === delivery.shop_id);
  const ownsShop = Boolean(shop?.created_by && shop.created_by === context.profile.id);

  if (context.role === 'LOJISTA') {
    return sameProfileStore || ownsShop;
  }

  if (context.role === 'COLABORADOR_LOJISTA') {
    return sameProfileStore && (
      can(context.profile, 'chamar_motoqueiro') || can(context.profile, 'editar_pedidos')
    );
  }

  return false;
}

async function sendDispatchTelegram(delivery: DeliveryForDispatch) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const shop = firstRelated(delivery.shops);
  const rider = firstRelated(delivery.motorcyclists);

  if (!botToken || !rider?.telegram_chat_id) return false;

  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/motoqueiro/dashboard`;
  const body = [
    'PEDIDO DESPACHADO',
    '',
    `Loja: ${shop?.name ?? 'Loja'}`,
    '',
    shop?.address ? ['Retirada:', `${shop.address}${shop.city ? `, ${shop.city}` : ''}`].join('\n') : null,
    '',
    'Destino:',
    delivery.destination_address,
    '',
    delivery.customer_name ? `Cliente: ${delivery.customer_name}` : null,
    delivery.customer_phone ? `Telefone: ${delivery.customer_phone}` : null,
    '',
    'Proximo passo:',
    'Siga para o destino.',
    'Quando estiver perto, o sistema libera ENTREGUE.',
    '',
    'Painel do motoqueiro:',
    dashboardUrl || null,
  ].filter(Boolean).join('\n');

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: rider.telegram_chat_id,
      text: telegramText(body),
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Entregue', callback_data: `delivery:delivered:${delivery.id}` },
        ]],
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    console.error('Erro ao avisar despacho no Telegram:', payload?.description ?? response.statusText);
    return false;
  }

  return true;
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
    .select('id,shop_id,motorcyclist_id,status,departed_at,destination_address,customer_name,customer_phone,shops(id,created_by,name,address,city),motorcyclists(name,telegram_chat_id)')
    .eq('id', deliveryId)
    .maybeSingle();

  if (deliveryError) return jsonError(deliveryError.message, 400);
  if (!deliveryData) return jsonError('Pedido não encontrado.', 404);

  const delivery = deliveryData as unknown as DeliveryForDispatch;

  if (!canDispatchDelivery(context, delivery)) {
    return jsonError('Sem permissão para despachar este pedido.', 403);
  }

  if (delivery.status !== 'accepted') {
    return jsonError('Esse pedido precisa estar aceito pelo motoqueiro antes de ser despachado.', 409);
  }

  const now = new Date().toISOString();
  const { data: updatedDelivery, error: updateError } = await context.admin
    .from('deliveries')
    .update({
      status: 'out_for_delivery',
      departed_at: delivery.departed_at ?? now,
      updated_at: now,
    })
    .eq('id', delivery.id)
    .eq('status', 'accepted')
    .select('*, shops(name,address,city,cnpj,latitude,longitude), motorcyclists(name,phone,latitude,longitude,last_seen,telegram_chat_id,pix_key,pix_key_type,payout_name)')
    .single();

  if (updateError) return jsonError(updateError.message, 400);

  if (delivery.motorcyclist_id) {
    await context.admin
      .from('motorcyclists')
      .update({
        available: false,
        updated_at: now,
      })
      .eq('id', delivery.motorcyclist_id);
  }

  const telegramSent = await sendDispatchTelegram(delivery);

  return NextResponse.json({ delivery: updatedDelivery, telegramSent });
}
