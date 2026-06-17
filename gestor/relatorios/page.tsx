'use client';

import { Download, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ProtectedPage from '@/components/ProtectedPage';
import { formatCurrency, formatDuration } from '@/lib/format';
import type { Delivery, Shop } from '@/lib/types';
import { getDeliveries } from '@/services/deliveryService';
import { getShops } from '@/services/shopService';

function getCurrentMonthKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getLocalMonthKey(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function averageDuration(deliveries: Delivery[]) {
  const withDuration = deliveries.filter((delivery) => Number(delivery.total_duration_seconds ?? 0) > 0);
  if (!withDuration.length) return null;
  return Math.round(withDuration.reduce((sum, delivery) => sum + Number(delivery.total_duration_seconds ?? 0), 0) / withDuration.length);
}

export default function MonthlyReportsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [month, setMonth] = useState(getCurrentMonthKey);
  const [shopId, setShopId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data: shopData, error: shopError }, { data: deliveryData, error: deliveryError }] = await Promise.all([
      getShops(),
      getDeliveries(),
    ]);
    setLoading(false);

    if (shopError || deliveryError) {
      setError(shopError?.message ?? deliveryError?.message ?? 'Erro ao carregar relatório.');
      return;
    }

    setShops(shopData ?? []);
    setDeliveries(deliveryData ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shopMap = useMemo(() => new Map(shops.map((shop) => [shop.id, shop])), [shops]);

  const filteredDeliveries = useMemo(() => deliveries.filter((delivery) => (
    getLocalMonthKey(delivery.created_at) === month
    && (!shopId || delivery.shop_id === shopId)
  )), [deliveries, month, shopId]);

  const deliveredDeliveries = filteredDeliveries.filter((delivery) => delivery.status === 'delivered');
  const activeDeliveries = filteredDeliveries.filter((delivery) => ['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status));
  const cancelledDeliveries = filteredDeliveries.filter((delivery) => ['cancelled', 'rejected'].includes(delivery.status));
  const totalCost = deliveredDeliveries.reduce((sum, delivery) => {
    const shop = shopMap.get(delivery.shop_id);
    return sum + Number(shop?.payout_amount_per_delivery ?? 0);
  }, 0);

  const byDriver = useMemo(() => {
    const grouped = new Map<string, {
      name: string;
      shopName: string;
      total: number;
      delivered: number;
      active: number;
      cancelled: number;
      cost: number;
      durations: number[];
    }>();

    filteredDeliveries.forEach((delivery) => {
      const key = delivery.motorcyclist_id ?? 'sem-motoqueiro';
      const shop = shopMap.get(delivery.shop_id);
      const current = grouped.get(key) ?? {
        name: delivery.motorcyclists?.name ?? 'Sem motoqueiro',
        shopName: delivery.shops?.name ?? shop?.name ?? 'Loja',
        total: 0,
        delivered: 0,
        active: 0,
        cancelled: 0,
        cost: 0,
        durations: [],
      };

      current.total += 1;
      if (delivery.status === 'delivered') {
        current.delivered += 1;
        current.cost += Number(shop?.payout_amount_per_delivery ?? 0);
        if (delivery.total_duration_seconds) current.durations.push(delivery.total_duration_seconds);
      }
      if (['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status)) current.active += 1;
      if (['cancelled', 'rejected'].includes(delivery.status)) current.cancelled += 1;
      grouped.set(key, current);
    });

    return Array.from(grouped.values()).sort((a, b) => b.delivered - a.delivered || a.name.localeCompare(b.name, 'pt-BR'));
  }, [filteredDeliveries, shopMap]);

  return (
    <ProtectedPage roles={['ADMIN_MASTER']}>
      <section className="section-header report-actions">
        <div>
          <p className="eyebrow">Relatórios</p>
          <h2>Relatório mensal por loja</h2>
          <p className="small-text">Visualize o mês como será impresso e salve em PDF pelo navegador.</p>
        </div>
        <div className="actions">
          <button className="button secondary" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> Atualizar
          </button>
          <button className="button" onClick={() => window.print()}>
            <Download size={16} /> Exportar PDF
          </button>
        </div>
      </section>

      <section className="panel report-actions">
        <div className="filters">
          <label className="label">
            Mês
            <input className="input compact" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <label className="label">
            Loja
            <select className="select compact" value={shopId} onChange={(event) => setShopId(event.target.value)}>
              <option value="">Todas as lojas</option>
              {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}
      </section>

      <section className="panel print-report">
        <div className="section-header">
          <div>
            <p className="eyebrow">Resumo do período</p>
            <h2>{shopId ? shops.find((shop) => shop.id === shopId)?.name : 'Todas as lojas'} · {month}</h2>
          </div>
          <strong>{new Date().toLocaleDateString('pt-BR')}</strong>
        </div>

        <div className="stats-grid">
          <div className="stat-card"><span>Pedidos criados</span><strong>{filteredDeliveries.length}</strong></div>
          <div className="stat-card"><span>Entregues</span><strong>{deliveredDeliveries.length}</strong></div>
          <div className="stat-card"><span>Em andamento</span><strong>{activeDeliveries.length}</strong></div>
          <div className="stat-card"><span>Cancelados/recusados</span><strong>{cancelledDeliveries.length}</strong></div>
          <div className="stat-card"><span>Custo estimado</span><strong className="fit-number">{formatCurrency(totalCost)}</strong></div>
          <div className="stat-card"><span>Tempo médio</span><strong>{formatDuration(averageDuration(deliveredDeliveries))}</strong></div>
        </div>

        <h3 className="panel-subtitle">Resultado por motoqueiro</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Motoqueiro</th>
                <th>Loja</th>
                <th>Total</th>
                <th>Entregues</th>
                <th>Em andamento</th>
                <th>Cancelados</th>
                <th>Tempo médio</th>
                <th>Custo</th>
              </tr>
            </thead>
            <tbody>
              {byDriver.map((driver) => {
                const avg = driver.durations.length
                  ? Math.round(driver.durations.reduce((sum, item) => sum + item, 0) / driver.durations.length)
                  : null;
                return (
                  <tr key={`${driver.name}-${driver.shopName}`}>
                    <td><strong>{driver.name}</strong></td>
                    <td>{driver.shopName}</td>
                    <td>{driver.total}</td>
                    <td>{driver.delivered}</td>
                    <td>{driver.active}</td>
                    <td>{driver.cancelled}</td>
                    <td>{formatDuration(avg)}</td>
                    <td>{formatCurrency(driver.cost)}</td>
                  </tr>
                );
              })}
              {byDriver.length === 0 && (
                <tr>
                  <td colSpan={8}>Nenhum pedido encontrado para este filtro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </ProtectedPage>
  );
}
