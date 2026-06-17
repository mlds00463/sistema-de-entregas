'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DeliveryTable from '@/components/DeliveryTable';
import ProtectedPage from '@/components/ProtectedPage';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { formatDateTime, formatDuration } from '@/lib/format';
import type { Delivery, DeliveryReport, Motorcyclist, Shop } from '@/lib/types';
import { getDeliveries, getReports } from '@/services/deliveryService';
import { getMotorcyclists } from '@/services/driverService';
import { getShops } from '@/services/shopService';

function getLocalDateKey(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayDateKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function ManagerDashboardPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [reports, setReports] = useState<DeliveryReport[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [drivers, setDrivers] = useState<Motorcyclist[]>([]);
  const [day, setDay] = useState(getTodayDateKey);
  const [shopId, setShopId] = useState('');
  const [motorcyclistId, setMotorcyclistId] = useState('');

  const load = useCallback(async () => {
    const [{ data: deliveryData }, { data: shopData }, { data: driverData }, { data: reportData }] = await Promise.all([
      getDeliveries(),
      getShops(),
      getMotorcyclists(),
      getReports({ day, shopId: shopId || undefined, motorcyclistId: motorcyclistId || undefined }),
    ]);
    setDeliveries(deliveryData ?? []);
    setShops(shopData ?? []);
    setDrivers(driverData ?? []);
    setReports(reportData ?? []);
  }, [day, shopId, motorcyclistId]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeTable('deliveries', load);
  useRealtimeTable('motorcyclists', load);

  const filteredDeliveries = useMemo(() => (
    deliveries.filter((item) => getLocalDateKey(item.created_at) === day)
  ), [deliveries, day]);

  const stats = useMemo(() => {
    const delivered = reports.filter((item) => item.status === 'delivered');
    const totalSeconds = delivered.reduce((sum, item) => sum + (item.total_duration_seconds ?? 0), 0);
    return {
      total: reports.length,
      delivered: delivered.length,
      active: filteredDeliveries.filter((item) => ['assigned', 'accepted', 'out_for_delivery'].includes(item.status)).length,
      average: delivered.length ? Math.round(totalSeconds / delivered.length) : null,
    };
  }, [filteredDeliveries, reports]);

  return (
    <ProtectedPage roles={['ADMIN_MASTER']}>
      <section className="stats-grid">
        <div className="stat-card"><span>Entregas filtradas</span><strong>{stats.total}</strong></div>
        <div className="stat-card"><span>Entregues</span><strong>{stats.delivered}</strong></div>
        <div className="stat-card"><span>Em andamento</span><strong>{stats.active}</strong></div>
        <div className="stat-card"><span>Tempo médio</span><strong>{formatDuration(stats.average)}</strong></div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Relatórios</h2>
            <p className="small-text">Filtro real por dia e loja. O tempo vem da coluna calculada no banco.</p>
          </div>
          <div className="filters">
            <input className="input compact" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            <button className="button secondary" type="button" onClick={() => setDay(getTodayDateKey())}>Hoje</button>
            <select className="select compact" value={shopId} onChange={(e) => setShopId(e.target.value)}>
              <option value="">Todas as lojas</option>
              {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
            </select>
            <select className="select compact" value={motorcyclistId} onChange={(e) => setMotorcyclistId(e.target.value)}>
              <option value="">Todos os motoqueiros</option>
              {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
            </select>
          </div>
        </div>
        <DeliveryTable deliveries={reports} />
      </section>

      <section className="panel">
        <h2>Operação ao vivo</h2>
        <p className="small-text">Exibindo entregas criadas na data selecionada.</p>
        <DeliveryTable deliveries={filteredDeliveries.slice(0, 20)} />
      </section>

      <section className="panel">
        <h2>Motoqueiros disponíveis</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Online</th>
                <th>Disponível</th>
                <th>Última chamada</th>
                <th>Último GPS</th>
                <th>Coordenadas</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => (
                <tr key={driver.id}>
                  <td>{driver.name}</td>
                  <td>{driver.is_online ? 'Sim' : 'Não'}</td>
                  <td>{driver.available ? 'Sim' : 'Não'}</td>
                  <td>{formatDateTime(driver.last_assigned_at)}</td>
                  <td>{formatDateTime(driver.last_seen)}</td>
                  <td>{driver.latitude !== null && driver.longitude !== null ? `${driver.latitude.toFixed(6)}, ${driver.longitude.toFixed(6)}` : '-'}</td>
                </tr>
              ))}
              {drivers.length === 0 && (
                <tr>
                  <td colSpan={6}>Nenhum motoqueiro cadastrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </ProtectedPage>
  );
}
