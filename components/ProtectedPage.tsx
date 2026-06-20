'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AppShell from './AppShell';
import { useProfile } from '@/hooks/useProfile';
import { hasAnyPermission, hasEmergencyAccess, isProfileBlocked, isShopSubscriptionBlocked, normalizeRole } from '@/lib/access';
import type { AppRole, CollaboratorPermission, Shop, UserRole } from '@/lib/types';
import { getProfileShop } from '@/services/accessService';
import { useState } from 'react';

export default function ProtectedPage({
  roles,
  permissions,
  children,
}: {
  roles?: Array<UserRole | AppRole>;
  permissions?: CollaboratorPermission[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { profile, loading } = useProfile();
  const [shop, setShop] = useState<Shop | null>(null);
  const [shopLoading, setShopLoading] = useState(false);

  useEffect(() => {
    if (!loading && !profile) {
      router.replace('/auth');
    }
  }, [loading, profile, router]);

  useEffect(() => {
    if (!profile) return;
    setShopLoading(true);
    getProfileShop(profile)
      .then(({ data }) => setShop(data ?? null))
      .finally(() => setShopLoading(false));
  }, [profile]);

  if (loading) {
    return <main className="container"><div className="panel">Carregando...</div></main>;
  }

  if (!profile) return null;

  const normalizedRole = normalizeRole(profile.role);
  const allowedRoles = roles?.map((role) => normalizeRole(role));
  const hasRole = !allowedRoles || (normalizedRole ? allowedRoles.includes(normalizedRole) : false);
  const hasPermission = hasAnyPermission(profile, permissions);
  const blocked = isProfileBlocked(profile) || isShopSubscriptionBlocked(shop, profile);

  if (shopLoading) {
    return <main className="container"><div className="panel">Carregando permissões...</div></main>;
  }

  if (blocked) {
    return (
      <AppShell profile={profile} shop={shop}>
        <div className="panel warning-panel">
          <h2>Acesso bloqueado</h2>
          <p className="small-text">
            Este acesso está bloqueado por status administrativo ou assinatura pendente.
            Use a liberação emergencial se o Admin Master gerou uma senha temporária.
          </p>
          <button className="button" onClick={() => router.push('/liberacao')}>
            Digitar senha emergencial
          </button>
        </div>
      </AppShell>
    );
  }

  if (!hasRole || !hasPermission) {
    return (
      <AppShell profile={profile} shop={shop}>
        <div className="panel">
          <h2>Acesso restrito</h2>
          <p className="small-text">Seu perfil não tem permissão para acessar esta tela.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile} shop={shop} emergencyAccess={hasEmergencyAccess(profile)}>
      {children}
    </AppShell>
  );
}
