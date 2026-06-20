import { supabase } from '@/lib/supabaseClient';
import type { EmergencyAccessCode, Profile, Shop, SubscriptionStatus } from '@/lib/types';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token
    ? { Authorization: `Bearer ${data.session.access_token}` }
    : {};
}

export async function getAdminShops() {
  return supabase
    .from('shops')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<Shop[]>();
}

export async function getAdminProfiles() {
  return supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<Profile[]>();
}

export async function updateShopSubscription(input: {
  shopId: string;
  subscriptionStatus?: SubscriptionStatus;
  monthlyPrice?: number;
  baseMonthlyPrice?: number;
  discountType?: 'none' | 'fixed' | 'percent';
  discountValue?: number;
  billingNote?: string;
  dueDate?: string | null;
  trialDays?: number;
}) {
  const response = await fetch('/api/admin/shops', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({ action: 'subscription', ...input }),
  });
  return response.json();
}

export async function setShopBlocked(shopId: string, blocked: boolean) {
  const response = await fetch('/api/admin/shops', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({ action: blocked ? 'block' : 'unblock', shopId }),
  });
  return response.json();
}

export async function generateEmergencyCode(input: {
  targetUserId?: string;
  targetStoreId?: string;
}) {
  const response = await fetch('/api/admin/emergency-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify(input),
  });
  return response.json() as Promise<{ code?: string; error?: string; record?: EmergencyAccessCode }>;
}
