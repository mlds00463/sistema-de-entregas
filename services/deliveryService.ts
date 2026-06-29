import { supabase } from '@/lib/supabaseClient';
import type { Delivery, DeliveryReport } from '@/lib/types';

export async function getDeliveries(shopId?: string) {
  let query = supabase
    .from('deliveries')
    .select('*, shops(name,address,number,complement,neighborhood,city,state,zipcode,cnpj,latitude,longitude), motorcyclists(id,name,phone,latitude,longitude,last_seen,telegram_chat_id,pix_key,pix_key_type,payout_name)')
    .order('created_at', { ascending: false });

  if (shopId) {
    query = query.eq('shop_id', shopId);
  }

  const result = await query.returns<Delivery[]>();
  if (!result.error) return result;

  let fallbackQuery = supabase
    .from('deliveries')
    .select('*, shops(name,address,city,cnpj), motorcyclists(id,name,phone,latitude,longitude,last_seen,telegram_chat_id,pix_key,pix_key_type,payout_name)')
    .order('created_at', { ascending: false });

  if (shopId) {
    fallbackQuery = fallbackQuery.eq('shop_id', shopId);
  }

  return fallbackQuery.returns<Delivery[]>();
}

export async function getMyDeliveries() {
  const result = await supabase
    .from('deliveries')
    .select('*, shops(name,address,number,complement,neighborhood,city,state,zipcode,cnpj,latitude,longitude), motorcyclists(id,name,phone,latitude,longitude,last_seen,telegram_chat_id,pix_key,pix_key_type,payout_name)')
    .order('created_at', { ascending: false })
    .returns<Delivery[]>();

  if (!result.error) return result;

  return supabase
    .from('deliveries')
    .select('*, shops(name,address,city,cnpj), motorcyclists(id,name,phone,latitude,longitude,last_seen,telegram_chat_id,pix_key,pix_key_type,payout_name)')
    .order('created_at', { ascending: false })
    .returns<Delivery[]>();
}

export async function createDelivery(input: {
  shopId: string;
  assignedMotorcyclistId?: string;
  originAddress: string;
  destinationAddress: string;
  destinationZipcode?: string;
  destinationNumber?: string;
  destinationComplement?: string;
  destinationNeighborhood?: string;
  destinationCity?: string;
  destinationState?: string;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  customerName?: string;
  customerPhone?: string;
}) {
  const fullPayload = await supabase
    .rpc('create_delivery_and_assign', {
      shop_id_input: input.shopId,
      origin_address_input: input.originAddress,
      destination_address_input: input.destinationAddress,
      destination_zipcode_input: input.destinationZipcode?.replace(/\D/g, '') || null,
      destination_number_input: input.destinationNumber || null,
      destination_complement_input: input.destinationComplement || null,
      destination_neighborhood_input: input.destinationNeighborhood || null,
      destination_city_input: input.destinationCity || null,
      destination_state_input: input.destinationState || null,
      destination_latitude_input: input.destinationLatitude ?? null,
      destination_longitude_input: input.destinationLongitude ?? null,
      customer_name_input: input.customerName || null,
      customer_phone_input: input.customerPhone || null,
      assigned_motorcyclist_id_input: input.assignedMotorcyclistId || null,
    });

  const missingNewFunction = fullPayload.error?.code === 'PGRST202'
    || fullPayload.error?.message?.includes('Could not find the function');

  if (!missingNewFunction) {
    return fullPayload;
  }

  if (input.assignedMotorcyclistId) {
    return {
      data: null,
      error: {
        message: 'Para escolher o motoqueiro manualmente, rode a migration manual no Supabase.',
      },
    };
  }

  return supabase.rpc('create_delivery_and_assign', {
    shop_id_input: input.shopId,
    origin_address_input: input.originAddress,
    destination_address_input: input.destinationAddress,
    customer_name_input: input.customerName || null,
    customer_phone_input: input.customerPhone || null,
  });
}

export async function reassignDelivery(deliveryId: string, motorcyclistId: string) {
  return supabase.rpc('reassign_delivery_motorcyclist', {
    delivery_id_input: deliveryId,
    motorcyclist_id_input: motorcyclistId,
  });
}

export async function dispatchDeliveryFromShop(deliveryId: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return {
      data: null,
      error: { message: 'Sessão expirada. Entre novamente para despachar o pedido.' },
    };
  }

  const response = await fetch('/api/loja/dispatch-delivery', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deliveryId }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: payload?.error ?? 'Não foi possível despachar o pedido.' },
    };
  }

  return {
    data: payload?.delivery ?? null,
    error: null,
  };
}

export async function markDeliveredFromShop(deliveryId: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return {
      data: null,
      error: { message: 'Sessão expirada. Entre novamente para finalizar o pedido.' },
    };
  }

  const response = await fetch('/api/loja/mark-delivered', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deliveryId }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: payload?.error ?? 'Não foi possível marcar o pedido como entregue.' },
    };
  }

  await notifyDeliveryComplete(deliveryId, 'shop');

  return {
    data: payload?.delivery ?? null,
    error: null,
  };
}

async function notifyDeliveryComplete(deliveryId: string, source: 'shop' | 'driver') {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;

  await fetch('/api/telegram/send-delivery-complete', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deliveryId, source }),
  }).catch(() => null);
}

export async function updateDeliveryAddress(input: {
  deliveryId: string;
  originAddress: string;
  destinationAddress: string;
  destinationZipcode?: string;
  destinationNumber?: string;
  destinationComplement?: string;
  destinationNeighborhood?: string;
  destinationCity?: string;
  destinationState?: string;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  customerName?: string;
  customerPhone?: string;
}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return {
      data: null,
      error: { message: 'Sessão expirada. Entre novamente para editar o pedido.' },
    };
  }

  const response = await fetch('/api/loja/update-delivery-address', {
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
      error: { message: payload?.error ?? 'Não foi possível atualizar o endereço.' },
    };
  }

  return {
    data: payload?.delivery ?? null,
    error: null,
  };
}

export async function deleteDeliveryByAdmin(deliveryId: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return {
      data: null,
      error: { message: 'Sessão expirada. Entre novamente para excluir o pedido.' },
    };
  }

  const response = await fetch('/api/admin/delete-delivery', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deliveryId }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: payload?.error ?? 'Não foi possível excluir o pedido.' },
    };
  }

  return {
    data: payload,
    error: null,
  };
}

export async function acceptDelivery(deliveryId: string) {
  return supabase.rpc('accept_delivery', { delivery_id_input: deliveryId });
}

export async function rejectDelivery(deliveryId: string) {
  return supabase.rpc('reject_delivery', { delivery_id_input: deliveryId });
}

export async function markDeparted(deliveryId: string) {
  return supabase.rpc('mark_delivery_departed', { delivery_id_input: deliveryId });
}

export async function markDelivered(deliveryId: string) {
  const result = await supabase.rpc('mark_delivery_delivered', { delivery_id_input: deliveryId });
  if (!result.error) await notifyDeliveryComplete(deliveryId, 'driver');
  return result;
}

export async function markArrived(deliveryId: string) {
  return supabase.rpc('mark_delivery_arrived', { delivery_id_input: deliveryId });
}

export async function getReports(filters?: { day?: string; shopId?: string; motorcyclistId?: string }) {
  let query = supabase
    .from('delivery_reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.day) query = query.eq('delivery_day', filters.day);
  if (filters?.shopId) query = query.eq('shop_id', filters.shopId);
  if (filters?.motorcyclistId) query = query.eq('motorcyclist_id', filters.motorcyclistId);

  return query.returns<DeliveryReport[]>();
}
