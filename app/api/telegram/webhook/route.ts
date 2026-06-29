import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabaseAdmin';
import { telegramText } from '@/lib/telegram';

export const runtime = 'nodejs';

type TelegramUser = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChat = {
  id?: number;
  type?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  message_id?: number;
  from?: TelegramUser;
  chat?: TelegramChat;
  text?: string;
  date?: number;
};

type TelegramCallbackQuery = {
  id?: string;
  from?: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

type TelegramWebhookPayload = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type DriverCommand = 'available' | 'accept' | 'reject' | 'departed' | 'arrived' | 'delivered' | 'summary';

type DriverCommandResult = {
  ok?: boolean;
  command?: DriverCommand;
  delivery_id?: string;
  next_delivery_id?: string | null;
  message?: string;
  motorcyclist_id?: string;
};

type DeliveryForReject = {
  id: string;
  shop_id: string;
  motorcyclist_id: string | null;
  origin_address: string;
  destination_address: string;
  destination_zipcode: string | null;
  destination_number: string | null;
  destination_complement: string | null;
  destination_neighborhood: string | null;
  destination_city: string | null;
  destination_state: string | null;
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_by: string | null;
};

type TelegramReplyMarkup = {
  inline_keyboard: Array<Array<{
    text: string;
    callback_data: string;
  }>>;
};

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

function normalizeCommandText(value?: string | null) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function identifyDriverCommand(value?: string | null): DriverCommand | null {
  const text = normalizeCommandText(value);
  if (!text) return null;

  if (text.startsWith('/start')) return 'available';
  if (/^(financeiro|relatorio|relatorio do dia|resumo|ganhos|corridas do dia)\b/.test(text)) return 'summary';
  if (/\b(disponivel|online|livre|cheguei na loja|estou disponivel)\b/.test(text)) return 'available';
  if (/^(aceitar|aceito|sim|ok|confirmo|confirmar|pego|vou fazer)\b/.test(text)) return 'accept';
  if (/^(recusar|recuso|nao posso|nao vou|rejeitar|rejeito|cancelar)\b/.test(text)) return 'reject';
  if (/\b(saiu|sai para entrega|sai pra entrega|estou saindo|peguei|retirei|em rota)\b/.test(text)) return 'departed';
  if (/\b(cheguei|cheguei no cliente|estou no cliente|no cliente)\b/.test(text)) return 'arrived';
  if (/\b(entregue|entreguei|finalizar|finalizei|concluir|concluido|concluida)\b/.test(text)) return 'delivered';

  return null;
}

function commandFromCallback(data?: string | null): DriverCommand | null {
  const [, command] = (data ?? '').split(':');
  if (['accept', 'reject', 'delivered'].includes(command)) {
    return command as DriverCommand;
  }
  return null;
}

function deliveryIdFromCallback(data?: string | null) {
  const [, , deliveryId] = (data ?? '').split(':');
  return deliveryId || null;
}

function startPayloadFromMessage(text?: string | null) {
  const match = (text ?? '').trim().match(/^\/start\s+(.+)$/);
  return match?.[1] ?? null;
}

function riderIdFromStartPayload(payload?: string | null) {
  const match = (payload ?? '').match(/^rider_([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

function buildReplyText(result: DriverCommandResult, fallbackMessage?: string | null) {
  if (result.ok) {
    if (result.command === 'available') {
      return [
        'DISPONIBILIDADE CONFIRMADA',
        '',
        'Voce esta online no sistema.',
        'Quando houver corrida, ela aparece aqui no Telegram.',
      ].join('\n');
    }
    if (result.command === 'accept') {
      return [
        'CORRIDA ACEITA',
        '',
        'Aguarde a loja despachar o pedido.',
        '',
        'Proximo passo:',
        'Quando a loja despachar, voce recebera os dados finais da entrega.',
      ].join('\n');
    }
    if (result.command === 'reject') {
      return [
        'CORRIDA RECUSADA',
        '',
        'Tudo certo. Vamos chamar o proximo motoqueiro disponivel.',
      ].join('\n');
    }
    if (result.command === 'departed') return 'A saida agora deve ser registrada pela loja.';
    if (result.command === 'arrived') return 'A chegada agora e liberada automaticamente pelo mapa.';
    if (result.command === 'delivered') {
      return [
        'ENTREGA FINALIZADA',
        '',
        'Voce ficou disponivel para novas corridas.',
      ].join('\n');
    }
    if (result.command === 'summary') return result.message ?? 'Resumo enviado.';
  }

  return result.message
    ? ['NAO CONSEGUI CONCLUIR', '', result.message].join('\n')
    : [
        'MENSAGEM RECEBIDA',
        '',
        fallbackMessage ?? 'sem texto',
        '',
        'Comandos validos:',
        'DISPONIVEL, ACEITAR, RECUSAR e ENTREGUE.',
      ].join('\n');
}

function saoPauloTodayRange() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  const dateKey = `${year}-${month}-${day}`;

  return {
    dateKey,
    start: new Date(`${dateKey}T00:00:00-03:00`).toISOString(),
    end: new Date(`${dateKey}T23:59:59.999-03:00`).toISOString(),
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

async function sendDailyDriverSummary(chatId: string) {
  const supabase = createSupabaseAdmin();
  if (!supabase) return;

  const { data: rider, error: riderError } = await supabase
    .from('motorcyclists')
    .select('id, name')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (riderError || !rider) {
    await sendTelegramText(chatId, 'Nao encontrei seu cadastro pelo Telegram. Abra seu link/QR de conexao novamente.');
    return;
  }

  const range = saoPauloTodayRange();
  const { data: deliveries, error } = await supabase
    .from('deliveries')
    .select('id, status, created_at, delivered_at, total_duration_seconds, destination_address, shops(name, payout_amount_per_delivery)')
    .eq('motorcyclist_id', rider.id)
    .gte('created_at', range.start)
    .lte('created_at', range.end)
    .order('created_at', { ascending: false });

  if (error) {
    await sendTelegramText(chatId, `Nao consegui gerar seu resumo: ${error.message}`);
    return;
  }

  const rows = deliveries ?? [];
  const delivered = rows.filter((delivery) => delivery.status === 'delivered');
  const running = rows.filter((delivery) => ['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status));
  const rejected = rows.filter((delivery) => delivery.status === 'rejected');
  const payout = delivered.reduce((total, delivery) => {
    const shop = Array.isArray(delivery.shops) ? delivery.shops[0] : delivery.shops;
    return total + Number(shop?.payout_amount_per_delivery ?? 0);
  }, 0);

  const lastRows = rows.slice(0, 5).map((delivery, index) => {
    const shop = Array.isArray(delivery.shops) ? delivery.shops[0] : delivery.shops;
    const statusLabel = delivery.status === 'delivered'
      ? 'Entregue'
      : delivery.status === 'rejected'
        ? 'Recusada'
        : ['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status)
          ? 'Em andamento'
          : delivery.status;
    return [
      `${index + 1}. ${shop?.name ?? 'Loja'} - ${statusLabel}`,
      `   ${delivery.destination_address ?? '-'}`,
    ].join('\n');
  });

  await sendTelegramText(
    chatId,
    [
      'RESUMO DO DIA',
      range.dateKey,
      '',
      `Motoqueiro: ${rider.name ?? '-'}`,
      '',
      `Chamadas: ${rows.length}`,
      `Entregues: ${delivered.length}`,
      `Em andamento: ${running.length}`,
      `Recusadas: ${rejected.length}`,
      `Ganhos estimados: ${formatCurrency(payout)}`,
      '',
      lastRows.length ? `Ultimas corridas:\n${lastRows.join('\n\n')}` : 'Nenhuma corrida registrada hoje.',
    ].join('\n')
  );
}

function nextStepKeyboard(command?: DriverCommand | null, deliveryId?: string | null): TelegramReplyMarkup | undefined {
  if (!deliveryId) return undefined;

  if (command === 'arrived') {
    return {
      inline_keyboard: [[
        { text: 'Entregue', callback_data: `delivery:delivered:${deliveryId}` },
      ]],
    };
  }

  return undefined;
}

async function sendTelegramText(chatId: string, body: string, replyMarkup?: TelegramReplyMarkup) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: telegramText(body),
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    console.error('Erro ao responder Telegram:', payload?.description ?? response.statusText);
  }
}

function buildDeliveryCallText(delivery: DeliveryForTelegram) {
  const shop = firstRelated(delivery.shops);
  const shopName = telegramText(shop?.name ?? 'Loja', 120);
  const destination = telegramText(delivery.destination_address, 600);
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://sistemas-pi.vercel.app'}/motoqueiro/dashboard`;

  return telegramText(
    [
      'NOVA CORRIDA DISPONIVEL',
      '',
      `Loja: ${shopName}`,
      '',
      'Destino:',
      destination,
      '',
      'Escolha uma opcao:',
      '- Aceitar: pega a corrida',
      '- Recusar: chama o proximo motoqueiro',
      '',
      'Painel do motoqueiro:',
      dashboardUrl,
    ].join('\n')
  );
}

async function notifyAssignedDelivery(deliveryId?: string | null) {
  if (!deliveryId) return;

  const supabase = createSupabaseAdmin();
  if (!supabase) return;

  const { data, error } = await supabase
    .from('deliveries')
    .select('id,destination_address,status,shops(name),motorcyclists(name,telegram_chat_id)')
    .eq('id', deliveryId)
    .maybeSingle();

  if (error || !data) {
    console.error('Erro ao buscar proxima entrega para Telegram:', error?.message ?? 'Entrega nao encontrada');
    return;
  }

  const delivery = data as unknown as DeliveryForTelegram;
  const driver = firstRelated(delivery.motorcyclists);
  if (!driver?.telegram_chat_id || delivery.status !== 'assigned') return;

  await sendTelegramText(
    driver.telegram_chat_id,
    buildDeliveryCallText(delivery),
    {
      inline_keyboard: [[
        { text: 'Aceitar', callback_data: `delivery:accept:${delivery.id}` },
        { text: 'Recusar', callback_data: `delivery:reject:${delivery.id}` },
      ]],
    }
  );
}

async function rejectDeliveryFromTelegram(chatId: string, deliveryId?: string | null): Promise<DriverCommandResult> {
  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return { ok: false, command: 'reject', message: 'Servidor sem acesso administrativo ao Supabase.' };
  }

  const { data: rider, error: riderError } = await supabase
    .from('motorcyclists')
    .select('id,current_shop_id,is_online')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (riderError || !rider) {
    return { ok: false, command: 'reject', message: 'Nao encontrei seu cadastro pelo Telegram.' };
  }

  let query = supabase
    .from('deliveries')
    .select([
      'id',
      'shop_id',
      'motorcyclist_id',
      'origin_address',
      'destination_address',
      'destination_zipcode',
      'destination_number',
      'destination_complement',
      'destination_neighborhood',
      'destination_city',
      'destination_state',
      'destination_latitude',
      'destination_longitude',
      'customer_name',
      'customer_phone',
      'created_by',
    ].join(','))
    .eq('motorcyclist_id', rider.id)
    .eq('status', 'assigned')
    .order('assigned_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (deliveryId) query = query.eq('id', deliveryId);

  const { data: deliveryRows, error: deliveryError } = await query.returns<DeliveryForReject[]>();
  const delivery = deliveryRows?.[0];

  if (deliveryError || !delivery) {
    return { ok: false, command: 'reject', message: deliveryError?.message ?? 'Nenhuma corrida pendente para recusar.' };
  }

  const { error: rejectError } = await supabase
    .from('deliveries')
    .update({
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', delivery.id)
    .eq('motorcyclist_id', rider.id)
    .eq('status', 'assigned');

  if (rejectError) {
    return { ok: false, command: 'reject', delivery_id: delivery.id, message: rejectError.message };
  }

  await supabase
    .from('motorcyclists')
    .update({ available: true, updated_at: new Date().toISOString() })
    .eq('id', rider.id)
    .eq('is_online', true);

  const { data: nextRider } = await supabase
    .from('motorcyclists')
    .select('id')
    .eq('current_shop_id', delivery.shop_id)
    .eq('is_online', true)
    .eq('available', true)
    .neq('id', rider.id)
    .order('last_assigned_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let nextDeliveryId: string | null = null;

  if (nextRider?.id) {
    await supabase
      .from('motorcyclists')
      .update({
        available: false,
        last_assigned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', nextRider.id);

    const { data: inserted } = await supabase
      .from('deliveries')
      .insert({
        shop_id: delivery.shop_id,
        motorcyclist_id: nextRider.id,
        origin_address: delivery.origin_address,
        destination_address: delivery.destination_address,
        destination_zipcode: delivery.destination_zipcode,
        destination_number: delivery.destination_number,
        destination_complement: delivery.destination_complement,
        destination_neighborhood: delivery.destination_neighborhood,
        destination_city: delivery.destination_city,
        destination_state: delivery.destination_state,
        destination_latitude: delivery.destination_latitude ?? null,
        destination_longitude: delivery.destination_longitude ?? null,
        customer_name: delivery.customer_name,
        customer_phone: delivery.customer_phone,
        status: 'assigned',
        assigned_at: new Date().toISOString(),
        created_by: delivery.created_by,
      })
      .select('id')
      .single();

    nextDeliveryId = inserted?.id ?? null;
  }

  return {
    ok: true,
    command: 'reject',
    delivery_id: delivery.id,
    next_delivery_id: nextDeliveryId,
    motorcyclist_id: rider.id,
    message: 'Corrida recusada.',
  };
}

async function clearMessageKeyboard(chatId?: string | number | null, messageId?: number | null) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !chatId || !messageId) return;

  await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [],
      },
    }),
  }).catch(() => null);
}

async function answerCallbackQuery(callbackQueryId?: string | null, text?: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !callbackQueryId) return;

  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text ?? 'Recebido.',
    }),
  }).catch(() => null);
}

async function saveTelegramEvent(payload: TelegramWebhookPayload) {
  const supabase = createSupabaseAdmin();
  if (!supabase) return;

  const message = payload.message ?? payload.callback_query?.message ?? null;
  const callback = payload.callback_query ?? null;
  const chat = message?.chat ?? null;
  const from = payload.message?.from ?? payload.callback_query?.from ?? null;

  const { error } = await supabase.from('telegram_events').insert({
    update_id: payload.update_id ?? null,
    chat_id: chat?.id ? String(chat.id) : null,
    telegram_user_id: from?.id ? String(from.id) : null,
    username: from?.username ?? chat?.username ?? null,
    first_name: from?.first_name ?? chat?.first_name ?? null,
    last_name: from?.last_name ?? chat?.last_name ?? null,
    message_text: payload.message?.text ?? null,
    callback_data: callback?.data ?? null,
    payload,
  });

  if (error) {
    console.error('Erro ao salvar evento do Telegram:', error.message);
  }
}

async function linkRiderFromStart(payload: TelegramWebhookPayload) {
  const message = payload.message;
  const chatId = message?.chat?.id;
  const riderId = riderIdFromStartPayload(startPayloadFromMessage(message?.text));
  if (!chatId || !riderId) return false;

  const supabase = createSupabaseAdmin();
  if (!supabase) return false;

  const from = message?.from ?? {};
  const { error } = await supabase
    .from('motorcyclists')
    .update({
      telegram_chat_id: String(chatId),
      telegram_username: from.username ?? message?.chat?.username ?? null,
      telegram_first_name: from.first_name ?? message?.chat?.first_name ?? null,
      telegram_last_name: from.last_name ?? message?.chat?.last_name ?? null,
      telegram_linked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', riderId);

  if (error) {
    await sendTelegramText(String(chatId), `Nao consegui vincular seu Telegram: ${error.message}`);
    return true;
  }

  await sendTelegramText(
    String(chatId),
    [
      'TELEGRAM CONECTADO',
      '',
      'Seu cadastro foi vinculado ao sistema de entregas.',
      '',
      'Quando chegar na loja, responda:',
      'DISPONIVEL',
    ].join('\n')
  );
  return true;
}

async function processDriverCommand(payload: TelegramWebhookPayload) {
  const message = payload.message;
  const callback = payload.callback_query;
  const chatId = message?.chat?.id ?? callback?.message?.chat?.id;

  if (!chatId) return;

  const command = callback
    ? commandFromCallback(callback.data)
    : identifyDriverCommand(message?.text);
  const callbackDeliveryId = callback ? deliveryIdFromCallback(callback.data) : null;

  if (!command) return;

  const supabase = createSupabaseAdmin();
  if (!supabase) return;

  if (command === 'summary') {
    if (callback) {
      await answerCallbackQuery(callback.id, 'Gerando resumo.');
      await clearMessageKeyboard(chatId, callback.message?.message_id);
    }
    await sendDailyDriverSummary(String(chatId));
    return;
  }

  if (command === 'departed' || command === 'arrived') {
    if (callback) {
      await answerCallbackQuery(callback.id, 'Etapa atualizada no fluxo.');
      await clearMessageKeyboard(chatId, callback.message?.message_id);
    }

    await sendTelegramText(
      String(chatId),
      command === 'departed'
        ? [
            'AGUARDE A LOJA',
            '',
            'A saida para entrega agora e despachada pela loja.',
            'Assim que o pedido sair, voce recebe a orientacao aqui.',
          ].join('\n')
        : [
            'CHEGADA AUTOMATICA',
            '',
            'A chegada agora e detectada pelo mapa.',
            'Quando estiver perto do destino, o sistema libera ENTREGUE.',
          ].join('\n')
    );
    return;
  }

  const manualRejectResult = command === 'reject'
    ? await rejectDeliveryFromTelegram(String(chatId), callbackDeliveryId)
    : null;

  const rpcResult = manualRejectResult ? { data: manualRejectResult, error: null } : await supabase.rpc('telegram_handle_driver_command', {
    telegram_chat_id_input: String(chatId),
    command_input: callbackDeliveryId ? `${command}:${callbackDeliveryId}` : command,
  });
  const { data, error } = rpcResult;

  if (callback) {
    await answerCallbackQuery(callback.id, error ? 'Nao consegui processar.' : 'Processado.');
    await clearMessageKeyboard(chatId, callback.message?.message_id);
  }

  if (error) {
    console.error('Erro ao processar comando Telegram:', error.message);
    await sendTelegramText(String(chatId), `Nao consegui processar seu comando: ${error.message}`);
    return;
  }

  const result = (data ?? {}) as DriverCommandResult;
  if (result.ok && result.command === 'reject' && result.next_delivery_id) {
    await notifyAssignedDelivery(result.next_delivery_id);
  }

  await sendTelegramText(
    String(chatId),
    buildReplyText(result, message?.text ?? callback?.data),
    result.ok ? nextStepKeyboard(result.command ?? command, result.delivery_id ?? callbackDeliveryId) : undefined
  );
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token');

  if (configuredSecret && receivedSecret !== configuredSecret) {
    return NextResponse.json({ error: 'Token de webhook invalido.' }, { status: 403 });
  }

  const payload = await request.json().catch(() => null) as TelegramWebhookPayload | null;

  if (!payload) {
    return NextResponse.json({ error: 'Payload invalido.' }, { status: 400 });
  }

  await saveTelegramEvent(payload);
  const linked = await linkRiderFromStart(payload);
  if (!linked) await processDriverCommand(payload);

  return NextResponse.json({ ok: true });
}
