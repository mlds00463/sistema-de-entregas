import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const DEFAULT_MONTHLY_PRICE = 99;
const DEFAULT_TRIAL_DAYS = 7;

type RegisterBody = {
  ownerName?: string;
  email?: string;
  password?: string;
  phone?: string;
  shopName?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipcode?: string;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanDigits(value: string) {
  return value.replace(/\D/g, '');
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isMissingColumn(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === 'PGRST204'
    || error?.message?.toLowerCase().includes('column');
}

export async function POST(request: NextRequest) {
  const admin = createSupabaseAdmin();
  if (!admin) return jsonError('Servidor sem configuração completa do Supabase.', 500);

  const body = await request.json().catch(() => null) as RegisterBody | null;
  const ownerName = cleanText(body?.ownerName);
  const email = cleanText(body?.email).toLowerCase();
  const password = cleanText(body?.password);
  const phone = cleanDigits(cleanText(body?.phone));
  const shopName = cleanText(body?.shopName);
  const address = cleanText(body?.address);
  const city = cleanText(body?.city);
  const state = cleanText(body?.state || 'SP').toUpperCase();

  if (!ownerName) return jsonError('Informe o nome do responsável.');
  if (!email || !email.includes('@')) return jsonError('Informe um e-mail válido.');
  if (password.length < 6) return jsonError('A senha precisa ter pelo menos 6 caracteres.');
  if (phone.length < 10) return jsonError('Informe um telefone válido.');
  if (!shopName) return jsonError('Informe o nome da loja.');
  if (!address) return jsonError('Informe o endereço da loja.');
  if (!city) return jsonError('Informe a cidade da loja.');

  const now = new Date();
  const trialEnd = addDays(now, DEFAULT_TRIAL_DAYS);
  const qrToken = randomUUID().replace(/-/g, '');

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name: ownerName,
      phone,
      role: 'lojista',
      public_register: true,
    },
  });

  if (userError || !userData.user) {
    const message = userError?.message?.toLowerCase().includes('already')
      ? 'Este e-mail já está cadastrado. Use a tela de entrada.'
      : userError?.message ?? 'Não foi possível criar o usuário.';
    return jsonError(message, 400);
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert({
      user_id: userData.user.id,
      role: 'lojista',
      name: ownerName,
      phone,
    })
    .select()
    .single();

  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(userData.user.id);
    return jsonError(profileError?.message ?? 'Não foi possível criar o perfil do lojista.', 400);
  }

  const baseShopPayload = {
    created_by: profile.id,
    name: shopName,
    legal_name: null,
    cnpj: null,
    address,
    number: cleanText(body?.number) || null,
    complement: cleanText(body?.complement) || null,
    neighborhood: cleanText(body?.neighborhood) || null,
    city,
    state,
    zipcode: cleanDigits(cleanText(body?.zipcode)) || null,
    contact_name: ownerName,
    contact_phone: phone,
    contact_email: email,
    payout_amount_per_delivery: 0,
    minimum_guaranteed_deliveries: 10,
    trial_start_date: dateKey(now),
    trial_end_date: dateKey(trialEnd),
    subscription_status: 'trial',
    monthly_price: DEFAULT_MONTHLY_PRICE,
    due_date: dateKey(trialEnd),
    qr_token: qrToken,
    active: true,
  };

  const fullShopPayload = {
    ...baseShopPayload,
    base_monthly_price: DEFAULT_MONTHLY_PRICE,
    discount_type: 'none',
    discount_value: 0,
    billing_note: 'Cadastro público de novo cliente.',
  };

  let shopResult = await admin
    .from('shops')
    .insert(fullShopPayload)
    .select()
    .single();

  if (isMissingColumn(shopResult.error)) {
    shopResult = await admin
      .from('shops')
      .insert(baseShopPayload)
      .select()
      .single();
  }

  if (shopResult.error || !shopResult.data) {
    await admin.auth.admin.deleteUser(userData.user.id);
    return jsonError(shopResult.error?.message ?? 'Não foi possível criar a loja.', 400);
  }

  await admin
    .from('profiles')
    .update({ store_id: shopResult.data.id, updated_at: new Date().toISOString() })
    .eq('id', profile.id);

  const origin = request.nextUrl.origin;
  const riderRegistrationUrl = `${origin}/motoqueiro/cadastro?${new URLSearchParams({
    shopId: shopResult.data.id,
    token: shopResult.data.qr_token,
  }).toString()}`;

  return NextResponse.json({
    ok: true,
    profile,
    shop: shopResult.data,
    loginUrl: `${origin}/auth`,
    riderRegistrationUrl,
    trialEndDate: dateKey(trialEnd),
  });
}
