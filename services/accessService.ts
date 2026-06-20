import { supabase } from '@/lib/supabaseClient';
import type { EmergencyAccessCode, Profile, Shop } from '@/lib/types';

export async function getProfileShop(profile: Profile | null) {
  if (!profile?.store_id) return { data: null, error: null };

  return supabase
    .from('shops')
    .select('*')
    .eq('id', profile.store_id)
    .returns<Shop[]>()
    .maybeSingle();
}

export async function useEmergencyCode(code: string) {
  return supabase.rpc('use_emergency_access_code', {
    code_input: code.trim(),
  });
}

export async function listEmergencyCodes() {
  return supabase
    .from('emergency_access_codes')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<EmergencyAccessCode[]>();
}
