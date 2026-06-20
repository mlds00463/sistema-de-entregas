import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

export async function POST(request: NextRequest) {
  const admin = createSupabaseAdmin();
  if (!admin) return jsonError('Servidor sem configuração completa do Supabase.', 500);

  const body = await request.json().catch(() => null) as {
    shopId?: string;
    token?: string;
    name?: string;
    phone?: string;
  } | null;

  const shopId = cleanText(body?.shopId);
  const token = cleanText(body?.token);
  const name = cleanText(body?.name);
  const phone = cleanText(body?.phone);
  const phoneDigits = normalizePhone(phone);

  if (!shopId || !token) return jsonError('QR Code da loja inválido.');
  if (!name) return jsonError('Informe seu nome.');
  if (phoneDigits.length < 10) return jsonError('Informe um telefone válido.');

  const { data: shop, error: shopError } = await admin
    .from('shops')
    .select('id,name,qr_token,active')
    .eq('id', shopId)
    .eq('qr_token', token)
    .maybeSingle();

  if (shopError) return jsonError(shopError.message, 400);
  if (!shop || shop.active === false) return jsonError('Loja não encontrada ou inativa.', 404);

  const { data: existingRider } = await admin
    .from('motorcyclists')
    .select('id,profile_id')
    .eq('phone', phoneDigits)
    .maybeSingle();

  if (existingRider?.id) {
    const { data: motorcyclist, error } = await admin
      .from('motorcyclists')
      .update({
        name,
        phone: phoneDigits,
        current_shop_id: shop.id,
        active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingRider.id)
      .select()
      .single();

    if (error) return jsonError(error.message, 400);

    await admin
      .from('profiles')
      .update({ name, phone: phoneDigits, store_id: shop.id, updated_at: new Date().toISOString() })
      .eq('id', existingRider.profile_id);

    return NextResponse.json({
      motorcyclist,
      shop,
      generatedCredentials: null,
      telegramStartPayload: `rider_${motorcyclist.id}`,
    });
  }

  const email = `motoqueiro-${phoneDigits}-${randomUUID().slice(0, 8)}@mr-entregas.app`;
  const password = `MR-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name,
      phone: phoneDigits,
      role: 'motoqueiro',
      quick_register: true,
    },
  });

  if (userError || !userData.user) {
    return jsonError(userError?.message ?? 'Não foi possível criar o acesso do motoqueiro.', 400);
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert({
      user_id: userData.user.id,
      role: 'motoqueiro',
      store_id: shop.id,
      name,
      phone: phoneDigits,
    })
    .select()
    .single();

  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(userData.user.id);
    return jsonError(profileError?.message ?? 'Não foi possível criar o perfil do motoqueiro.', 400);
  }

  const { data: motorcyclist, error: riderError } = await admin
    .from('motorcyclists')
    .insert({
      profile_id: profile.id,
      name,
      phone: phoneDigits,
      payout_name: name,
      current_shop_id: shop.id,
      active: true,
    })
    .select()
    .single();

  if (riderError || !motorcyclist) {
    await admin.auth.admin.deleteUser(userData.user.id);
    return jsonError(riderError?.message ?? 'Não foi possível cadastrar o motoqueiro.', 400);
  }

  return NextResponse.json({
    motorcyclist,
    shop,
    generatedCredentials: { email, password },
    telegramStartPayload: `rider_${motorcyclist.id}`,
  });
}
