export type UserRole =
  | 'gestor'
  | 'loja'
  | 'motoqueiro'
  | 'admin_master'
  | 'lojista'
  | 'colaborador_lojista';

export type AppRole = 'ADMIN_MASTER' | 'LOJISTA' | 'COLABORADOR_LOJISTA' | 'MOTOQUEIRO';

export type CollaboratorPermission =
  | 'ver_pedidos'
  | 'criar_pedidos'
  | 'editar_pedidos'
  | 'cancelar_pedidos'
  | 'chamar_motoqueiro'
  | 'ver_financeiro'
  | 'ver_relatorios'
  | 'cadastrar_colaboradores';

export type PermissionMap = Partial<Record<CollaboratorPermission, boolean>>;

export type SubscriptionStatus = 'trial' | 'active' | 'overdue' | 'blocked';

export type Profile = {
  id: string;
  user_id: string;
  role: UserRole;
  store_id: string | null;
  permissions: PermissionMap | null;
  emergency_access_until: string | null;
  blocked_at: string | null;
  name: string;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export type Shop = {
  id: string;
  created_by: string;
  name: string;
  legal_name: string | null;
  cnpj: string | null;
  address: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string;
  state: string | null;
  zipcode: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  latitude: number | null;
  longitude: number | null;
  payout_amount_per_delivery: number | null;
  minimum_guaranteed_deliveries: number;
  trial_start_date: string | null;
  trial_end_date: string | null;
  subscription_status: SubscriptionStatus | null;
  monthly_price: number | null;
  base_monthly_price: number | null;
  discount_type: 'none' | 'fixed' | 'percent' | null;
  discount_value: number | null;
  billing_note: string | null;
  due_date: string | null;
  subscription_blocked_at: string | null;
  qr_token: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type EmergencyAccessCode = {
  id: string;
  code: string;
  target_user_id: string | null;
  target_store_id: string | null;
  valid_until: string;
  used_at: string | null;
  expires_after_use_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type Motorcyclist = {
  id: string;
  profile_id: string;
  name: string;
  document: string | null;
  phone: string | null;
  pix_key: string | null;
  pix_key_type: string | null;
  payout_name: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  telegram_linked_at: string | null;
  active: boolean;
  is_online: boolean;
  available: boolean;
  current_shop_id: string | null;
  billing_mode: 'none' | 'monthly' | 'percentage' | null;
  billing_base_amount: number | null;
  billing_percentage: number | null;
  billing_discount_type: 'none' | 'fixed' | 'percent' | null;
  billing_discount_value: number | null;
  latitude: number | null;
  longitude: number | null;
  last_seen: string | null;
  last_assigned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'accepted'
  | 'rejected'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export type Delivery = {
  id: string;
  shop_id: string;
  motorcyclist_id: string | null;
  origin_address: string;
  destination_address: string;
  destination_zipcode: string | null;
  destination_number: string | null;
  destination_complement: string | null;
  destination_neighborhood: string | null;
  destination_city: string | null;
  destination_state: string | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  arrival_notified_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: DeliveryStatus;
  assigned_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  departed_at: string | null;
  delivered_at: string | null;
  total_duration_seconds: number | null;
  driver_payout_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  shops?: Pick<Shop, 'name' | 'address' | 'number' | 'complement' | 'neighborhood' | 'city' | 'state' | 'zipcode' | 'cnpj' | 'latitude' | 'longitude'> | null;
  motorcyclists?: Pick<Motorcyclist, 'id' | 'name' | 'phone' | 'latitude' | 'longitude' | 'last_seen' | 'telegram_chat_id' | 'pix_key' | 'pix_key_type' | 'payout_name'> | null;
};

export type DriverLocationPoint = {
  id: string;
  motorcyclist_id: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
};

export type DeliveryReport = {
  id: string;
  shop_id: string;
  shop_name: string;
  motorcyclist_id: string | null;
  motorcyclist_name: string | null;
  status: DeliveryStatus;
  delivery_day: string;
  created_at: string;
  assigned_at: string | null;
  accepted_at: string | null;
  departed_at: string | null;
  delivered_at: string | null;
  total_duration_seconds: number | null;
  total_duration_minutes: number | null;
};

export type DriverPayout = {
  id: string;
  shop_id: string;
  motorcyclist_id: string;
  delivery_count: number;
  guaranteed_deliveries: number;
  covered_days: number;
  paid_units: number;
  amount_per_delivery: number;
  amount_total: number;
  pix_key: string | null;
  pix_key_type: string | null;
  recipient_name: string;
  period_start: string | null;
  period_end: string;
  paid_at: string;
  payment_status: 'pending' | 'paid' | 'not_paid';
  payment_confirmed_at: string | null;
  payment_marked_by: string | null;
  receipt_path: string | null;
  receipt_file_name: string | null;
  payment_note: string | null;
  created_by: string;
  created_at: string;
  shops?: Pick<Shop, 'name' | 'cnpj'> | null;
  motorcyclists?: Pick<Motorcyclist, 'name' | 'pix_key' | 'pix_key_type' | 'payout_name'> | null;
};

export type ShopQrPayload = {
  type: 'shop_checkin';
  shopId: string;
  token: string;
  shopName?: string;
  contactPhone?: string | null;
};
