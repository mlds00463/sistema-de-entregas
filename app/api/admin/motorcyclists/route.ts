import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { normalizePixKey, resolvePixKeyType } from '@/lib/pix';
import { getRouteContext, jsonError } from '@/lib/serverAuth';

export const runtime = 'nodejs';

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;

  if (context.role !== 'ADMIN_MASTER') {
    return jsonError('Apenas Admin Master pode cadastrar motoqueiros.', 403);
  }

  const body = await request.json().catch(() => null) as {
    name?: string;
    phone?: string;
    email?: string;
    password?: string;
    pixKey?: string;
    pixKeyType?: string;
    payoutName?: string;
  } | null;

  const name = cleanText(body?.name);
  const phone = cleanText(body?.phone);
  const rawEmail = cleanText(body?.email).toLowerCase();
  const rawPassword = cleanText(body?.password);
  const pixKey = cleanText(body?.pixKey);
  const pixKeyType = cleanText(body?.pixKeyType) || 'cpf';
  const payoutName = cleanText(body?.payoutName);
  const phoneDigits = phone.replace(/\D/g, '');
  const generatedEmail = `motoqueiro-${phoneDigits || randomUUID().slice(0, 8)}-${randomUUID().slice(0, 8)}@mr-entregas.app`;
  const generatedPassword = `MR-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const email = rawEmail || generatedEmail;
  const password = rawPassword || generatedPassword;
  const generatedCredentials = !rawEmail || !rawPassword;

  if (!name) return jsonError('Informe o nome do motoqueiro.');
  if (rawEmail && !rawEmail.includes('@')) return jsonError('Informe um e-mail válido para o login do motoqueiro.');
  if (rawPassword && rawPassword.length < 6) return jsonError('A senha inicial precisa ter pelo menos 6 caracteres.');

  const { data: userData, error: userError } = await context.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name,
      phone,
      role: 'motoqueiro',
      generated_credentials: generatedCredentials,
    },
  });

  if (userError || !userData.user) {
    return jsonError(userError?.message ?? 'Não foi possível criar o usuário do motoqueiro.', 400);
  }

  const { data: profile, error: profileError } = await context.admin
    .from('profiles')
    .insert({
      user_id: userData.user.id,
      role: 'motoqueiro',
      name,
      phone: phone || null,
    })
    .select()
    .single();

  if (profileError || !profile) {
    await context.admin.auth.admin.deleteUser(userData.user.id);
    return jsonError(profileError?.message ?? 'Não foi possível criar o perfil do motoqueiro.', 400);
  }

  const normalizedPixKey = pixKey ? normalizePixKey(pixKey, pixKeyType) : null;

  const { data: motorcyclist, error: motorcyclistError } = await context.admin
    .from('motorcyclists')
    .insert({
      profile_id: profile.id,
      name,
      phone: phone || null,
      pix_key: normalizedPixKey,
      pix_key_type: normalizedPixKey ? resolvePixKeyType(pixKey, pixKeyType) : null,
      payout_name: payoutName || name,
      active: true,
    })
    .select()
    .single();

  if (motorcyclistError || !motorcyclist) {
    await context.admin.auth.admin.deleteUser(userData.user.id);
    return jsonError(motorcyclistError?.message ?? 'Não foi possível cadastrar o motoqueiro.', 400);
  }

  return NextResponse.json({
    motorcyclist,
    profile,
    generatedCredentials: generatedCredentials ? { email, password } : null,
  });
}
