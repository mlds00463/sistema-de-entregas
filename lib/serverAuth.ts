import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeRole } from './access';
import { createSupabaseAdmin } from './supabaseAdmin';
import type { Profile } from './types';

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function getRouteContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: jsonError('Servidor sem configuração completa do Supabase.', 500) };
  }

  const authorization = request.headers.get('authorization') ?? '';
  const userToken = authorization.replace(/^Bearer\s+/i, '').trim();

  if (!userToken) {
    return { error: jsonError('Sessão não enviada.', 401) };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createSupabaseAdmin() ?? supabase;

  const { data: userData, error: userError } = await supabase.auth.getUser(userToken);
  if (userError || !userData.user) {
    return { error: jsonError('Sessão inválida.', 401) };
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('*')
    .eq('user_id', userData.user.id)
    .returns<Profile[]>()
    .maybeSingle();

  if (profileError || !profile) {
    return { error: jsonError('Perfil não encontrado.', 404) };
  }

  return {
    admin,
    profile,
    role: normalizeRole(profile.role),
    user: userData.user,
  };
}
