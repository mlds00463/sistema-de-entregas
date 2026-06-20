import type { AppRole, CollaboratorPermission, PermissionMap, Profile, Shop, UserRole } from './types';

const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN_MASTER: 'Admin Master',
  LOJISTA: 'Lojista',
  COLABORADOR_LOJISTA: 'Colaborador',
  MOTOQUEIRO: 'Motoqueiro',
};

export const COLLABORATOR_PERMISSIONS: Array<{
  key: CollaboratorPermission;
  label: string;
}> = [
  { key: 'ver_pedidos', label: 'Ver pedidos' },
  { key: 'criar_pedidos', label: 'Criar pedidos' },
  { key: 'editar_pedidos', label: 'Editar pedidos' },
  { key: 'cancelar_pedidos', label: 'Cancelar pedidos' },
  { key: 'chamar_motoqueiro', label: 'Chamar motoqueiro' },
  { key: 'ver_financeiro', label: 'Ver financeiro' },
  { key: 'ver_relatorios', label: 'Ver relatórios' },
  { key: 'cadastrar_colaboradores', label: 'Cadastrar colaboradores' },
];

export function normalizeRole(role?: UserRole | string | null): AppRole | null {
  if (!role) return null;
  const normalized = role.toLowerCase();
  if (normalized === 'gestor' || normalized === 'admin_master') return 'ADMIN_MASTER';
  if (normalized === 'loja' || normalized === 'lojista') return 'LOJISTA';
  if (normalized === 'colaborador_lojista') return 'COLABORADOR_LOJISTA';
  if (normalized === 'motoqueiro') return 'MOTOQUEIRO';
  return null;
}

export function roleLabel(role?: UserRole | string | null) {
  const normalized = normalizeRole(role);
  return normalized ? ROLE_LABELS[normalized] : 'Sem perfil';
}

export function isAdminMaster(profile?: Pick<Profile, 'role'> | null) {
  return normalizeRole(profile?.role) === 'ADMIN_MASTER';
}

export function isShopOwner(profile?: Pick<Profile, 'role'> | null) {
  return normalizeRole(profile?.role) === 'LOJISTA';
}

export function isCollaborator(profile?: Pick<Profile, 'role'> | null) {
  return normalizeRole(profile?.role) === 'COLABORADOR_LOJISTA';
}

export function can(profile: Pick<Profile, 'role' | 'permissions'> | null | undefined, permission: CollaboratorPermission) {
  const role = normalizeRole(profile?.role);
  if (role === 'ADMIN_MASTER' || role === 'LOJISTA') return true;
  if (role !== 'COLABORADOR_LOJISTA') return false;
  return Boolean((profile?.permissions as PermissionMap | null | undefined)?.[permission]);
}

export function hasAnyPermission(profile: Pick<Profile, 'role' | 'permissions'> | null | undefined, permissions?: CollaboratorPermission[]) {
  if (!permissions || permissions.length === 0) return true;
  return permissions.some((permission) => can(profile, permission));
}

export function hasEmergencyAccess(profile?: Pick<Profile, 'emergency_access_until'> | null) {
  if (!profile?.emergency_access_until) return false;
  return new Date(profile.emergency_access_until).getTime() > Date.now();
}

export function isProfileBlocked(profile?: Pick<Profile, 'blocked_at' | 'emergency_access_until'> | null) {
  return Boolean(profile?.blocked_at) && !hasEmergencyAccess(profile);
}

export function isShopSubscriptionBlocked(shop?: Pick<Shop, 'subscription_status'> | null, profile?: Pick<Profile, 'emergency_access_until'> | null) {
  return shop?.subscription_status === 'blocked' && !hasEmergencyAccess(profile);
}

export function getSubscriptionWarning(shop?: Pick<Shop, 'subscription_status' | 'due_date'> | null) {
  if (!shop || shop.subscription_status !== 'overdue') return null;
  if (!shop.due_date) return 'Assinatura pendente. Regularize para evitar bloqueio.';

  const dueDate = new Date(`${shop.due_date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const elapsedDays = Math.max(1, Math.floor((today.getTime() - dueDate.getTime()) / 86400000) + 1);

  if (elapsedDays <= 1) return '1º aviso: vencimento identificado. Regularize a assinatura.';
  if (elapsedDays === 2) return '2º aviso: assinatura pendente. O acesso pode ser bloqueado.';
  return 'Aviso final: regularize hoje para evitar bloqueio automático.';
}
