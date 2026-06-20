'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bike, CreditCard, FileText, KeyRound, LayoutDashboard, LogOut, Map, QrCode, Rocket, ShieldCheck, Store, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { can, getSubscriptionWarning, isProfileBlocked, isShopSubscriptionBlocked, normalizeRole, roleLabel } from '@/lib/access';
import { signOut } from '@/services/authService';
import type { AppRole, CollaboratorPermission, Profile, Shop } from '@/lib/types';

const navigationItems: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  roles: AppRole[];
  permission?: CollaboratorPermission;
}> = [
  { href: '/admin/master', label: 'Admin Master', icon: ShieldCheck, roles: ['ADMIN_MASTER'] },
  { href: '/onboarding', label: 'Começar', icon: Rocket, roles: ['ADMIN_MASTER', 'LOJISTA'] },
  { href: '/gestor/dashboard', label: 'Gestor', icon: LayoutDashboard, roles: ['ADMIN_MASTER'] },
  { href: '/gestor/lojas', label: 'Lojas', icon: Store, roles: ['ADMIN_MASTER'] },
  { href: '/loja/dashboard', label: 'Pedidos', icon: Store, roles: ['ADMIN_MASTER', 'LOJISTA', 'COLABORADOR_LOJISTA'], permission: 'ver_pedidos' },
  { href: '/loja/colaboradores', label: 'Colaboradores', icon: Users, roles: ['ADMIN_MASTER', 'LOJISTA', 'COLABORADOR_LOJISTA'], permission: 'cadastrar_colaboradores' },
  { href: '/gestor/mapa', label: 'Mapa', icon: Map, roles: ['ADMIN_MASTER'] },
  { href: '/gestor/motoqueiros', label: 'Motoqueiros', icon: Bike, roles: ['ADMIN_MASTER'] },
  { href: '/gestor/pagamentos', label: 'Pagamentos', icon: CreditCard, roles: ['ADMIN_MASTER'] },
  { href: '/gestor/relatorios', label: 'Relatórios', icon: FileText, roles: ['ADMIN_MASTER'] },
  { href: '/liberacao', label: 'Liberação', icon: KeyRound, roles: ['ADMIN_MASTER', 'LOJISTA', 'COLABORADOR_LOJISTA', 'MOTOQUEIRO'] },
  { href: '/motoqueiro/dashboard', label: 'Minha tela', icon: Bike, roles: ['MOTOQUEIRO'] },
  { href: '/motoqueiro/qrcode', label: 'Ler QR', icon: QrCode, roles: ['MOTOQUEIRO'] },
];

export default function AppShell({
  children,
  profile,
  shop,
  emergencyAccess,
}: {
  children: ReactNode;
  profile?: Profile | null;
  shop?: Shop | null;
  emergencyAccess?: boolean;
}) {
  const router = useRouter();
  const normalizedRole = normalizeRole(profile?.role);
  const showEmergencyRelease = Boolean(
    profile && (
      isProfileBlocked(profile)
      || isShopSubscriptionBlocked(shop, profile)
      || shop?.subscription_status === 'overdue'
      || emergencyAccess
    )
  );
  const visibleNavigationItems = navigationItems.filter((item) => {
    if (!profile || !normalizedRole || !item.roles.includes(normalizedRole)) return false;
    if (item.href === '/liberacao' && !showEmergencyRelease) return false;
    return item.permission ? can(profile, item.permission) : true;
  });
  const subscriptionWarning = getSubscriptionWarning(shop);

  async function handleSignOut() {
    await signOut();
    router.push('/auth');
  }

  return (
    <div className="container">
      <header className="header">
        <div>
          <p className="eyebrow">Sistema de Entregas</p>
          <h1>Operação em tempo real</h1>
          {profile && (
            <p className="small-text">
              {profile.name} · {roleLabel(profile.role)}
              {shop?.name ? ` · ${shop.name}` : ''}
              {emergencyAccess ? ' · liberação emergencial ativa' : ''}
            </p>
          )}
        </div>
        <button className="icon-button" onClick={handleSignOut} title="Sair">
          <LogOut size={18} />
          Sair
        </button>
      </header>

      <nav className="navbar">
        {visibleNavigationItems.map((item) => {
          const Icon = item.icon;

          return (
            <Link className="nav-link" href={item.href} key={item.href}>
              <Icon size={16} /> {item.label}
            </Link>
          );
        })}
      </nav>

      {subscriptionWarning && (
        <div className="panel warning-panel">
          <strong>{subscriptionWarning}</strong>
        </div>
      )}

      {children}
    </div>
  );
}
