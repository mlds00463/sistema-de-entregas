import { supabase } from '@/lib/supabaseClient';

export async function notifyDeliveryCallByTelegram(deliveryId: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return { ok: false, error: 'Sessão não encontrada para chamar pelo Telegram.' };
  }

  const response = await fetch('/api/telegram/send-delivery-call', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deliveryId }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      error: payload?.error ?? 'Não foi possível enviar pelo Telegram.',
      status: response.status,
    };
  }

  return {
    ok: true,
    data: payload,
  };
}

export async function notifyDeliveryReadyToFinishByTelegram(deliveryId: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return { ok: false, error: 'Sessão não encontrada para avisar pelo Telegram.' };
  }

  const response = await fetch('/api/telegram/send-delivery-finish', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deliveryId }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      error: payload?.error ?? 'Não foi possível avisar pelo Telegram.',
      status: response.status,
    };
  }

  return {
    ok: true,
    data: payload,
  };
}

export async function syncTelegramUpdates() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return { ok: false, error: 'Sessão não encontrada para sincronizar Telegram.' };
  }

  const response = await fetch('/api/telegram/sync-updates', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      error: payload?.error ?? 'Não foi possível sincronizar Telegram.',
      status: response.status,
      data: payload,
    };
  }

  return {
    ok: true,
    data: payload as {
      received: number;
      linked: number;
      failed?: Array<{ riderId: string; error: string }>;
    },
  };
}
