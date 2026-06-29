import { NextRequest, NextResponse } from 'next/server';
import { getRouteContext, jsonError } from '@/lib/serverAuth';
import { telegramText } from '@/lib/telegram';

export const runtime = 'nodejs';

type Related<T> = T | T[] | null;

type DeliveryForComplete = {
  id: string;
  destination_address: string;
  status: string;
  shops: Related<{ name: string | null }>;
  motorcyclists: Related<{
    name: string | null;
    telegram_chat_id: string | null;
  }>;
};

function firstRelated<T>(value: Related<T>) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function POST(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return jsonError('Telegram ainda não está configurado.', 503);

  const body = await request.json().catch(() => null) as { deliveryId?: string; source?: string } | null;
  const deliveryId = body?.deliveryId;

  if (!deliveryId) return jsonError('Entrega não informada.');

  const { data, error } = await context.admin
    .from('deliveries')
    .select('id,destination_address,status,shops(name),motorcyclists(name,telegram_chat_id)')
    .eq('id', deliveryId)
    .maybeSingle();

  if (error) return jsonError(error.message, 400);
  if (!data) return jsonError('Entrega não encontrada.', 404);

  const delivery = data as unknown as DeliveryForComplete;
  const driver = firstRelated(delivery.motorcyclists);
  const shop = firstRelated(delivery.shops);

  if (delivery.status !== 'delivered') {
    return jsonError('A entrega ainda não foi finalizada.', 409);
  }

  if (!driver?.telegram_chat_id) {
    return NextResponse.json({ ok: true, telegramSent: false, reason: 'Motoqueiro sem Telegram conectado.' });
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: driver.telegram_chat_id,
      text: telegramText([
        'ENTREGA FINALIZADA',
        '',
        `Loja: ${shop?.name ?? 'Loja'}`,
        '',
        'Destino:',
        delivery.destination_address,
        '',
        body?.source === 'shop'
          ? 'A loja marcou este pedido como entregue.'
          : 'Entrega concluida. Voce ficou disponivel para novas corridas.',
      ].join('\n')),
      disable_web_page_preview: true,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json({ error: payload?.description ?? 'Telegram recusou o envio.', details: payload }, { status: 502 });
  }

  return NextResponse.json({ ok: true, telegramSent: true, telegram: payload });
}
