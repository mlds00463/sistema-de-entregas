'use client';

import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { compactAddressParts, isCompleteAddress, simplifyBrazilianAddress } from '@/lib/geocodeUtils';
import type { Delivery, DriverLocationPoint, Motorcyclist, Shop } from '@/lib/types';
import { geocodeAddress } from '@/services/geocodeService';
import { getDriverLocationPointsForPeriod } from '@/services/locationService';
import StatusBadge from './StatusBadge';

type MapDriver = Motorcyclist & {
  shops?: Pick<Shop, 'name' | 'cnpj' | 'address' | 'city' | 'latitude' | 'longitude'> | null;
};

type MapShop = Shop & {
  mapLatitude: number;
  mapLongitude: number;
};

type Coordinate = [number, number];

function toCoordinate(latitude: number | null | undefined, longitude: number | null | undefined): Coordinate | null {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return null;
  return [latitude, longitude];
}

function coordinateKey(position: Coordinate) {
  return `${position[0].toFixed(6)},${position[1].toFixed(6)}`;
}

function appendUniqueCoordinate(target: Coordinate[], position: Coordinate | null) {
  if (!position) return;
  const last = target[target.length - 1];
  if (last && coordinateKey(last) === coordinateKey(position)) return;
  target.push(position);
}

function createMarker(className: string, label: string) {
  return L.divIcon({
    className: `map-marker ${className}`,
    html: `<span>${label}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

const availableIcon = createMarker('map-marker-available', 'M');
const routeIcon = createMarker('map-marker-route', 'R');
const offlineIcon = createMarker('map-marker-offline', 'O');
const destinationIcon = createMarker('map-marker-destination', 'D');
const shopIcon = createMarker('map-marker-shop', 'L');

function RecenterMap({ center }: { center: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true });
  }, [center[0], center[1], map]);

  return null;
}

function buildShopMapAddress(shop: Shop) {
  const address = isCompleteAddress(shop.address, shop.city, shop.zipcode)
    ? compactAddressParts([shop.address, 'Brasil'])
    : compactAddressParts([
      shop.address,
      shop.number,
      shop.complement,
      shop.neighborhood,
      shop.city,
      shop.state,
      shop.zipcode ? `CEP ${shop.zipcode}` : '',
      'Brasil',
    ]);

  return simplifyBrazilianAddress(address);
}

function buildDeliveryMapAddress(delivery: Delivery) {
  const address = isCompleteAddress(delivery.destination_address, delivery.destination_city, delivery.destination_zipcode)
    ? compactAddressParts([delivery.destination_address, 'Brasil'])
    : compactAddressParts([
      delivery.destination_address,
      delivery.destination_number,
      delivery.destination_complement,
      delivery.destination_neighborhood,
      delivery.destination_city,
      delivery.destination_state,
      delivery.destination_zipcode ? `CEP ${delivery.destination_zipcode}` : '',
      'Brasil',
    ]);

  return simplifyBrazilianAddress(address);
}

export default function LiveMap({
  deliveries,
  drivers,
  shops,
  selectedDeliveryId,
  onSelectDelivery,
}: {
  deliveries: Delivery[];
  drivers: MapDriver[];
  shops: Shop[];
  selectedDeliveryId?: string | null;
  onSelectDelivery?: (deliveryId: string) => void;
}) {
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [locationPoints, setLocationPoints] = useState<DriverLocationPoint[]>([]);
  const [remainingRoute, setRemainingRoute] = useState<Array<[number, number]>>([]);
  const [geocodedShopPoints, setGeocodedShopPoints] = useState<Record<string, { latitude: number; longitude: number }>>({});
  const [geocodedDeliveryPoints, setGeocodedDeliveryPoints] = useState<Record<string, { latitude: number; longitude: number }>>({});
  const driversWithLocation = drivers.filter((driver) => driver.latitude !== null && driver.longitude !== null);
  const shopsWithLocation = shops
    .map((shop) => {
      const fallback = geocodedShopPoints[shop.id];
      const latitude = shop.latitude ?? fallback?.latitude ?? null;
      const longitude = shop.longitude ?? fallback?.longitude ?? null;

      if (latitude === null || longitude === null) return null;

      return {
        ...shop,
        mapLatitude: latitude,
        mapLongitude: longitude,
      };
    })
    .filter(Boolean) as MapShop[];
  const centerDriver = driversWithLocation[0];
  const centerShop = shopsWithLocation[0];
  const selectedDelivery = deliveries.find((delivery) => delivery.id === selectedDeliveryId) ?? null;
  const selectedDeliveryDriver = selectedDelivery?.motorcyclist_id
    ? driversWithLocation.find((driver) => driver.id === selectedDelivery.motorcyclist_id) ?? null
    : null;
  const selectedShop = selectedDelivery
    ? shopsWithLocation.find((shop) => shop.id === selectedDelivery.shop_id) ?? null
    : null;
  const selectedDeliveryDriverPosition = useMemo(() => (
    toCoordinate(selectedDeliveryDriver?.latitude, selectedDeliveryDriver?.longitude)
      ?? toCoordinate(selectedDelivery?.motorcyclists?.latitude, selectedDelivery?.motorcyclists?.longitude)
  ), [
    selectedDelivery?.motorcyclists?.latitude,
    selectedDelivery?.motorcyclists?.longitude,
    selectedDeliveryDriver?.latitude,
    selectedDeliveryDriver?.longitude,
  ]);
  const selectedShopPosition = useMemo(() => (
    selectedShop
      ? [selectedShop.mapLatitude, selectedShop.mapLongitude] as Coordinate
      : toCoordinate(selectedDelivery?.shops?.latitude, selectedDelivery?.shops?.longitude)
  ), [
    selectedDelivery?.shops?.latitude,
    selectedDelivery?.shops?.longitude,
    selectedShop,
  ]);
  const selectedDeliveryDestination = useMemo(() => {
    const fallback = selectedDelivery ? geocodedDeliveryPoints[selectedDelivery.id] : null;

    if (!selectedDelivery) return null;
    if (
      selectedDelivery.destination_latitude !== null
      && selectedDelivery.destination_latitude !== undefined
      && selectedDelivery.destination_longitude !== null
      && selectedDelivery.destination_longitude !== undefined
    ) {
      return [selectedDelivery.destination_latitude, selectedDelivery.destination_longitude] as [number, number];
    }

    return fallback ? [fallback.latitude, fallback.longitude] as [number, number] : null;
  }, [geocodedDeliveryPoints, selectedDelivery]);
  const center: [number, number] = selectedDeliveryDriverPosition
    ? selectedDeliveryDriverPosition
    : selectedShopPosition
      ? selectedShopPosition
      : centerDriver
    ? [centerDriver.latitude!, centerDriver.longitude!]
    : centerShop
      ? [centerShop.mapLatitude, centerShop.mapLongitude]
      : [-23.55052, -46.633308];

  const activeDriverIds = new Set(
    deliveries
      .filter((delivery) => ['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status))
      .map((delivery) => delivery.motorcyclist_id)
      .filter(Boolean)
  );
  const selectedDriver = driversWithLocation.find((driver) => driver.id === selectedDriverId) ?? null;
  const trackedPositions = useMemo(
    () => locationPoints.map((point) => [point.latitude, point.longitude] as [number, number]),
    [locationPoints]
  );
  const traveledPositions = useMemo(() => {
    if (!selectedDelivery || !['accepted', 'out_for_delivery', 'delivered'].includes(selectedDelivery.status)) {
      return trackedPositions;
    }

    const positions: Coordinate[] = [];
    appendUniqueCoordinate(positions, selectedShopPosition);
    trackedPositions.forEach((position) => appendUniqueCoordinate(positions, position));
    appendUniqueCoordinate(positions, selectedDeliveryDriverPosition);

    if (positions.length > 1) return positions;
    return trackedPositions;
  }, [selectedDelivery, selectedDeliveryDriverPosition, selectedShopPosition, trackedPositions]);

  useEffect(() => {
    let active = true;
    const shopsWithoutCoordinates = shops.filter((shop) => (
      (shop.latitude === null || shop.latitude === undefined || shop.longitude === null || shop.longitude === undefined)
      && !geocodedShopPoints[shop.id]
    ));

    if (shopsWithoutCoordinates.length === 0) return () => {
      active = false;
    };

    async function geocodeMissingShops() {
      const entries: Array<[string, { latitude: number; longitude: number }]> = [];

      for (const shop of shopsWithoutCoordinates) {
        try {
          const coordinates = await geocodeAddress(buildShopMapAddress(shop));
          if (coordinates) entries.push([shop.id, coordinates]);
        } catch {
          // The saved coordinates are the source of truth; this only helps older stores render on the map.
        }
      }

      if (!active || entries.length === 0) return;
      setGeocodedShopPoints((current) => ({ ...current, ...Object.fromEntries(entries) }));
    }

    geocodeMissingShops();

    return () => {
      active = false;
    };
  }, [geocodedShopPoints, shops]);

  useEffect(() => {
    let active = true;

    if (!selectedDelivery?.motorcyclist_id) {
      setLocationPoints([]);
      return () => {
        active = false;
      };
    }

    getDriverLocationPointsForPeriod(
      selectedDelivery.motorcyclist_id,
      selectedDelivery.departed_at ?? selectedDelivery.accepted_at ?? selectedDelivery.assigned_at ?? selectedDelivery.created_at,
      selectedDelivery.delivered_at,
      selectedDelivery.id
    ).then(({ data }) => {
      if (!active) return;
      setLocationPoints(data ?? []);
    });

    return () => {
      active = false;
    };
  }, [
    selectedDelivery?.id,
    selectedDelivery?.motorcyclist_id,
    selectedDelivery?.departed_at,
    selectedDelivery?.accepted_at,
    selectedDelivery?.assigned_at,
    selectedDelivery?.created_at,
    selectedDelivery?.delivered_at,
    selectedDelivery?.updated_at,
    selectedDeliveryDriver?.latitude,
    selectedDeliveryDriver?.longitude,
    selectedDeliveryDriver?.last_seen,
  ]);

  useEffect(() => {
    let active = true;

    if (!selectedDelivery || selectedDeliveryDestination || geocodedDeliveryPoints[selectedDelivery.id]) {
      return () => {
        active = false;
      };
    }

    async function geocodeSelectedDelivery() {
      try {
        const coordinates = await geocodeAddress(buildDeliveryMapAddress(selectedDelivery!));
        if (!active || !coordinates) return;
        setGeocodedDeliveryPoints((current) => ({
          ...current,
          [selectedDelivery!.id]: coordinates,
        }));
      } catch {
        // Destinations should preferably be saved with coordinates; geocoding is only a fallback.
      }
    }

    geocodeSelectedDelivery();

    return () => {
      active = false;
    };
  }, [geocodedDeliveryPoints, selectedDelivery, selectedDeliveryDestination]);

  useEffect(() => {
    let active = true;

    async function loadRemainingRoute() {
      if (
        !selectedDelivery
        || !selectedDeliveryDestination
      ) {
        setRemainingRoute([]);
        return;
      }

      const lastKnownPosition = traveledPositions[traveledPositions.length - 1] ?? null;
      const activeStartPosition = selectedDeliveryDriverPosition ?? lastKnownPosition;
      const referenceStartPosition = selectedShopPosition;
      const startPosition = selectedDelivery.status === 'delivered'
        ? referenceStartPosition
        : activeStartPosition ?? referenceStartPosition;

      if (
        !startPosition
      ) {
        setRemainingRoute([]);
        return;
      }

      const fallbackRoute: Array<[number, number]> = [
        startPosition,
        selectedDeliveryDestination,
      ];

      try {
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${startPosition[1]},${startPosition[0]};${selectedDeliveryDestination[1]},${selectedDeliveryDestination[0]}?overview=full&geometries=geojson`
        );
        const payload = await response.json() as {
          routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>;
        };
        const coordinates = payload.routes?.[0]?.geometry?.coordinates;
        const route = coordinates?.map(([longitude, latitude]) => [latitude, longitude] as [number, number]);

        if (active) setRemainingRoute(route?.length ? route : fallbackRoute);
      } catch {
        if (active) setRemainingRoute(fallbackRoute);
      }
    }

    loadRemainingRoute();

    return () => {
      active = false;
    };
  }, [selectedDelivery, selectedDeliveryDestination, selectedDeliveryDriverPosition, selectedShopPosition, traveledPositions]);

  const routeDiagnostics = useMemo(() => {
    if (!selectedDelivery) return [];

    const notes: string[] = [];

    if (!selectedShopPosition) notes.push('Loja sem coordenada salva/localizada.');
    if (selectedDelivery.motorcyclist_id && !selectedDeliveryDriverPosition) {
      notes.push('Motoqueiro sem GPS recente. Abra o painel do motoqueiro e permita localização.');
    }
    if (!selectedDeliveryDestination) notes.push('Destino sem coordenada/localização.');
    if (
      selectedDelivery.status === 'out_for_delivery'
      && selectedDeliveryDriverPosition
      && trackedPositions.length < 2
    ) {
      notes.push('Rastro real ainda sem pontos suficientes; mostrando rota de referência quando possível.');
    }

    return notes;
  }, [
    selectedDelivery,
    selectedDeliveryDestination,
    selectedDeliveryDriverPosition,
    selectedShopPosition,
    trackedPositions.length,
  ]);

  return (
    <div className="map-shell">
      <MapContainer center={center} zoom={13} scrollWheelZoom className="live-map">
        <RecenterMap center={center} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {traveledPositions.length > 1 && (
          <Polyline positions={traveledPositions} pathOptions={{ color: '#0f6b4f', weight: 5 }} />
        )}
        {remainingRoute.length > 1 && (
          <Polyline positions={remainingRoute} pathOptions={{ color: '#1f6feb', weight: 4, dashArray: '8 10' }} />
        )}
        {deliveries
          .filter((delivery) => (
            delivery.id === selectedDeliveryId
            && selectedDeliveryDestination
          ))
          .map((delivery) => (
            <Marker
              key={`destination-${delivery.id}`}
              position={selectedDeliveryDestination!}
              icon={destinationIcon}
              eventHandlers={{ click: () => onSelectDelivery?.(delivery.id) }}
            >
              <Popup>
                <div className="map-popup">
                  <strong>Destino</strong>
                  <p>{delivery.destination_address}</p>
                  <StatusBadge status={delivery.status} />
                </div>
              </Popup>
            </Marker>
          ))}
        {shopsWithLocation.map((shop) => (
          <Marker key={`shop-${shop.id}`} position={[shop.mapLatitude, shop.mapLongitude]} icon={shopIcon}>
            <Popup>
              <div className="map-popup">
                <strong>{shop.name}</strong>
                <p>Loja cadastrada</p>
                <p>{shop.address}{shop.number ? `, ${shop.number}` : ''}</p>
                <p>{shop.city}{shop.state ? ` - ${shop.state}` : ''}</p>
                {shop.cnpj && <p>CNPJ: {shop.cnpj}</p>}
              </div>
            </Popup>
          </Marker>
        ))}
        {driversWithLocation.map((driver) => {
          const activeDeliveries = deliveries.filter((delivery) => delivery.motorcyclist_id === driver.id && ['assigned', 'accepted', 'out_for_delivery'].includes(delivery.status));
          const icon = activeDriverIds.has(driver.id)
            ? routeIcon
            : driver.available
              ? availableIcon
              : offlineIcon;

          return (
            <Marker
              key={driver.id}
              position={[driver.latitude!, driver.longitude!]}
              icon={icon}
              eventHandlers={{
                click: () => {
                  setSelectedDriverId(driver.id);
                  const driverDelivery = deliveries.find((delivery) => delivery.motorcyclist_id === driver.id);
                  if (driverDelivery) onSelectDelivery?.(driverDelivery.id);
                },
              }}
            >
              <Popup>
                <div className="map-popup">
                  <strong>{driver.name}</strong>
                  <p>{driver.available ? 'Disponível' : driver.is_online ? 'Online ocupado' : 'Offline'}</p>
                  <p>Loja: {driver.shops?.name ?? '-'}</p>
                  <p>Clique para ver o trajeto percorrido e a rota a percorrer.</p>
                  {activeDeliveries.map((delivery) => (
                    <div className="map-route-card" key={delivery.id}>
                      <StatusBadge status={delivery.status} />
                      <p>Destino: {delivery.destination_address}</p>
                    </div>
                  ))}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
      {selectedDelivery && (
        <div className="map-route-legend">
          <strong>{selectedDelivery.motorcyclists?.name ?? selectedDeliveryDriver?.name ?? selectedDriver?.name ?? 'Corrida selecionada'}</strong>
          <span><i className="route-shop" /> Loja</span>
          <span><i className="route-done" /> Percorrido</span>
          <span><i className="route-next" /> {selectedDelivery.status === 'delivered' ? 'Rota referência' : 'A percorrer'}</span>
          {routeDiagnostics.length > 0 && (
            <div className="map-route-diagnostics">
              {routeDiagnostics.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
