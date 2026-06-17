'use client';

import Link from 'next/link';
import { Bike, CheckCircle2, MessageCircle, PackagePlus, RefreshCw, Store, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ProtectedPage from '@/components/ProtectedPage';
import { useProfile } from '@/hooks/useProfile';
import { normalizeRole } from '@/lib/access';
import type { Delivery, Motorcyclist, Shop } from '@/lib/types';
import { getDeliveries } from '@/services/deliveryService';
import { getMotorcyclists } from '@/services/driverService';
import { getShops } from '@/services/shopService';
import { syncTelegramUpdates } from '@/services/telegramService';

type Step = {
  title: string;
  description: string;
  done: boolean;
  href: string;
  action: string;
  icon: typeof Store;
};

export default function OnboardingPage() {
  const { profile } = useProfile();
  const [shops, setShops] = useState<Shop[]>([]);
  const [drivers, setDrivers] = useState<Motorcyclist[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = normalizeRole(profile?.role) === 'ADMIN_MASTER';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data: shopData, error: shopError }, { data: driverData, error: driverError }, { data: deliveryData, error: deliveryError }] = await Promise.all([
      getShops(),
      getMotorcyclists(),
      getDeliveries(),
    ]);
    setLoading(false);

    if (shopError || driverError || deliveryError) {
      setError(shopError?.message ?? driverError?.message ?? deliveryError?.message ?? 'Erro ao carregar configuração.');
      return;
    }

    const visibleShops = profile?.store_id ? (shopData ?? []).filter((shop) => shop.id === profile.store_id) : shopData ?? [];
    setShops(visibleShops);
    setDrivers(profile?.store_id ? (driverData ?? []).filter((driver) => driver.current_shop_id === profile.store_id) : driverData ?? []);
    setDeliveries(profile?.store_id ? (deliveryData ?? []).filter((delivery) => delivery.shop_id === profile.store_id) : deliveryData ?? []);
  }, [profile?.store_id]);

  useEffect(() => {
    load();
  }, [load]);

  const steps = useMemo<Step[]>(() => {
    const hasShop = shops.length > 0;
    const hasDriver = drivers.length > 0;
    const hasTelegram = drivers.some((driver) => Boolean(driver.telegram_chat_id));
    const hasDelivery = deliveries.length > 0;

    return [
      {
        title: 'Cadastrar ou revisar a loja',
        description: hasShop ? 'Loja encontrada. Confira endereço, valor por entrega e dados de contato.' : 'Cadastre a primeira loja antes de chamar motoqueiros.',
        done: hasShop,
        href: isAdmin ? '/gestor/lojas' : '/loja/dashboard',
        action: hasShop ? 'Ver loja' : 'Cadastrar loja',
        icon: Store,
      },
      {
        title: 'Cadastrar motoqueiros',
        description: hasDriver ? `${drivers.length} motoqueiro(s) cadastrado(s).` : 'Cadastre motoqueiros para criar a fila de chamadas.',
        done: hasDriver,
        href: isAdmin ? '/gestor/motoqueiros' : '/loja/dashboard',
        action: hasDriver ? 'Ver motoqueiros' : 'Cadastrar motoqueiro',
        icon: Bike,
      },
      {
        title: 'Conectar Telegram',
        description: hasTelegram ? 'Já existe motoqueiro conectado ao bot.' : 'Envie o link ou QR individual para cada motoqueiro conectar o Telegram.',
        done: hasTelegram,
        href: isAdmin ? '/gestor/motoqueiros' : '/loja/dashboard',
        action: 'Configurar Telegram',
        icon: MessageCircle,
      },
      {
        title: 'Cadastrar colaboradores da loja',
        description: 'Crie acessos para atendentes e escolha permissões por checkbox.',
        done: false,
        href: '/loja/colaboradores',
        action: 'Abrir colaboradores',
        icon: Users,
      },
      {
        title: 'Criar primeiro pedido',
        description: hasDelivery ? `${deliveries.length} pedido(s) já criado(s).` : 'Faça uma entrega teste e acompanhe a chamada na tela de pedidos.',
        done: hasDelivery,
        href: '/loja/dashboard',
        action: hasDelivery ? 'Ver pedidos' : 'Criar pedido',
        icon: PackagePlus,
      },
    ];
  }, [deliveries.length, drivers, isAdmin, shops.length]);

  async function handleSyncTelegram() {
    setSyncing(true);
    setMessage(null);
    setError(null);
    const result = await syncTelegramUpdates();
    setSyncing(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setMessage(`Telegram sincronizado. ${result.data.linked ?? 0} conexão(ões) vinculada(s).`);
    await load();
  }

  const doneCount = steps.filter((step) => step.done).length;

  return (
    <ProtectedPage roles={['ADMIN_MASTER', 'LOJISTA']}>
      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Configuração inicial</p>
            <h2>Começar a operar</h2>
            <p className="small-text">
              Siga esta lista para deixar uma loja pronta para vender, chamar motoqueiros e acompanhar entregas.
            </p>
          </div>
          <div className="actions">
            <button className="button secondary" onClick={load} disabled={loading}>
              <RefreshCw size={16} /> Atualizar
            </button>
            <button className="button" onClick={handleSyncTelegram} disabled={syncing}>
              <MessageCircle size={16} /> {syncing ? 'Sincronizando...' : 'Sincronizar Telegram'}
            </button>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        {message && <p className="success-text">{message}</p>}
      </section>

      <section className="stats-grid">
        <div className="stat-card"><span>Etapas concluídas</span><strong>{doneCount}/{steps.length}</strong></div>
        <div className="stat-card"><span>Lojas</span><strong>{shops.length}</strong></div>
        <div className="stat-card"><span>Motoqueiros</span><strong>{drivers.length}</strong></div>
        <div className="stat-card"><span>Com Telegram</span><strong>{drivers.filter((driver) => driver.telegram_chat_id).length}</strong></div>
      </section>

      <section className="onboarding-grid">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <article className="panel onboarding-card" key={step.title}>
              <div className={step.done ? 'onboarding-icon done' : 'onboarding-icon'}>
                {step.done ? <CheckCircle2 size={24} /> : <Icon size={24} />}
              </div>
              <div>
                <h3>{step.title}</h3>
                <p className="small-text">{step.description}</p>
              </div>
              <Link className="button secondary full" href={step.href}>{step.action}</Link>
            </article>
          );
        })}
      </section>
    </ProtectedPage>
  );
}
