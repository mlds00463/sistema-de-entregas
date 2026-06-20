import { supabase } from '@/lib/supabaseClient';
import type { DriverLocationPoint } from '@/lib/types';

export async function getDriverLocationPoints(motorcyclistId: string, hours = 12) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  return supabase
    .from('driver_location_points')
    .select('*')
    .eq('motorcyclist_id', motorcyclistId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true })
    .returns<DriverLocationPoint[]>();
}

export async function getDriverLocationPointsForPeriod(
  motorcyclistId: string,
  startAt?: string | null,
  endAt?: string | null,
  deliveryId?: string | null
) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  if (token) {
    const params = new URLSearchParams({ motorcyclistId });
    if (deliveryId) params.set('deliveryId', deliveryId);
    if (startAt) params.set('startAt', startAt);
    if (endAt) params.set('endAt', endAt);

    const response = await fetch(`/api/locations/driver-points?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => null);

    if (response.ok) {
      return {
        data: (payload?.points ?? []) as DriverLocationPoint[],
        error: null,
      };
    }
  }

  let query = supabase
    .from('driver_location_points')
    .select('*')
    .eq('motorcyclist_id', motorcyclistId)
    .order('recorded_at', { ascending: true });

  if (startAt) query = query.gte('recorded_at', startAt);
  if (endAt) query = query.lte('recorded_at', endAt);

  return query.returns<DriverLocationPoint[]>();
}
