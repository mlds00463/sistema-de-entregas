import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { can } from '@/lib/access';
import { telegramText } from '@/lib/telegram';

export const runtime = 'nodejs';

type Related<T> = T | T[] | null;

type DeliveryForTelegram = {
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

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function buildTelegramMessage(delivery: DeliveryForTelegram, dashboardUrl: string) {
  const shop = firstRelated(delivery.shops);
  const shopName = telegramText(shop?.name ?? 'Loja', 120);
  const destination = telegramText(delivery.destination_address, 600);

  return telegramText(
    [
      'Nova corrida disponivel.',
      '',
      `Loja: ${shopName}`,
      `Destino: ${destination}`,
      '',
      'Use os botoes abaixo ou abra o sistema:',
      dashboardUrl,
    ].join('\n')
  );
}

async function sendTelegramMessage(input: {
  botToken: string;
  chatId: string;
  text: string;
  deliveryId: string;
}) {
  const response = await fetch(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: input.text,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Aceitar', callback_data: `delivery:accept:${input.deliveryId}` },
            { text: 'Recusar', callback_data: `delivery:reject:${input.deliveryId}` },
          ],
        ],
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
    return jsonError('Sessão não enviada para chamar pelo Telegram.', 401);
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
    return jsonError('Sessão inválida para chamar pelo Telegram.', 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role,permissions')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  let profileForPermission = profile;
  if (profileError) {
    const { data: fallbackProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', userData.user.id)
      .maybeSingle();

    profileForPermission = fallbackProfile
      ? { ...fallbackProfile, permissions: null }
      : null;
  }

  if (!profileForPermission) {
    const metadataRole = userData.user.user_metadata?.role;
    profileForPermission = typeof metadataRole === 'string'
      ? { role: metadataRole, permissions: null }
      : null;
  }

  if (!can(profileForPermission as any, 'chamar_motoqueiro')) {
    return jsonError('Sem permissão para chamar motoqueiro pelo Telegram.', 403);
  }

  const { data, error } = await supabase
    .from('deliveries')
    .select('id,destination_address,status,shops(name),motorcyclists(name,telegram_chat_id)')
    .eq('id', deliveryId)
    .single();

  if (error || !data) {
    return jsonError(error?.message ?? 'Entrega não encontrada.', 404);
  }

  const delivery = data as unknown as DeliveryForTelegram;
  const driver = firstRelated(delivery.motorcyclists);

  if (!driver?.telegram_chat_id) {
    return jsonError('Motoqueiro ainda não conectou o Telegram. Envie o link de conexão pelo cadastro de motoqueiros.', 422);
  }

  if (!['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status)) {
    return jsonError('Entrega ainda não está vinculada a um motoqueiro ativo.', 422);
  }

  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin}/motoqueiro/dashboard`;
  const { response, payload } = await sendTelegramMessage({
    botToken,
    chatId: driver.telegram_chat_id,
    deliveryId: delivery.id,
    text: buildTelegramMessage(delivery, dashboardUrl),
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
