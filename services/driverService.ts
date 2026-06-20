import { supabase } from '@/lib/supabaseClient';
import { normalizePixKey, resolvePixKeyType } from '@/lib/pix';
import type { Motorcyclist } from '@/lib/types';

export async function getMyMotorcyclist() {
  return supabase.rpc('get_my_motorcyclist');
}

export async function getMotorcyclists() {
  const result = await supabase
    .from('motorcyclists')
    .select('*, shops:current_shop_id(name,cnpj,address,city,latitude,longitude)')
    .order('name', { ascending: true })
    .returns<Motorcyclist[]>();

  if (!result.error) return result;

  return supabase
    .from('motorcyclists')
    .select('*')
    .order('name', { ascending: true })
    .returns<Motorcyclist[]>();
}

export async function updateMyPaymentInfo(input: {
  motorcyclistId: string;
  pixKey: string;
  pixKeyType: string;
  payoutName: string;
}) {
  return supabase
    .from('motorcyclists')
    .update({
      pix_key: normalizePixKey(input.pixKey, input.pixKeyType),
      pix_key_type: resolvePixKeyType(input.pixKey, input.pixKeyType),
      payout_name: input.payoutName.trim(),
    })
    .eq('id', input.motorcyclistId)
    .select()
    .single();
}

export async function updateMotorcyclistByManager(input: {
  motorcyclistId: string;
  name: string;
  phone: string;
  pixKey: string;
  pixKeyType: string;
  payoutName: string;
}) {
  return supabase.rpc('manager_update_motorcyclist', {
    motorcyclist_id_input: input.motorcyclistId,
    name_input: input.name,
    phone_input: input.phone,
    pix_key_input: normalizePixKey(input.pixKey, input.pixKeyType),
    pix_key_type_input: resolvePixKeyType(input.pixKey, input.pixKeyType),
    payout_name_input: input.payoutName,
  });
}

export async function createMotorcyclistByAdmin(input: {
  name: string;
  phone: string;
  email?: string;
  password?: string;
  pixKey?: string;
  pixKeyType?: string;
  payoutName?: string;
}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return {
      data: null,
      error: { message: 'Sessão expirada. Entre novamente para cadastrar o motoqueiro.' },
    };
  }

  const response = await fetch('/api/admin/motorcyclists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: payload?.error ?? 'Não foi possível cadastrar o motoqueiro.' },
    };
  }

  return {
    data: payload,
    error: null,
  };
}

export async function setMotorcyclistActiveByManager(motorcyclistId: string, active: boolean) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return {
      data: null,
      error: { message: 'Sessão expirada. Entre novamente para alterar o cadastro.' },
    };
  }

  const response = await fetch('/api/admin/motorcyclists/status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ motorcyclistId, active }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: payload?.error ?? 'Não foi possível alterar o cadastro.' },
    };
  }

  return {
    data: payload?.motorcyclist ?? null,
    error: null,
  };
}

export async function createMotorcyclist(profileId: string, name: string, phone?: string) {
  return supabase
    .from('motorcyclists')
    .insert({ profile_id: profileId, name, phone })
    .select()
    .returns<Motorcyclist[]>()
    .single();
}

export async function driverCheckIn(
  shopId: string,
  token: string,
  latitude: number,
  longitude: number
) {
  return supabase
    .rpc('driver_check_in', {
      shop_id_input: shopId,
      qr_token_input: token,
      latitude_input: latitude,
      longitude_input: longitude,
    });
}

export async function setDriverOnline(online: boolean, latitude: number, longitude: number) {
  return supabase
    .rpc('driver_set_online', {
      online_input: online,
      latitude_input: latitude,
      longitude_input: longitude,
    });
}

export async function updateDriverLocation(latitude: number, longitude: number) {
  return supabase
    .rpc('driver_update_location', {
      latitude_input: latitude,
      longitude_input: longitude,
    });
}
