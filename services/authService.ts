import { supabase } from '@/lib/supabaseClient';
import type { Profile, UserRole } from '@/lib/types';

function normalizeSignupRole(value: unknown): UserRole {
  if (value === 'motoqueiro') return 'motoqueiro';
  if (value === 'lojista' || value === 'loja') return 'lojista';
  if (value === 'colaborador_lojista') return 'colaborador_lojista';
  if (value === 'admin_master' || value === 'gestor') return 'gestor';
  return 'motoqueiro';
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(
  email: string,
  password: string,
  name: string,
  role: UserRole,
  phone: string
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, role, phone },
    },
  });

  if (error || !data.user) {
    return { data, error };
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    user_id: data.user.id,
    role,
    name,
    phone,
  });

  if (!profileError && role === 'motoqueiro') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', data.user.id)
      .single();

    if (profile) {
      await supabase.from('motorcyclists').insert({
        profile_id: profile.id,
        name,
        phone,
      });
    }
  }

  return { data, error: profileError ?? error };
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getProfile() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { data: null, error: userError ?? new Error('Usuário não autenticado.') };
  }

  return supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userData.user.id)
    .returns<Profile[]>()
    .maybeSingle();
}

export async function ensureProfile() {
  const existing = await getProfile();
  if (existing.data) {
    return existing;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { data: null, error: userError ?? new Error('Usuário não autenticado.') };
  }

  const metadata = userData.user.user_metadata ?? {};
  const role = normalizeSignupRole(metadata.role);
  const name = typeof metadata.name === 'string' && metadata.name.trim()
    ? metadata.name
    : userData.user.email?.split('@')[0] ?? 'Usuário';
  const phone = typeof metadata.phone === 'string' ? metadata.phone : null;

  const created = await supabase
    .from('profiles')
    .upsert({
      user_id: userData.user.id,
      role,
      name,
      phone,
    }, { onConflict: 'user_id' })
    .select()
    .returns<Profile[]>()
    .single();

  if (!created.error && created.data && role === 'motoqueiro') {
    await supabase.from('motorcyclists').insert({
      profile_id: created.data.id,
      name,
      phone,
    });
  }

  return created;
}
