'use client';

import dynamic from 'next/dynamic';
import { Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ProtectedPage from '@/components/ProtectedPage';
import StatusBadge from '@/components/StatusBadge';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { formatDateTime } from '@/lib/format';
import type { Delivery, Motorcyclist, Shop } from '@/lib/types';
import { getDeliveries } from '@/services/deliveryService';
import { getMotorcyclists } from '@/services/driverService';
import { getShops } from '@/services/shopService';

const LiveMap = dynamic(() => import('@/components/LiveMap'), {
  ssr: false,
  loading: () => <div className="map-placeholder">Carregando mapa...</div>,
});

type MapDriver = Motorcyclist & {
  shops?: Pick<Shop, 'name' | 'cnpj' | 'address' | 'city' | 'latitude' | 'longitude'> | null;
};

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

export default function ManagerMapPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<MapDriver[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getTodayDateKey);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: deliveryData }, { data: driverData }, { data: shopData }] = await Promise.all([
      getDeliveries(),
      getMotorcyclists(),
      getShops(),
    ]);
    setDeliveries(deliveryData ?? []);
    setDrivers((driverData ?? []) as MapDriver[]);
    setShops(shopData ?? []);
    setLastUpdatedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(load, 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  useRealtimeTable('deliveries', load);
  useRealtimeTable('motorcyclists', load);

  const mapDeliveries = useMemo(() => {
    return deliveries.filter((delivery) => (
      getLocalDateKey(delivery.created_at) === selectedDate
      && ['assigned', 'accepted', 'out_for_delivery', 'delivered'].includes(delivery.status)
    ));
  }, [deliveries, selectedDate]);

  const activeDeliveries = useMemo(() => {
    return mapDeliveries.filter((delivery) => ['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status));
  }, [mapDeliveries]);

  useEffect(() => {
    if (mapDeliveries.length === 0) {
      setSelectedDeliveryId(null);
      return;
    }
    if (!selectedDeliveryId || !mapDeliveries.some((delivery) => delivery.id === selectedDeliveryId)) {
      setSelectedDeliveryId(mapDeliveries[0].id);
    }
  }, [mapDeliveries, selectedDeliveryId]);

  const queue = useMemo(() => {
    return [...drivers].sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return new Date(a.last_assigned_at ?? 0).getTime() - new Date(b.last_assigned_at ?? 0).getTime();
    });
  }, [drivers]);

  return (
    <ProtectedPage roles={['ADMIN_MASTER']}>
      <section className={`panel ${mapExpanded ? 'map-panel-expanded' : 'map-panel-compact'}`}>
        <div className="section-header">
          <div>
            <h2>Mapa ao vivo</h2>
            <p className="small-text">
              Acompanhe motoqueiros disponíveis e entregas em rota com atualização automática.
              {lastUpdatedAt ? ` Atualizado às ${lastUpdatedAt}.` : ''}
            </p>
          </div>
          <div className="button-row">
            <input
              className="input compact"
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
            <button className="button secondary" type="button" onClick={() => setSelectedDate(getTodayDateKey())}>
              Hoje
            </button>
            <button className="button secondary" onClick={() => setMapExpanded((current) => !current)}>
              {mapExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              {mapExpanded ? 'Reduzir mapa' : 'Expandir mapa'}
            </button>
            <button className="button secondary" onClick={load} disabled={refreshing}>
              <RefreshCw size={18} /> Atualizar
            </button>
          </div>
        </div>
        <LiveMap
          deliveries={mapDeliveries}
          drivers={drivers}
          shops={shops}
          selectedDeliveryId={selectedDeliveryId}
          onSelectDelivery={setSelectedDeliveryId}
        />
      </section>

      <section className="content-grid two">
        <div className="panel">
          <h2>Fila de motoqueiros</h2>
          <div className="stack">
            {queue.map((driver, index) => (
              <div className="history-row" key={driver.id}>
                <div>
                  <strong>{index + 1}. {driver.name}</strong>
                  <p className="small-text">
                    {driver.shops?.name ?? 'Sem loja'} · {driver.is_online ? 'online' : 'offline'} · {driver.available ? 'disponível' : 'ocupado'}
                  </p>
                  <p className="small-text">Última chamada: {formatDateTime(driver.last_assigned_at)} · GPS: {formatDateTime(driver.last_seen)}</p>
                </div>
                <span className={`status-chip ${driver.available ? 'status-delivered' : driver.is_online ? 'status-assigned' : 'status-cancelled'}`}>
                  {driver.available ? 'Na fila' : driver.is_online ? 'Ocupado' : 'Offline'}
                </span>
              </div>
            ))}
            {queue.length === 0 && <p className="small-text">Nenhum motoqueiro cadastrado.</p>}
          </div>
        </div>

        <div className="panel">
          <h2>Corridas da data selecionada</h2>
          <p className="small-text">Clique em uma corrida para ver o percorrido e a rota restante no mapa.</p>
          <div className="stack">
            {mapDeliveries.map((delivery) => (
              <button
                className={`history-row map-delivery-row ${selectedDeliveryId === delivery.id ? 'selected' : ''}`}
                key={delivery.id}
                type="button"
                onClick={() => setSelectedDeliveryId(delivery.id)}
              >
                <div>
                  <strong>{delivery.destination_address}</strong>
                  <p className="small-text">{delivery.shops?.name ?? '-'} · {delivery.motorcyclists?.name ?? '-'}</p>
                  <p className="small-text">Criada: {formatDateTime(delivery.created_at)}</p>
                </div>
                <StatusBadge status={delivery.status} />
              </button>
            ))}
            {mapDeliveries.length === 0 && <p className="small-text">Nenhuma corrida nesta data.</p>}
          </div>
        </div>
      </section>
    </ProtectedPage>
  );
}
