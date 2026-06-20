import { supabase } from '@/lib/supabaseClient';
import type { Profile, Shop, ShopQrPayload } from '@/lib/types';

export function makeShopQrPayload(shop: Pick<Shop, 'id' | 'qr_token' | 'name' | 'contact_phone'>): string {
  const payload: ShopQrPayload = {
    type: 'shop_checkin',
    shopId: shop.id,
    token: shop.qr_token,
    shopName: shop.name,
    contactPhone: shop.contact_phone,
  };

  return JSON.stringify(payload);
}

export function makeShopRegistrationUrl(shop: Pick<Shop, 'id' | 'qr_token'>, origin?: string): string {
  const baseUrl = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  const params = new URLSearchParams({
    shopId: shop.id,
    token: shop.qr_token,
  });

  return `${baseUrl}/motoqueiro/cadastro?${params.toString()}`;
}

export function parseShopQrPayload(rawValue: string): ShopQrPayload {
  const payload = JSON.parse(rawValue) as ShopQrPayload;

  if (payload.type !== 'shop_checkin' || !payload.shopId || !payload.token) {
    throw new Error('QR Code inválido.');
  }

  return payload;
}

export async function getShops() {
  return supabase.from('shops').select('*').order('created_at', { ascending: false }).returns<Shop[]>();
}

export async function getShopById(id: string) {
  return supabase.from('shops').select('*').eq('id', id).returns<Shop[]>().single();
}

export type CreateShopInput = {
  name: string;
  legalName?: string;
  cnpj?: string;
  address: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city: string;
  state?: string;
  zipcode?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  latitude?: number | null;
  longitude?: number | null;
  payoutAmountPerDelivery?: number;
  minimumGuaranteedDeliveries?: number;
};

function shouldRetryWithoutCoordinates(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === 'PGRST204'
    || error?.message?.includes('latitude')
    || error?.message?.includes('longitude');
}

function buildShopPayload(input: CreateShopInput, includeCoordinates = true) {
  return {
    name: input.name,
    legal_name: input.legalName || null,
    cnpj: input.cnpj?.replace(/\D/g, '') || null,
    address: input.address,
    number: input.number || null,
    complement: input.complement || null,
    neighborhood: input.neighborhood || null,
    city: input.city,
    state: input.state || null,
    zipcode: input.zipcode?.replace(/\D/g, '') || null,
    contact_name: input.contactName || null,
    contact_phone: input.contactPhone || null,
    contact_email: input.contactEmail || null,
    ...(includeCoordinates ? {
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    } : {}),
    payout_amount_per_delivery: input.payoutAmountPerDelivery ?? 0,
    minimum_guaranteed_deliveries: input.minimumGuaranteedDeliveries ?? 10,
  };
}

export async function createShop(profile: Profile, input: CreateShopInput) {
  const payload = {
    created_by: profile.id,
    ...buildShopPayload(input),
  };
  const result = await supabase
    .from('shops')
    .insert(payload)
    .select()
    .returns<Shop[]>()
    .single();

  if (!shouldRetryWithoutCoordinates(result.error)) return result;

  return supabase
    .from('shops')
    .insert({
      created_by: profile.id,
      ...buildShopPayload(input, false),
    })
    .select()
    .returns<Shop[]>()
    .single();
}

export async function updateShop(shopId: string, input: CreateShopInput) {
  const result = await supabase
    .from('shops')
    .update(buildShopPayload(input))
    .eq('id', shopId)
    .select()
    .returns<Shop[]>()
    .single();

  if (!shouldRetryWithoutCoordinates(result.error)) return result;

  return supabase
    .from('shops')
    .update(buildShopPayload(input, false))
    .eq('id', shopId)
    .select()
    .returns<Shop[]>()
    .single();
}
