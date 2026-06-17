import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { telegramText } from '@/lib/telegram';

export const runtime = 'nodejs';

type Related<T> = T | T[] | null;

type DeliveryForTelegram = {
  id: string;
  destination_address: string;
  status: string;
  arrival_notified_at: string | null;
  motorcyclists: Related<{
    name: string | null;
    telegram_chat_id: string | null;
  }>;
};

function firstRelated<T>(value: Related<T>) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function sendFinishMessage(input: {
  botToken: string;
  chatId: string;
  deliveryId: string;
  destinationAddress: string;
}) {
  const response = await fetch(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: telegramText([
        'Chegada detectada no destino.',
        `Destino: ${input.destinationAddress}`,
        '',
        'Agora voce pode finalizar esta corrida.',
      ].join('\n')),
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Entregue', callback_data: `delivery:delivered:${input.deliveryId}` },
        ]],
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  return { response, payload };
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonError('Supabase não configurado no servidor.', 500);
  }

  if (!botToken) {
    return jsonError('Telegram ainda não está configurado na Vercel.', 503);
  }

  const authorization = request.headers.get('authorization') ?? '';
  const userToken = authorization.replace(/^Bearer\s+/i, '').trim();

  if (!userToken) {
    return jsonError('Sessão não enviada para avisar pelo Telegram.', 401);
  }

  const body = await request.json().catch(() => null) as { deliveryId?: string } | null;
  const deliveryId = body?.deliveryId;

  if (!deliveryId) {
    return jsonError('Entrega não informada.');
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(userToken);
  if (userError || !userData.user) {
    return jsonError('Sessão inválida para avisar pelo Telegram.', 401);
  }

  const { data, error } = await supabase
    .from('deliveries')
    .select('id,destination_address,status,arrival_notified_at,motorcyclists(name,telegram_chat_id)')
    .eq('id', deliveryId)
    .single();

  if (error || !data) {
    return jsonError(error?.message ?? 'Entrega não encontrada.', 404);
  }

  const delivery = data as unknown as DeliveryForTelegram;
  const driver = firstRelated(delivery.motorcyclists);

  if (delivery.status !== 'out_for_delivery' || !delivery.arrival_notified_at) {
    return jsonError('A entrega ainda não está liberada para finalizar.', 422);
  }

  if (!driver?.telegram_chat_id) {
    return jsonError('Motoqueiro ainda não conectou o Telegram.', 422);
  }

  const { response, payload } = await sendFinishMessage({
    botToken,
    chatId: driver.telegram_chat_id,
    deliveryId: delivery.id,
    destinationAddress: delivery.destination_address,
  });

  if (!response.ok) {
    const description = payload?.description ?? 'Telegram recusou o envio da mensagem.';
    return NextResponse.json({ error: description, details: payload }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    motorcyclistName: driver.name,
    telegramChatId: driver.telegram_chat_id,
    telegram: payload,
  });
}
