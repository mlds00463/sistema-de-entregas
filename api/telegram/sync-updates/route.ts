import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { can } from '@/lib/access';
import { createSupabaseAdmin } from '@/lib/supabaseAdmin';
import { telegramText } from '@/lib/telegram';

export const runtime = 'nodejs';

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat?: {
      id?: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    from?: {
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    text?: string;
  };
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function riderIdFromStart(text?: string | null) {
  const match = (text ?? '').trim().match(/^\/start\s+rider_([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

async function sendTelegramText(botToken: string, chatId: string, body: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: telegramText(body),
      disable_web_page_preview: true,
    }),
  }).catch(() => null);
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonError('Supabase não configurado no servidor.', 500);
  }

  if (!botToken) {
    return jsonError('Telegram ainda não está configurado.', 503);
  }

  const authorization = request.headers.get('authorization') ?? '';
  const userToken = authorization.replace(/^Bearer\s+/i, '').trim();

  if (!userToken) {
    return jsonError('Sessão não enviada para sincronizar Telegram.', 401);
  }

  const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userSupabase.auth.getUser(userToken);
  if (userError || !userData.user) {
    return jsonError('Sessão inválida para sincronizar Telegram.', 401);
  }

  const { data: profile, error: profileError } = await userSupabase
    .from('profiles')
    .select('role,permissions')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  let profileForPermission = profile;
  if (profileError) {
    const { data: fallbackProfile } = await userSupabase
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
    return jsonError('Sem permissão para sincronizar Telegram.', 403);
  }

  const updatesResponse = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?timeout=0`);
  const updatesPayload = await updatesResponse.json().catch(() => null);
  if (!updatesResponse.ok || !updatesPayload?.ok) {
    const description = updatesPayload?.description ?? '';
    if (description.includes('webhook is active')) {
      return NextResponse.json({
        ok: true,
        received: 0,
        linked: 0,
        failed: [],
        mode: 'webhook',
      });
    }

    return jsonError(updatesPayload?.description ?? 'Não foi possível buscar atualizações do Telegram.', 502);
  }

  const updates = (updatesPayload.result ?? []) as TelegramUpdate[];
  const supabase = createSupabaseAdmin() ?? userSupabase;
  const linked: string[] = [];
  const failed: Array<{ riderId: string; error: string }> = [];
  let lastUpdateId = 0;

  for (const update of updates) {
    lastUpdateId = Math.max(lastUpdateId, update.update_id);
    const riderId = riderIdFromStart(update.message?.text);
    const chatId = update.message?.chat?.id;
    if (!riderId || !chatId) continue;

    const from = update.message?.from ?? {};
    const chat = update.message?.chat ?? {};
    const { error } = await supabase
      .from('motorcyclists')
      .update({
        telegram_chat_id: String(chatId),
        telegram_username: from.username ?? chat.username ?? null,
        telegram_first_name: from.first_name ?? chat.first_name ?? null,
        telegram_last_name: from.last_name ?? chat.last_name ?? null,
        telegram_linked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', riderId);

    if (error) {
      failed.push({ riderId, error: error.message });
      await sendTelegramText(botToken, String(chatId), `Nao consegui vincular seu Telegram: ${error.message}`);
      continue;
    }

    linked.push(riderId);
    await sendTelegramText(botToken, String(chatId), 'Telegram conectado ao sistema de entregas. Voce ja pode receber chamadas pelo bot.');
  }

  if (lastUpdateId > 0) {
    await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=0`).catch(() => null);
  }

  return NextResponse.json({
    ok: true,
    received: updates.length,
    linked: linked.length,
    failed,
  });
}
