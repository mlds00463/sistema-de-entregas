'use client';

import { BellRing, Check, MapPin, Navigation, Power, RefreshCw, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StatusBadge from '@/components/StatusBadge';
import ProtectedPage from '@/components/ProtectedPage';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { formatDateTime, formatDuration } from '@/lib/format';
import type { Delivery, Motorcyclist } from '@/lib/types';
import { acceptDelivery, getMyDeliveries, markArrived, markDelivered, rejectDelivery } from '@/services/deliveryService';
import { getMyMotorcyclist, setDriverOnline, updateDriverLocation } from '@/services/driverService';
import { notifyDeliveryReadyToFinishByTelegram } from '@/services/telegramService';

const arrivalRadiusMeters = 120;
const manualDeliveryFallbackMinutes = 5;
const trackingHeartbeatMs = 15000;
const minLocationSendIntervalMs = 8000;

export default function DriverDashboardPage() {
  const { requestOnce, startWatching, stopWatching, watching, error: geoError } = useGeolocation();
  const [driver, setDriver] = useState<Motorcyclist | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const announcedDeliveryIdRef = useRef<string | null>(null);
  const firstDeliveryLoadDoneRef = useRef(false);
  const alertLoopRef = useRef<number | null>(null);
  const trackingHeartbeatRef = useRef<number | null>(null);
  const trackingEnabledRef = useRef(false);
  const latestCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastLocationSentAtRef = useRef(0);
  const locationSendInFlightRef = useRef(false);
  const deliveriesRef = useRef<Delivery[]>([]);
  const arrivalNotifiedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: driverData }, { data: deliveryData }] = await Promise.all([
      getMyMotorcyclist(),
      getMyDeliveries(),
    ]);
    setDriver(driverData ?? null);
    if (!firstDeliveryLoadDoneRef.current) {
      announcedDeliveryIdRef.current = deliveryData?.find((delivery) => delivery.status === 'assigned')?.id ?? null;
      firstDeliveryLoadDoneRef.current = true;
    }
    setDeliveries(deliveryData ?? []);
    deliveriesRef.current = deliveryData ?? [];
    setLastUpdatedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(load, 3000);
    return () => window.clearInterval(interval);
  }, [load]);

  useRealtimeTable('deliveries', load);
  useRealtimeTable('motorcyclists', load);

  const activeDelivery = useMemo(() => {
    return deliveries.find((delivery) => ['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status)) ?? null;
  }, [deliveries]);

  const activeDeliveries = useMemo(() => {
    return deliveries.filter((delivery) => ['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status));
  }, [deliveries]);

  const assignedDelivery = useMemo(() => {
    return deliveries.find((delivery) => delivery.status === 'assigned') ?? null;
  }, [deliveries]);

  useEffect(() => {
    deliveriesRef.current = deliveries;
    deliveries.forEach((delivery) => {
      if (delivery.arrival_notified_at) {
        arrivalNotifiedRef.current.add(delivery.id);
      }
    });
  }, [deliveries]);

  function distanceInMeters(
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number
  ) {
    const earthRadius = 6371000;
    const toRadians = (degrees: number) => degrees * Math.PI / 180;
    const deltaLatitude = toRadians(toLatitude - fromLatitude);
    const deltaLongitude = toRadians(toLongitude - fromLongitude);
    const a = Math.sin(deltaLatitude / 2) ** 2
      + Math.cos(toRadians(fromLatitude)) * Math.cos(toRadians(toLatitude))
      * Math.sin(deltaLongitude / 2) ** 2;

    return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(value: number | null) {
    if (value === null) return null;
    if (value < 1000) return `${Math.round(value)} m`;
    return `${(value / 1000).toFixed(1).replace('.', ',')} km`;
  }

  function formatTimeOnly(date: Date | null) {
    if (!date) return '';
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function getManualFinishAvailableAt(delivery: Delivery) {
    const baseDate = delivery.departed_at ?? delivery.accepted_at ?? delivery.created_at;
    const base = new Date(baseDate);
    if (Number.isNaN(base.getTime())) return null;
    return new Date(base.getTime() + manualDeliveryFallbackMinutes * 60 * 1000);
  }

  function canFinishAfterWait(delivery: Delivery) {
    const availableAt = getManualFinishAvailableAt(delivery);
    return delivery.status === 'out_for_delivery'
      && Boolean(availableAt)
      && availableAt!.getTime() <= Date.now();
  }

  function getDistanceToDelivery(delivery: Delivery) {
    if (
      driver?.latitude === null
      || driver?.latitude === undefined
      || driver.longitude === null
      || driver.longitude === undefined
      || delivery.destination_latitude === null
      || delivery.destination_latitude === undefined
      || delivery.destination_longitude === null
      || delivery.destination_longitude === undefined
    ) {
      return null;
    }

    return distanceInMeters(driver.latitude, driver.longitude, delivery.destination_latitude, delivery.destination_longitude);
  }

  async function checkDeliveryArrivals(latitude: number, longitude: number, currentDeliveries = deliveriesRef.current) {
    const routeDeliveries = currentDeliveries.filter((delivery) => (
      delivery.status === 'out_for_delivery'
      && !delivery.arrival_notified_at
      && !arrivalNotifiedRef.current.has(delivery.id)
      && delivery.destination_latitude !== null
      && delivery.destination_latitude !== undefined
      && delivery.destination_longitude !== null
      && delivery.destination_longitude !== undefined
    ));

    for (const delivery of routeDeliveries) {
      const distance = distanceInMeters(latitude, longitude, delivery.destination_latitude!, delivery.destination_longitude!);

      if (distance <= arrivalRadiusMeters) {
        arrivalNotifiedRef.current.add(delivery.id);
        const { error } = await markArrived(delivery.id);
        if (!error) {
          await notifyDeliveryReadyToFinishByTelegram(delivery.id);
        }
        setMessage(`Você chegou ao local da entrega: ${delivery.destination_address}`);
        if ('vibrate' in navigator) navigator.vibrate([400, 180, 700]);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Você chegou ao destino', {
            body: delivery.destination_address,
          });
        }
      }
    }
  }

  async function sendDriverLocation(
    coordinates: { latitude: number; longitude: number },
    options: { force?: boolean } = {}
  ) {
    latestCoordsRef.current = coordinates;

    const now = Date.now();
    if (!options.force && now - lastLocationSentAtRef.current < minLocationSendIntervalMs) return;
    if (locationSendInFlightRef.current) return;

    locationSendInFlightRef.current = true;

    try {
      const { data } = await updateDriverLocation(coordinates.latitude, coordinates.longitude);
      lastLocationSentAtRef.current = Date.now();
      if (data) setDriver(data);
      await checkDeliveryArrivals(coordinates.latitude, coordinates.longitude);
    } catch {
      // The next watch/heartbeat tick will try again. Keeping this silent avoids blocking the driver flow.
    } finally {
      locationSendInFlightRef.current = false;
    }
  }

  function startLocationHeartbeat() {
    if (trackingHeartbeatRef.current !== null) return;

    trackingHeartbeatRef.current = window.setInterval(async () => {
      if (!trackingEnabledRef.current) return;

      try {
        const coords = await requestOnce();
        await sendDriverLocation(coords, { force: true });
      } catch {
        const last = latestCoordsRef.current;
        if (last) await sendDriverLocation(last, { force: true });
      }
    }, trackingHeartbeatMs);
  }

  function stopLocationHeartbeat() {
    if (trackingHeartbeatRef.current !== null) {
      window.clearInterval(trackingHeartbeatRef.current);
      trackingHeartbeatRef.current = null;
    }
  }

  async function refreshLocationNow() {
    if (!trackingEnabledRef.current) return;

    try {
      const coords = await requestOnce();
      await sendDriverLocation(coords, { force: true });
    } catch {
      // If the browser cannot read GPS at this exact moment, the active watcher/heartbeat remains running.
    }
  }

  function startLiveTracking() {
    if (driver?.active === false) return;
    trackingEnabledRef.current = true;
    startLocationHeartbeat();

    startWatching((nextCoords) => {
      sendDriverLocation(nextCoords).catch(() => null);
    });

    refreshLocationNow();
  }

  function stopLiveTracking() {
    trackingEnabledRef.current = false;
    stopLocationHeartbeat();
    stopWatching();
  }

  useEffect(() => {
    if (!driver || driver.active === false || watching) return;
    if (!driver.is_online && !activeDeliveries.some((delivery) => delivery.status === 'out_for_delivery')) return;
    if (!navigator.permissions?.query) return;

    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((permission) => {
        if (permission.state === 'granted') {
          startLiveTracking();
        }
      })
      .catch(() => null);
  }, [driver?.id, driver?.is_online, driver?.active, watching, activeDeliveries.length]);

  useEffect(() => {
    if (!driver || driver.active === false) return;
    const shouldTrack = driver.is_online || activeDeliveries.length > 0;
    if (!shouldTrack) {
      stopLiveTracking();
      return;
    }

    trackingEnabledRef.current = true;
    startLocationHeartbeat();

    const resumeTracking = () => {
      if (document.visibilityState === 'visible') {
        startLiveTracking();
        refreshLocationNow();
      }
    };

    window.addEventListener('focus', resumeTracking);
    document.addEventListener('visibilitychange', resumeTracking);

    return () => {
      window.removeEventListener('focus', resumeTracking);
      document.removeEventListener('visibilitychange', resumeTracking);
    };
  }, [driver?.id, driver?.is_online, driver?.active, activeDeliveries.length]);

  useEffect(() => {
    return () => {
      stopLocationHeartbeat();
    };
  }, []);

  function playIncomingRideAlert() {
    if (!audioContextRef.current) return;

    const context = audioContextRef.current;
    context.resume();

    for (let index = 0; index < 4; index += 1) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(index % 2 === 0 ? 880 : 660, context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime + index * 0.42);
      gain.gain.exponentialRampToValueAtTime(0.35, context.currentTime + index * 0.42 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + index * 0.42 + 0.25);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime + index * 0.42);
      oscillator.stop(context.currentTime + index * 0.42 + 0.28);
    }
  }

  function vibrateIncomingRide() {
    if ('vibrate' in navigator) {
      navigator.vibrate([700, 220, 700, 220, 900]);
    }
  }

  function stopIncomingRideAlert() {
    if (alertLoopRef.current) {
      window.clearInterval(alertLoopRef.current);
      alertLoopRef.current = null;
    }

    if ('vibrate' in navigator) {
      navigator.vibrate(0);
    }
  }

  function notifyIncomingRide(delivery: Delivery) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Nova corrida disponível', {
        body: `${delivery.shops?.name ?? 'Loja'} -> ${delivery.destination_address}`,
      });
    }

    setMessage('Nova corrida chamada. Aceite ou recuse a entrega.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  useEffect(() => {
    if (!assignedDelivery) return;
    if (!firstDeliveryLoadDoneRef.current) return;

    if (announcedDeliveryIdRef.current !== assignedDelivery.id) {
      announcedDeliveryIdRef.current = assignedDelivery.id;
      notifyIncomingRide(assignedDelivery);
    }
  }, [assignedDelivery, alertsEnabled]);

  useEffect(() => {
    stopIncomingRideAlert();

    if (!assignedDelivery) return undefined;

    const runAlert = () => {
      if (alertsEnabled) {
        playIncomingRideAlert();
      }
      vibrateIncomingRide();
    };

    runAlert();
    alertLoopRef.current = window.setInterval(runAlert, 2600);

    return () => {
      stopIncomingRideAlert();
    };
  }, [assignedDelivery?.id, alertsEnabled]);

  async function enableAlerts() {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      setMessage('Este navegador não permitiu áudio de alerta.');
      return;
    }

    audioContextRef.current = audioContextRef.current ?? new AudioContextClass();
    await audioContextRef.current.resume();

    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    setAlertsEnabled(true);
    setMessage('Alertas ativados. A próxima corrida vai tocar e vibrar neste aparelho.');
    playIncomingRideAlert();
  }

  async function goOnline(online: boolean) {
    setMessage(null);
    if (driver?.active === false) {
      setMessage('Seu cadastro está cancelado. Fale com a loja para reativar.');
      return;
    }

    try {
      const coords = await requestOnce();
      const { data, error } = await setDriverOnline(online, coords.latitude, coords.longitude);
      if (error) throw error;
      setDriver(data);
      if (online) {
        startLiveTracking();
      } else {
        stopLiveTracking();
      }
      setMessage(online ? 'Você está online.' : 'Você saiu da fila.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar seu status.');
    }
  }

  async function runDeliveryAction(action: () => Promise<{ error: unknown }>) {
    setMessage(null);
    const { error } = await action();
    if (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar a entrega.');
      return;
    }
    stopIncomingRideAlert();
    load();
  }

  async function handleMarkDelivered(delivery: Delivery) {
    let distance = getDistanceToDelivery(delivery);
    const manualFallbackAllowed = canFinishAfterWait(delivery);

    if (distance === null) {
      try {
        const coords = await requestOnce();
        const { data } = await updateDriverLocation(coords.latitude, coords.longitude);
        if (data) setDriver(data);
        await checkDeliveryArrivals(coords.latitude, coords.longitude, [delivery]);

        if (
          delivery.destination_latitude !== null
          && delivery.destination_latitude !== undefined
          && delivery.destination_longitude !== null
          && delivery.destination_longitude !== undefined
        ) {
          distance = distanceInMeters(
            coords.latitude,
            coords.longitude,
            delivery.destination_latitude,
            delivery.destination_longitude
          );
        }
      } catch {
        if (!manualFallbackAllowed) {
          const availableAt = getManualFinishAvailableAt(delivery);
          setMessage(`Não consegui ler seu GPS agora. Ative a localização ou aguarde até ${formatTimeOnly(availableAt)} para liberar Entregue.`);
          return;
        }
      }
    }

    const canFinish = Boolean(delivery.arrival_notified_at)
      || (distance !== null && distance <= arrivalRadiusMeters)
      || manualFallbackAllowed;

    if (!canFinish) {
      const availableAt = getManualFinishAvailableAt(delivery);
      setMessage(`Chegue perto do destino ou aguarde até ${formatTimeOnly(availableAt)} para liberar o botão Entregue.`);
      return;
    }

    await runDeliveryAction(async () => {
      if (!delivery.arrival_notified_at && distance !== null && distance <= arrivalRadiusMeters) {
        const arrival = await markArrived(delivery.id);
        if (arrival.error) return { error: arrival.error };
      }

      return markDelivered(delivery.id);
    });
  }

  return (
    <ProtectedPage roles={['MOTOQUEIRO']}>
      {driver?.active === false && (
        <section className="warning-panel">
          <strong>Cadastro cancelado</strong>
          <p>Seu acesso de motoqueiro foi cancelado pela loja. Entre em contato para reativar antes de receber corridas.</p>
        </section>
      )}

      {activeDeliveries.length > 0 && (
        <section className={`incoming-ride-banner ${assignedDelivery ? 'incoming-ride-banner-ringing' : ''}`}>
          <div className="active-delivery-list">
            <p className="incoming-kicker">{assignedDelivery ? 'Corrida chamando agora' : 'Pedido em andamento'}</p>
            {activeDeliveries.map((delivery) => {
              const distance = formatDistance(getDistanceToDelivery(delivery));

              return (
                <div className="active-delivery-top-card" key={delivery.id}>
                  <StatusBadge status={delivery.status} />
                  <h2>{delivery.status === 'assigned' ? 'Nova corrida disponível' : delivery.status === 'accepted' ? 'Corrida aceita' : 'Pedido despachado'}</h2>
                  <p>Loja: {delivery.shops?.name ?? '-'}</p>
                  <p><strong>Destino:</strong> {delivery.destination_address}</p>
                  {delivery.origin_address && <p><strong>Retirada:</strong> {delivery.origin_address}</p>}
                  {delivery.customer_name && <p>Cliente: {delivery.customer_name}</p>}
                  {delivery.customer_phone && <p>Telefone: {delivery.customer_phone}</p>}
                  <p>Criada: {formatDateTime(delivery.created_at)}</p>
                  <p>Tempo total: {formatDuration(delivery.total_duration_seconds)}</p>
                  {distance && <p>Distância até o destino: {distance}</p>}
                  {delivery.arrival_notified_at && <p className="success-text">Chegada detectada às {formatDateTime(delivery.arrival_notified_at)}</p>}
                </div>
              );
            })}
            {assignedDelivery && !alertsEnabled && <p className="incoming-muted">Toque em Ativar alertas para liberar som contínuo neste aparelho.</p>}
          </div>
          <div className="incoming-actions">
            {assignedDelivery && !alertsEnabled && (
              <button className="button secondary" onClick={enableAlerts}>
                <BellRing size={18} /> Ativar som
              </button>
            )}
            {activeDeliveries.map((delivery) => {
              const distance = getDistanceToDelivery(delivery);
              const manualFinishAvailableAt = getManualFinishAvailableAt(delivery);
              const manualFinishAllowed = canFinishAfterWait(delivery);
              const canFinish = Boolean(delivery.arrival_notified_at)
                || (distance !== null && distance <= arrivalRadiusMeters)
                || manualFinishAllowed;

              return (
                <div className="incoming-action-group" key={delivery.id}>
                  {delivery.status === 'assigned' && (
                    <>
                      <button className="button" onClick={() => runDeliveryAction(() => acceptDelivery(delivery.id))}>
                        <Check size={18} /> Aceitar
                      </button>
                      <button className="button danger" onClick={() => runDeliveryAction(() => rejectDelivery(delivery.id))}>
                        <X size={18} /> Recusar
                      </button>
                    </>
                  )}
                  {delivery.status === 'accepted' && (
                    <>
                      <button className="button secondary" disabled>
                        <Navigation size={18} /> Aguardando a loja despachar
                      </button>
                      <p className="small-text">Quando a loja marcar a saída, a entrega entra em rota para você finalizar no destino.</p>
                    </>
                  )}
                  {delivery.status === 'out_for_delivery' && (
                    <>
                      <button className="button" disabled={!canFinish} onClick={() => handleMarkDelivered(delivery)}>
                        <Check size={18} /> Marcar entregue
                      </button>
                      {manualFinishAllowed && !delivery.arrival_notified_at && (
                        <p className="small-text">
                          GPS não confirmou chegada, mas o botão foi liberado por tempo de segurança.
                        </p>
                      )}
                      {!canFinish && (
                        <p className="small-text">
                          Chegue a até {arrivalRadiusMeters} m do destino ou aguarde até {formatTimeOnly(manualFinishAvailableAt)} para liberar Entregue.
                          {distance !== null ? ` Distância atual: ${formatDistance(distance)}.` : ' Ligue o GPS para calcular a distância.'}
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="stats-grid">
        <div className="stat-card"><span>Status</span><strong>{driver?.is_online ? 'Online' : 'Offline'}</strong></div>
        <div className="stat-card">
          <span>Fila</span>
          <strong>
            {activeDelivery ? 'Em atendimento' : driver?.available ? 'Disponível' : 'Indisponível'}
          </strong>
        </div>
        <div className="stat-card"><span>GPS</span><strong>{watching ? 'Ao vivo' : 'Parado'}</strong></div>
        <div className="stat-card"><span>Último sinal</span><strong>{formatDateTime(driver?.last_seen)}</strong></div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Tela do motoqueiro</h2>
            <p className="small-text">
              Fique online depois de ler o QR da loja. A tela atualiza sozinha e toca quando chegar corrida.
              {lastUpdatedAt ? ` Atualizado às ${lastUpdatedAt}.` : ''}
            </p>
          </div>
          <div className="actions">
            <button className={alertsEnabled ? 'button secondary' : 'button'} onClick={enableAlerts}>
              {alertsEnabled ? <Volume2 size={18} /> : <BellRing size={18} />}
              {alertsEnabled ? 'Alertas ativos' : 'Ativar alertas'}
            </button>
            <button className="button secondary" onClick={load} disabled={refreshing}>
              <RefreshCw size={18} /> Atualizar
            </button>
            <button className="button" onClick={() => goOnline(true)} disabled={driver?.active === false}><Power size={18} /> Online</button>
            <button className="button secondary" onClick={() => goOnline(false)} disabled={driver?.active === false}><Power size={18} /> Offline</button>
          </div>
        </div>
        {geoError && <p className="error-text">{geoError}</p>}
        {message && <p className="small-text">{message}</p>}
        {driver?.latitude !== null && driver?.latitude !== undefined && driver.longitude !== null && driver.longitude !== undefined && (
          <p className="small-text">
            <MapPin size={14} /> {driver.latitude.toFixed(6)}, {driver.longitude.toFixed(6)}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Entrega atual</h2>
        {!activeDelivery && <p className="small-text">Nenhuma chamada ativa no momento.</p>}
        {activeDelivery && <p className="small-text">As informações e ações do pedido em andamento ficam fixadas no topo da tela.</p>}
      </section>

      <section className="panel">
        <h2>Histórico</h2>
        <div className="stack">
          {deliveries.map((delivery) => (
            <div className="history-row" key={delivery.id}>
              <div>
                <strong>{delivery.destination_address}</strong>
                <p className="small-text">{formatDateTime(delivery.created_at)} · {formatDuration(delivery.total_duration_seconds)}</p>
              </div>
              <StatusBadge status={delivery.status} />
            </div>
          ))}
          {deliveries.length === 0 && <p className="small-text">Nenhuma entrega ainda.</p>}
        </div>
      </section>
    </ProtectedPage>
  );
}
