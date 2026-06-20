import { supabase } from '@/lib/supabaseClient';
import type { PermissionMap, Profile } from '@/lib/types';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token
    ? { Authorization: `Bearer ${data.session.access_token}` }
    : {};
}

export async function getStoreCollaborators(storeId?: string | null) {
  let query = supabase
    .from('profiles')
    .select('*')
    .eq('role', 'colaborador_lojista')
    .order('name', { ascending: true });

  if (storeId) query = query.eq('store_id', storeId);

  return query.returns<Profile[]>();
}

export async function createCollaborator(input: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  permissions: PermissionMap;
}) {
  const response = await fetch('/api/lojista/collaborators', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify(input),
  });
  return response.json() as Promise<{ profile?: Profile; error?: string }>;
}

export async function updateCollaborator(input: {
  profileId: string;
  name: string;
  phone?: string;
  permissions: PermissionMap;
  blocked?: boolean;
}) {
  const response = await fetch('/api/lojista/collaborators', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify(input),
  });
  return response.json() as Promise<{ profile?: Profile; error?: string }>;
}
