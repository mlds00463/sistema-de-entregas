'use client';

import { Bike, CheckCircle2, Clock3, DollarSign, PackageCheck, Pencil, RefreshCw, Save, Send, Timer, UserCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeliveryTable from '@/components/DeliveryTable';
import ProtectedPage from '@/components/ProtectedPage';
import StatusBadge from '@/components/StatusBadge';
import { useProfile } from '@/hooks/useProfile';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { can, normalizeRole } from '@/lib/access';
import { formatCurrency, formatDateTime, formatDuration } from '@/lib/format';
import type { Delivery, Motorcyclist, Shop } from '@/lib/types';
import { lookupCep } from '@/services/cepService';
import { createDelivery, deleteDeliveryByAdmin, dispatchDeliveryFromShop, getDeliveries, markDeliveredFromShop, reassignDelivery, updateDeliveryAddress } from '@/services/deliveryService';
import { getMotorcyclists } from '@/services/driverService';
import { geocodeAddress } from '@/services/geocodeService';
import { getShops } from '@/services/shopService';
import { notifyDeliveryCallByTelegram } from '@/services/telegramService';

const activeStatuses = ['assigned', 'accepted', 'out_for_delivery'] as const;

const emptyEditForm = {
  originAddress: '',
  destinationZipcode: '',
  destinationAddress: '',
  destinationNumber: '',
  destinationComplement: '',
  destinationNeighborhood: '',
  destinationCity: '',
  destinationState: '',
  customerName: '',
  customerPhone: '',
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

function formatDateLabel(value: string) {
  if (!value) return 'Todas as datas';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function buildShopOriginAddress(shop: Shop) {
  return [
    shop.address,
    shop.number,
    shop.complement,
    shop.neighborhood,
    shop.city,
    shop.state,
    shop.zipcode ? `CEP ${shop.zipcode}` : '',
  ].filter(Boolean).join(', ');
}

type IfoodImportPayload = {
  importId?: string;
  orderId?: string;
  rawText?: string;
  customerName?: string;
  customerPhone?: string;
  destinationZipcode?: string;
  destinationAddress?: string;
  destinationNumber?: string;
  destinationComplement?: string;
  destinationNeighborhood?: string;
  destinationCity?: string;
  destinationState?: string;
};

type PreparedIfoodOrder = Required<Pick<IfoodImportPayload, 'importId'>> & IfoodImportPayload;

function cleanImportValue(value?: string | null) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function getLineAfterLabel(lines: string[], labels: string[]) {
  const normalizedLabels = labels.map((label) => normalizeImportText(label));

  for (const [index, line] of lines.entries()) {
    const normalizedLine = normalizeImportText(line);
    const label = normalizedLabels.find((item) => normalizedLine.includes(item));
    if (!label) continue;

    const inlineValue = line.split(/[:•]/).slice(1).join(' ').trim();
    if (inlineValue.length > 2) return inlineValue;

    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 6); cursor += 1) {
      const candidate = cleanImportValue(lines[cursor]);
      if (candidate.length > 2) return candidate;
    }
  }

  return '';
}

function normalizeImportText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function splitImportedAddress(address: string): Partial<IfoodImportPayload> {
  const cleanAddress = sanitizeImportedAddress(address);
  if (!cleanAddress) return {};

  const zipcode = cleanAddress.match(/\b\d{5}-?\d{3}\b/)?.[0] ?? '';
  const withoutZipcode = cleanAddress
    .replace(/\bCEP\s*/i, '')
    .replace(/\b\d{5}-?\d{3}\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ',')
    .trim();

  const pieces = withoutZipcode.split(',').map(cleanImportValue).filter(Boolean);
  let street = pieces[0] ?? withoutZipcode;
  let number = '';
  let complement = '';
  let neighborhood = '';
  let city = '';
  let state = '';

  const numberPiece = pieces[1] ?? '';
  const numberMatch = numberPiece.match(/^(\d+[A-Za-z]?)\b\s*-?\s*(.*)$/);
  if (numberMatch) {
    number = numberMatch[1];
    neighborhood = cleanImportValue(numberMatch[2]);
  } else {
    const inlineNumber = street.match(/^(.+?)\s*,?\s+(\d+[A-Za-z]?)\b(.*)$/);
    if (inlineNumber) {
      street = cleanImportValue(inlineNumber[1]);
      number = inlineNumber[2];
      neighborhood = cleanImportValue(inlineNumber[3].replace(/^[-,]/, ''));
    }
  }

  for (const piece of pieces.slice(2)) {
    const cityState = piece.match(/^(.+?)\s*[-/]\s*([A-Z]{2})$/i);
    if (cityState) {
      city = cleanImportValue(cityState[1]);
      state = cityState[2].toUpperCase();
      continue;
    }

    if (!neighborhood) {
      neighborhood = piece;
    } else if (!complement) {
      complement = piece;
    }
  }

  return {
    destinationZipcode: zipcode,
    destinationAddress: street,
    destinationNumber: number,
    destinationComplement: complement,
    destinationNeighborhood: neighborhood,
    destinationCity: city,
    destinationState: state,
  };
}

function sanitizeImportedAddress(value?: string | null) {
  return cleanImportValue(value)
    .replace(/\bLocalizador\b.*$/i, '')
    .replace(/\b(?:ID|Telefone|Entrega prevista)\s*:?.*$/i, '')
    .replace(/\bvia iFood\b.*$/i, '')
    .replace(/\biFood\s*#[A-Za-zÀ-ÿ0-9_-]+/gi, '')
    .replace(/\s*•\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/[,\s]+$/g, '')
    .trim();
}

function cleanImportedZipcode(value?: string | null, rawText = '') {
  const digits = cleanImportValue(value).replace(/\D/g, '');
  if (digits.length !== 8) return '';
  if (new RegExp(`(?:localizador|id)\\D{0,12}${digits}`, 'i').test(rawText)) return '';
  if (digits.startsWith('7687')) return '';
  return digits;
}

function parseIfoodText(rawText: string): IfoodImportPayload {
  const text = cleanImportValue(rawText);
  const lines = rawText.split(/\n+/).map(cleanImportValue).filter(Boolean);
  const possibleAddress = getLineAfterLabel(lines, [
    'endereço de entrega',
    'endereco de entrega',
    'entrega em',
    'endereço',
    'endereco',
  ]) || lines.find((line) => /\b(rua|avenida|av\.|r\.|praça|praca|alameda|travessa|rodovia)\b/i.test(line)) || '';

  const addressParts = splitImportedAddress(possibleAddress);

  return {
    rawText,
    orderId: text.match(/(?:pedido\s*)?#?\s*(\d{3,6})/i)?.[1] ?? lines.find((line) => /^\d{3,6}$/.test(line)) ?? '',
    customerName: getLineAfterLabel(lines, ['cliente', 'nome do cliente', 'consumidor']),
    customerPhone: text.match(/(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-\s]?\d{4}/)?.[0] ?? '',
    destinationZipcode: addressParts.destinationZipcode || text.match(/\b\d{5}-?\d{3}\b/)?.[0] || '',
    destinationAddress: addressParts.destinationAddress || possibleAddress,
    destinationNumber: addressParts.destinationNumber || '',
    destinationComplement: addressParts.destinationComplement || '',
    destinationNeighborhood: addressParts.destinationNeighborhood || '',
    destinationCity: addressParts.destinationCity || '',
    destinationState: addressParts.destinationState || '',
  };
}

function makeImportId(payload: IfoodImportPayload, index = 0) {
  return cleanImportValue(payload.orderId) || `${Date.now()}-${index}`;
}

function parseIfoodOrdersParam(value: string | null): PreparedIfoodOrder[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as IfoodImportPayload[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item, index) => ({
      ...item,
      importId: makeImportId(item, index),
    }));
  } catch {
    return [];
  }
}

function parseIfoodImportParam(value: string | null): PreparedIfoodOrder[] {
  if (!value || typeof window === 'undefined') return [];

  try {
    const json = decodeURIComponent(escape(window.atob(value)));
    const parsed = JSON.parse(json) as IfoodImportPayload[] | { orders?: IfoodImportPayload[] };
    const orders = Array.isArray(parsed) ? parsed : parsed.orders;
    if (!Array.isArray(orders)) return [];

    return orders.map((item, index) => ({
      ...item,
      importId: makeImportId(item, index),
    }));
  } catch {
    return [];
  }
}

function normalizeIfoodOrder(payload: IfoodImportPayload) {
  const sanitizedAddress = sanitizeImportedAddress(payload.destinationAddress ?? '');
  const addressParts = splitImportedAddress(sanitizedAddress);
  const cleanZipcode = cleanImportedZipcode(addressParts.destinationZipcode || payload.destinationZipcode, payload.rawText ?? '');
  const complementParts = [
    payload.destinationComplement || addressParts.destinationComplement,
  ].filter(Boolean);

  return {
    destinationZipcode: cleanZipcode,
    destinationAddress: cleanImportValue(addressParts.destinationAddress || sanitizedAddress),
    destinationNumber: cleanImportValue(payload.destinationNumber || addressParts.destinationNumber || ''),
    destinationComplement: complementParts.join(' - '),
    destinationNeighborhood: cleanImportValue(payload.destinationNeighborhood || addressParts.destinationNeighborhood),
    destinationCity: cleanImportValue(payload.destinationCity || addressParts.destinationCity),
    destinationState: cleanImportValue(payload.destinationState || addressParts.destinationState).toUpperCase().slice(0, 2),
    customerName: cleanImportValue(payload.customerName),
    customerPhone: cleanImportValue(payload.customerPhone),
  };
}

export default function ShopDashboardPage() {
  const { profile } = useProfile();
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState('');
  const [drivers, setDrivers] = useState<Motorcyclist[]>([]);
  const [assignedMotorcyclistId, setAssignedMotorcyclistId] = useState('');
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [originAddress, setOriginAddress] = useState('');
  const [destinationZipcode, setDestinationZipcode] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [destinationNumber, setDestinationNumber] = useState('');
  const [destinationComplement, setDestinationComplement] = useState('');
  const [destinationNeighborhood, setDestinationNeighborhood] = useState('');
  const [destinationCity, setDestinationCity] = useState('');
  const [destinationState, setDestinationState] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [creatingDelivery, setCreatingDelivery] = useState(false);
  const [assignmentChoices, setAssignmentChoices] = useState<Record<string, string>>({});
  const [reassigningDeliveryId, setReassigningDeliveryId] = useState<string | null>(null);
  const [dispatchingDeliveryId, setDispatchingDeliveryId] = useState<string | null>(null);
  const [finishingDeliveryId, setFinishingDeliveryId] = useState<string | null>(null);
  const [deletingDeliveryId, setDeletingDeliveryId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(getTodayDateKey);
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editCepLoading, setEditCepLoading] = useState(false);
  const [savingEditDeliveryId, setSavingEditDeliveryId] = useState<string | null>(null);
  const [importedIfoodOrders, setImportedIfoodOrders] = useState<PreparedIfoodOrder[]>([]);
  const [importedIfoodAssignments, setImportedIfoodAssignments] = useState<Record<string, string>>({});
  const [creatingIfoodOrderId, setCreatingIfoodOrderId] = useState<string | null>(null);
  const lastIfoodImportKeyRef = useRef('');

  const loadShops = useCallback(async () => {
    const { data } = await getShops();
    const nextShops = profile?.store_id
      ? (data ?? []).filter((shop) => shop.id === profile.store_id)
      : data ?? [];
    setShops(nextShops);
    setShopId((current) => current || nextShops?.[0]?.id || '');
    setOriginAddress((current) => current || (nextShops?.[0] ? buildShopOriginAddress(nextShops[0]) : ''));
  }, [profile?.store_id]);

  const loadDrivers = useCallback(async () => {
    const { data } = await getMotorcyclists();
    setDrivers(data ?? []);
  }, []);

  const loadDeliveries = useCallback(async () => {
    if (!shopId) return;
    setRefreshing(true);
    const { data } = await getDeliveries(shopId);
    setDeliveries(data ?? []);
    setLastUpdatedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setRefreshing(false);
  }, [shopId]);

  useEffect(() => {
    loadShops();
  }, [loadShops]);

  useEffect(() => {
    loadDrivers();
  }, [loadDrivers]);

  useEffect(() => {
    loadDeliveries();
  }, [loadDeliveries]);

  const readIfoodImportFromUrl = useCallback(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(hash);
    const importKey = `${window.location.search}|${window.location.hash}`;
    const encodedImport = params.get('ifoodImport') || hashParams.get('ifoodImport');
    const encodedBatch = params.get('ifoodOrders') || hashParams.get('ifoodOrders');
    const isSingleImport = (params.get('ifood') || hashParams.get('ifood')) === '1';
    const hasImportPayload = Boolean(encodedImport || encodedBatch || isSingleImport);

    if (!hasImportPayload || lastIfoodImportKeyRef.current === importKey) return false;

    lastIfoodImportKeyRef.current = importKey;

    const batch = parseIfoodImportParam(encodedImport);
    const legacyBatch = batch.length ? batch : parseIfoodOrdersParam(encodedBatch);

    if (legacyBatch.length) {
      const [firstOrder, ...remainingOrders] = legacyBatch;
      applyIfoodImport(firstOrder);
      setImportedIfoodOrders(remainingOrders);
      setImportedIfoodAssignments({});
      setMessage(remainingOrders.length
        ? `${legacyBatch.length} pedido(s) do iFood importado(s). O primeiro foi carregado no formulário; selecione outro abaixo para carregar.`
        : 'Pedido do iFood carregado no formulário. Confira os dados e clique em Chamar motoqueiro.');
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    }

    if (!isSingleImport) {
      setMessage('Recebi uma chamada do iFood, mas não consegui ler os dados do pedido. Use Diagnóstico na extensão e tente Enviar lista.');
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    }

    const rawText = params.get('rawText') || hashParams.get('rawText') || '';
    const parsedPayload = parseIfoodText(rawText);
    const payload = {
      ...parsedPayload,
      orderId: params.get('orderId') || hashParams.get('orderId') || parsedPayload.orderId,
      customerName: params.get('customerName') || hashParams.get('customerName') || parsedPayload.customerName,
      customerPhone: params.get('customerPhone') || hashParams.get('customerPhone') || parsedPayload.customerPhone,
      destinationZipcode: params.get('destinationZipcode') || hashParams.get('destinationZipcode') || parsedPayload.destinationZipcode,
      destinationAddress: params.get('destinationAddress') || hashParams.get('destinationAddress') || parsedPayload.destinationAddress,
    };

    const prepared = { ...payload, importId: makeImportId(payload) };
    applyIfoodImport(prepared);
    setImportedIfoodOrders([]);
    setImportedIfoodAssignments({});
    setMessage('Pedido do iFood carregado no formulário. Confira os dados e clique em Chamar motoqueiro.');

    window.history.replaceState({}, '', window.location.pathname);
    return true;
  }, []);

  useEffect(() => {
    readIfoodImportFromUrl();
    const onUrlMaybeChanged = () => readIfoodImportFromUrl();
    window.addEventListener('focus', onUrlMaybeChanged);
    window.addEventListener('popstate', onUrlMaybeChanged);
    const interval = window.setInterval(onUrlMaybeChanged, 1000);

    return () => {
      window.removeEventListener('focus', onUrlMaybeChanged);
      window.removeEventListener('popstate', onUrlMaybeChanged);
      window.clearInterval(interval);
    };
  }, [readIfoodImportFromUrl]);

  useEffect(() => {
    if (!shopId) return;
    const interval = window.setInterval(() => {
      loadDeliveries();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [loadDeliveries, shopId]);

  useRealtimeTable('deliveries', loadDeliveries, shopId ? `shop_id=eq.${shopId}` : undefined);
  useRealtimeTable('motorcyclists', loadDrivers);

  const selectableDrivers = drivers.filter((driver) => driver.active !== false).sort((a, b) => {
    if (a.current_shop_id === shopId && b.current_shop_id !== shopId) return -1;
    if (a.current_shop_id !== shopId && b.current_shop_id === shopId) return 1;
    if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  const dateFilteredDeliveries = useMemo(() => (
    deliveries.filter((delivery) => getLocalDateKey(delivery.created_at) === selectedDate)
  ), [deliveries, selectedDate]);

  const reassignableDeliveries = dateFilteredDeliveries.filter((delivery) => (
    ['pending', 'assigned', 'accepted'].includes(delivery.status)
  ));

  const dispatchableDeliveries = dateFilteredDeliveries.filter((delivery) => delivery.status === 'accepted');
  const activeRouteDeliveries = dateFilteredDeliveries.filter((delivery) => delivery.status === 'out_for_delivery');
  const deliveredToday = dateFilteredDeliveries.filter((delivery) => delivery.status === 'delivered');
  const selectedShop = shops.find((shop) => shop.id === shopId);
  const activeDriversInShop = drivers.filter((driver) => driver.active !== false && driver.current_shop_id === shopId && driver.is_online);
  const averageDurationSeconds = deliveredToday.length
    ? Math.round(deliveredToday.reduce((sum, delivery) => sum + Number(delivery.total_duration_seconds ?? 0), 0) / deliveredToday.length)
    : null;
  const dayDeliveryCost = deliveredToday.length * Number(selectedShop?.payout_amount_per_delivery ?? 0);
  const isAdminMaster = normalizeRole(profile?.role) === 'ADMIN_MASTER';
  const canEditDeliveryAddress = Boolean(profile && can(profile, 'editar_pedidos'));
  const canFinishDeliveryByShop = Boolean(profile && can(profile, 'editar_pedidos'));

  const historyDateOptions = useMemo(() => (
    Array.from(new Set([selectedDate, ...deliveries.map((delivery) => getLocalDateKey(delivery.created_at)).filter(Boolean)]))
      .sort((a, b) => b.localeCompare(a))
  ), [deliveries, selectedDate]);

  const filteredHistoryDeliveries = dateFilteredDeliveries;

  const groupingSuggestions = drivers
    .filter((driver) => driver.active !== false && driver.current_shop_id === shopId && driver.is_online)
    .map((driver) => {
      const driverActiveDeliveries = dateFilteredDeliveries.filter((delivery) => (
        delivery.motorcyclist_id === driver.id
        && activeStatuses.includes(delivery.status as typeof activeStatuses[number])
      ));

      if (driverActiveDeliveries.length === 0) return null;

      const sameNeighborhood = destinationNeighborhood
        ? driverActiveDeliveries.find((delivery) => (
          normalizeText(delivery.destination_neighborhood) === normalizeText(destinationNeighborhood)
        ))
        : null;
      const sameZipArea = destinationZipcode.replace(/\D/g, '').slice(0, 5)
        ? driverActiveDeliveries.find((delivery) => (
          (delivery.destination_zipcode ?? '').slice(0, 5) === destinationZipcode.replace(/\D/g, '').slice(0, 5)
        ))
        : null;
      const sameCity = destinationCity
        ? driverActiveDeliveries.find((delivery) => (
          normalizeText(delivery.destination_city) === normalizeText(destinationCity)
        ))
        : null;

      const matchedDelivery = sameNeighborhood ?? sameZipArea ?? sameCity;
      if (!matchedDelivery) return null;

      return {
        driver,
        delivery: matchedDelivery,
        level: sameNeighborhood || sameZipArea ? 'good' : 'attention',
        reason: sameNeighborhood
          ? 'Mesmo bairro'
          : sameZipArea
            ? 'Mesmo setor de CEP'
            : 'Mesma cidade',
      };
    })
    .filter(Boolean) as Array<{
      driver: Motorcyclist;
      delivery: Delivery;
      level: 'good' | 'attention';
      reason: string;
    }>;

  const groupingSuggestionDriverIds = new Set(groupingSuggestions.map((suggestion) => suggestion.driver.id));

  function normalizeText(value?: string | null) {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function canAssignDriverToDelivery(driver: Motorcyclist, delivery: Delivery) {
    return driver.current_shop_id === delivery.shop_id
      && driver.active !== false
      && driver.is_online
      && driver.id !== delivery.motorcyclist_id;
  }

  function driverOptionLabel(driver: Motorcyclist, delivery: Delivery) {
    if (driver.id === delivery.motorcyclist_id) return `${driver.name} - atual`;
    if (driver.active === false) return `${driver.name} - cadastro cancelado`;
    if (driver.current_shop_id !== delivery.shop_id) return `${driver.name} - fora desta loja`;
    if (!driver.is_online) return `${driver.name} - offline`;
    return `${driver.name} - ${driver.available ? 'disponível' : 'ocupado'}`;
  }

  async function createDeliveryFromPayload(input: {
    assignedMotorcyclistId?: string;
    destinationZipcode: string;
    destinationAddress: string;
    destinationNumber: string;
    destinationComplement: string;
    destinationNeighborhood: string;
    destinationCity: string;
    destinationState: string;
    customerName: string;
    customerPhone: string;
  }) {
    setMessage(null);

    const fullDestination = [
      input.destinationAddress,
      input.destinationNumber,
      input.destinationComplement,
      input.destinationNeighborhood,
      input.destinationCity,
      input.destinationState,
      input.destinationZipcode ? `CEP ${input.destinationZipcode}` : '',
    ].filter(Boolean).join(', ');

    let destinationCoordinates: { latitude: number; longitude: number } | null = null;

    try {
      destinationCoordinates = await geocodeAddress(fullDestination);
    } catch {
      destinationCoordinates = null;
    }

    const { data, error } = await createDelivery({
      shopId,
      assignedMotorcyclistId: input.assignedMotorcyclistId,
      originAddress,
      destinationAddress: fullDestination,
      destinationZipcode: input.destinationZipcode,
      destinationNumber: input.destinationNumber,
      destinationComplement: input.destinationComplement,
      destinationNeighborhood: input.destinationNeighborhood,
      destinationCity: input.destinationCity,
      destinationState: input.destinationState,
      destinationLatitude: destinationCoordinates?.latitude ?? null,
      destinationLongitude: destinationCoordinates?.longitude ?? null,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
    });

    if (error) {
      return { error: error.message };
    }

    const baseMessage = data?.motorcyclist_id ? 'Entrega criada e motoqueiro chamado.' : 'Entrega criada, mas não há motoqueiro disponível agora.';
    const routeMessage = destinationCoordinates ? '' : ' Não consegui localizar coordenadas para rota/chegada automática.';
    let telegramMessage = '';

    if (data?.id && data.motorcyclist_id) {
      const telegram = await notifyDeliveryCallByTelegram(data.id);
      const telegramData = telegram.data as { motorcyclistName?: string } | undefined;
      const riderLabel = telegramData?.motorcyclistName ? ` para ${telegramData.motorcyclistName}` : ' ao motoqueiro';
      telegramMessage = telegram.ok
        ? ` Telegram enviado${riderLabel}.`
        : ` Telegram não enviado: ${telegram.error}`;
    }

    return {
      message: `${baseMessage}${routeMessage}${telegramMessage}`,
    };
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingDelivery(true);

    const result = await createDeliveryFromPayload({
      assignedMotorcyclistId,
      destinationZipcode,
      destinationAddress,
      destinationNumber,
      destinationComplement,
      destinationNeighborhood,
      destinationCity,
      destinationState,
      customerName,
      customerPhone,
    });

    if (result.error) {
      setMessage(result.error);
      setCreatingDelivery(false);
      return;
    }

    setMessage(result.message ?? 'Entrega criada.');
    setDestinationZipcode('');
    setDestinationAddress('');
    setDestinationNumber('');
    setDestinationComplement('');
    setDestinationNeighborhood('');
    setDestinationCity('');
    setDestinationState('');
    setCustomerName('');
    setCustomerPhone('');
    setAssignedMotorcyclistId('');
    setCreatingDelivery(false);
    loadDeliveries();
    loadDrivers();
  }

  function applyIfoodImport(payload: IfoodImportPayload) {
    const normalized = normalizeIfoodOrder(payload);
    setDestinationZipcode(normalized.destinationZipcode);
    setDestinationAddress(normalized.destinationAddress);
    setDestinationNumber(normalized.destinationNumber);
    setDestinationComplement(normalized.destinationComplement);
    setDestinationNeighborhood(normalized.destinationNeighborhood);
    setDestinationCity(normalized.destinationCity);
    setDestinationState(normalized.destinationState);
    setCustomerName(normalized.customerName);
    setCustomerPhone(normalized.customerPhone);
    setMessage('Pedido do iFood carregado no formulário. Confira os dados e clique em Chamar motoqueiro.');
  }

  async function handleCreateImportedIfoodOrder(order: PreparedIfoodOrder) {
    if (!shopId) {
      setMessage('Escolha uma loja antes de criar o pedido.');
      return;
    }

    const normalized = normalizeIfoodOrder(order);
    setCreatingIfoodOrderId(order.importId);
    const result = await createDeliveryFromPayload({
      ...normalized,
      assignedMotorcyclistId: importedIfoodAssignments[order.importId] || '',
    });

    if (result.error) {
      setMessage(result.error);
      setCreatingIfoodOrderId(null);
      return;
    }

    setImportedIfoodOrders((current) => current.filter((item) => item.importId !== order.importId));
    setImportedIfoodAssignments((current) => {
      const next = { ...current };
      delete next[order.importId];
      return next;
    });
    setMessage(result.message ?? 'Pedido iFood criado.');
    setCreatingIfoodOrderId(null);
    loadDeliveries();
    loadDrivers();
  }

  async function handleCepBlur() {
    if (destinationZipcode.replace(/\D/g, '').length !== 8) return;
    setCepLoading(true);
    setMessage(null);

    try {
      const cep = await lookupCep(destinationZipcode);
      setDestinationAddress(cep.logradouro);
      setDestinationNeighborhood(cep.bairro);
      setDestinationCity(cep.localidade);
      setDestinationState(cep.uf);
      if (!destinationComplement) setDestinationComplement(cep.complemento);
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : 'Não foi possível consultar o CEP.');
    } finally {
      setCepLoading(false);
    }
  }

  async function handleReassign(delivery: Delivery) {
    const motorcyclistId = assignmentChoices[delivery.id];
    if (!motorcyclistId) {
      setMessage('Escolha um motoqueiro para chamar.');
      return;
    }

    setReassigningDeliveryId(delivery.id);
    setMessage(null);

    const { data, error } = await reassignDelivery(delivery.id, motorcyclistId);

    if (error) {
      setMessage(error.message);
    } else {
      const telegram = data?.id
        ? await notifyDeliveryCallByTelegram(data.id)
        : { ok: false, error: 'Entrega não retornada pelo banco.' };
      setMessage(telegram.ok
        ? 'Motoqueiro escolhido foi chamado e recebeu Telegram.'
        : `Motoqueiro escolhido foi chamado. Telegram não enviado: ${telegram.error}`);
      setAssignmentChoices((current) => ({ ...current, [delivery.id]: '' }));
      loadDeliveries();
      loadDrivers();
    }

    setReassigningDeliveryId(null);
  }

  async function handleDispatchDelivery(delivery: Delivery) {
    setDispatchingDeliveryId(delivery.id);
    setMessage(null);

    const { error } = await dispatchDeliveryFromShop(delivery.id);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage('Pedido despachado pela loja. O motoqueiro agora está em rota e só poderá finalizar perto do destino.');
      loadDeliveries();
      loadDrivers();
    }

    setDispatchingDeliveryId(null);
  }

  async function handleFinishDelivery(delivery: Delivery) {
    const confirmed = window.confirm('Marcar este pedido como entregue pela loja?');
    if (!confirmed) return;

    setFinishingDeliveryId(delivery.id);
    setMessage(null);

    const { error } = await markDeliveredFromShop(delivery.id);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage('Pedido marcado como entregue pela loja. O motoqueiro voltou para a fila se estiver online.');
      loadDeliveries();
      loadDrivers();
    }

    setFinishingDeliveryId(null);
  }

  async function handleDeleteDelivery(delivery: Delivery) {
    const confirmed = window.confirm('Excluir este pedido definitivamente? Esta ação não pode ser desfeita.');
    if (!confirmed) return;

    setDeletingDeliveryId(delivery.id);
    setMessage(null);

    const { error } = await deleteDeliveryByAdmin(delivery.id);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage('Pedido excluído do histórico.');
      loadDeliveries();
      loadDrivers();
    }

    setDeletingDeliveryId(null);
  }

  function startEditDelivery(delivery: Delivery) {
    setEditingDelivery(delivery);
    setEditForm({
      originAddress: delivery.origin_address ?? originAddress,
      destinationZipcode: delivery.destination_zipcode ?? '',
      destinationAddress: delivery.destination_address ?? '',
      destinationNumber: delivery.destination_number ?? '',
      destinationComplement: delivery.destination_complement ?? '',
      destinationNeighborhood: delivery.destination_neighborhood ?? '',
      destinationCity: delivery.destination_city ?? '',
      destinationState: delivery.destination_state ?? '',
      customerName: delivery.customer_name ?? '',
      customerPhone: delivery.customer_phone ?? '',
    });
    setMessage(null);
  }

  function cancelEditDelivery() {
    setEditingDelivery(null);
    setEditForm(emptyEditForm);
    setSavingEditDeliveryId(null);
  }

  async function handleEditCepBlur() {
    if (editForm.destinationZipcode.replace(/\D/g, '').length !== 8) return;
    setEditCepLoading(true);
    setMessage(null);

    try {
      const cep = await lookupCep(editForm.destinationZipcode);
      setEditForm((current) => ({
        ...current,
        destinationAddress: cep.logradouro,
        destinationNeighborhood: cep.bairro,
        destinationCity: cep.localidade,
        destinationState: cep.uf,
        destinationComplement: current.destinationComplement || cep.complemento,
      }));
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : 'Não foi possível consultar o CEP.');
    } finally {
      setEditCepLoading(false);
    }
  }

  async function handleSaveDeliveryAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDelivery) return;

    const fullDestination = [
      editForm.destinationAddress,
      editForm.destinationNumber,
      editForm.destinationComplement,
      editForm.destinationNeighborhood,
      editForm.destinationCity,
      editForm.destinationState,
      editForm.destinationZipcode ? `CEP ${editForm.destinationZipcode}` : '',
    ].filter(Boolean).join(', ');

    setSavingEditDeliveryId(editingDelivery.id);
    setMessage(null);

    let destinationCoordinates: { latitude: number; longitude: number } | null = null;
    try {
      destinationCoordinates = await geocodeAddress(fullDestination);
    } catch {
      destinationCoordinates = null;
    }

    const { error } = await updateDeliveryAddress({
      deliveryId: editingDelivery.id,
      originAddress: editForm.originAddress,
      destinationAddress: fullDestination,
      destinationZipcode: editForm.destinationZipcode,
      destinationNumber: editForm.destinationNumber,
      destinationComplement: editForm.destinationComplement,
      destinationNeighborhood: editForm.destinationNeighborhood,
      destinationCity: editForm.destinationCity,
      destinationState: editForm.destinationState,
      destinationLatitude: destinationCoordinates?.latitude ?? null,
      destinationLongitude: destinationCoordinates?.longitude ?? null,
      customerName: editForm.customerName,
      customerPhone: editForm.customerPhone,
    });

    if (error) {
      setMessage(error.message);
      setSavingEditDeliveryId(null);
      return;
    }

    setMessage(destinationCoordinates
      ? 'Pedido atualizado. Endereço e rota recalculados.'
      : 'Pedido atualizado. Não consegui recalcular a coordenada automaticamente.');
    cancelEditDelivery();
    loadDeliveries();
  }

  return (
    <ProtectedPage roles={['ADMIN_MASTER', 'LOJISTA', 'COLABORADOR_LOJISTA']} permissions={['ver_pedidos', 'criar_pedidos', 'chamar_motoqueiro']}>
      <section className="order-summary-grid">
        <div className="order-summary-card">
          <PackageCheck size={22} />
          <span>Pedidos do dia</span>
          <strong>{dateFilteredDeliveries.length}</strong>
        </div>
        <div className="order-summary-card">
          <Bike size={22} />
          <span>Motoqueiros online</span>
          <strong>{activeDriversInShop.length}</strong>
        </div>
        <div className="order-summary-card">
          <DollarSign size={22} />
          <span>Custo do dia</span>
          <strong className="fit-number">{formatCurrency(dayDeliveryCost)}</strong>
        </div>
        <div className="order-summary-card">
          <Timer size={22} />
          <span>Tempo médio</span>
          <strong>{formatDuration(averageDurationSeconds)}</strong>
        </div>
        <div className="order-summary-card">
          <Clock3 size={22} />
          <span>Aguardando despacho</span>
          <strong>{dispatchableDeliveries.length}</strong>
        </div>
        <div className="order-summary-card">
          <Send size={22} />
          <span>Em rota</span>
          <strong>{activeRouteDeliveries.length}</strong>
        </div>
      </section>

      {message && (
        <section className="panel feedback-panel">
          <strong>{message}</strong>
        </section>
      )}

      {editingDelivery && (
        <section className="panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Editar pedido</p>
              <h2>Atualizar endereço da entrega</h2>
              <p className="small-text">
                A loja pode corrigir o endereço enquanto o pedido ainda está em chamada, aceito ou em rota.
              </p>
            </div>
            <button className="button secondary" type="button" onClick={cancelEditDelivery}>
              <X size={18} /> Cancelar
            </button>
          </div>

          <form className="form-grid" onSubmit={handleSaveDeliveryAddress}>
            <label className="label" htmlFor="edit-origin">Origem</label>
            <input id="edit-origin" className="input" value={editForm.originAddress} onChange={(event) => setEditForm((current) => ({ ...current, originAddress: event.target.value }))} required />

            <label className="label" htmlFor="edit-zipcode">CEP do destino</label>
            <input id="edit-zipcode" className="input" value={editForm.destinationZipcode} onBlur={handleEditCepBlur} onChange={(event) => setEditForm((current) => ({ ...current, destinationZipcode: event.target.value }))} />
            {editCepLoading && <p className="small-text">Consultando CEP...</p>}

            <label className="label" htmlFor="edit-destination">Rua do destino</label>
            <input id="edit-destination" className="input" value={editForm.destinationAddress} onChange={(event) => setEditForm((current) => ({ ...current, destinationAddress: event.target.value }))} required />

            <label className="label" htmlFor="edit-number">Número</label>
            <input id="edit-number" className="input" value={editForm.destinationNumber} onChange={(event) => setEditForm((current) => ({ ...current, destinationNumber: event.target.value }))} required />

            <label className="label" htmlFor="edit-complement">Complemento</label>
            <input id="edit-complement" className="input" value={editForm.destinationComplement} onChange={(event) => setEditForm((current) => ({ ...current, destinationComplement: event.target.value }))} />

            <label className="label" htmlFor="edit-neighborhood">Bairro</label>
            <input id="edit-neighborhood" className="input" value={editForm.destinationNeighborhood} onChange={(event) => setEditForm((current) => ({ ...current, destinationNeighborhood: event.target.value }))} />

            <label className="label" htmlFor="edit-city">Cidade</label>
            <input id="edit-city" className="input" value={editForm.destinationCity} onChange={(event) => setEditForm((current) => ({ ...current, destinationCity: event.target.value }))} />

            <label className="label" htmlFor="edit-state">UF</label>
            <input id="edit-state" className="input" maxLength={2} value={editForm.destinationState} onChange={(event) => setEditForm((current) => ({ ...current, destinationState: event.target.value.toUpperCase() }))} />

            <label className="label" htmlFor="edit-customer">Cliente</label>
            <input id="edit-customer" className="input" value={editForm.customerName} onChange={(event) => setEditForm((current) => ({ ...current, customerName: event.target.value }))} />

            <label className="label" htmlFor="edit-phone">Telefone do cliente</label>
            <input id="edit-phone" className="input" value={editForm.customerPhone} onChange={(event) => setEditForm((current) => ({ ...current, customerPhone: event.target.value }))} />

            <button className="button" disabled={savingEditDeliveryId === editingDelivery.id}>
              <Save size={18} /> {savingEditDeliveryId === editingDelivery.id ? 'Salvando...' : 'Salvar endereço'}
            </button>
          </form>
        </section>
      )}

      {importedIfoodOrders.length > 0 && (
        <section className="panel ifood-orders-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">iFood</p>
              <h2>Pedidos importados</h2>
              <p className="small-text">
                Escolha qual pedido carregar no formulário de criação.
              </p>
            </div>
            <button className="button secondary" type="button" onClick={() => {
              setImportedIfoodOrders([]);
              setImportedIfoodAssignments({});
            }}>
              Limpar lista
            </button>
          </div>

          <div className="ifood-order-list">
            {importedIfoodOrders.map((order) => {
              const normalized = normalizeIfoodOrder(order);
              const address = [
                normalized.destinationAddress,
                normalized.destinationNumber,
                normalized.destinationComplement,
                normalized.destinationNeighborhood,
                normalized.destinationCity,
                normalized.destinationState,
                normalized.destinationZipcode ? `CEP ${normalized.destinationZipcode}` : '',
              ].filter(Boolean).join(', ');

              return (
                <article className="ifood-order-card" key={order.importId}>
                  <div>
                    <strong>{order.orderId ? `iFood #${order.orderId}` : 'Pedido iFood'}</strong>
                    <p>{normalized.customerName || 'Cliente não identificado'}</p>
                    <span>{address || 'Endereço não identificado'}</span>
                  </div>
                  <div className="ifood-order-actions">
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        applyIfoodImport(order);
                        setImportedIfoodOrders((current) => current.filter((item) => item.importId !== order.importId));
                      }}
                    >
                      Carregar no formulário
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="content-grid two">
        <div className="panel">
          <h2>Criar entrega</h2>
          <form onSubmit={handleCreate} className="form-grid">
            <label className="label" htmlFor="shop">Loja</label>
            <select id="shop" className="select" value={shopId} onChange={(e) => {
              setShopId(e.target.value);
              const shop = shops.find((item) => item.id === e.target.value);
              if (shop) setOriginAddress(buildShopOriginAddress(shop));
              setAssignedMotorcyclistId('');
            }} required>
              {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
            </select>

            <label className="label" htmlFor="origin">Origem</label>
            <input id="origin" className="input" value={originAddress} onChange={(e) => setOriginAddress(e.target.value)} required />

            <label className="label" htmlFor="destination-zipcode">CEP do destino</label>
            <input id="destination-zipcode" className="input" value={destinationZipcode} onBlur={handleCepBlur} onChange={(e) => setDestinationZipcode(e.target.value)} required />
            {cepLoading && <p className="small-text">Consultando CEP...</p>}

            <label className="label" htmlFor="destination">Rua do destino</label>
            <input id="destination" className="input" value={destinationAddress} onChange={(e) => setDestinationAddress(e.target.value)} required />

            <label className="label" htmlFor="destination-number">Número</label>
            <input id="destination-number" className="input" value={destinationNumber} onChange={(e) => setDestinationNumber(e.target.value)} required />

            <label className="label" htmlFor="destination-complement">Complemento</label>
            <input id="destination-complement" className="input" value={destinationComplement} onChange={(e) => setDestinationComplement(e.target.value)} />

            <label className="label" htmlFor="destination-neighborhood">Bairro</label>
            <input id="destination-neighborhood" className="input" value={destinationNeighborhood} onChange={(e) => setDestinationNeighborhood(e.target.value)} />

            <label className="label" htmlFor="destination-city">Cidade</label>
            <input id="destination-city" className="input" value={destinationCity} onChange={(e) => setDestinationCity(e.target.value)} />

            <label className="label" htmlFor="destination-state">UF</label>
            <input id="destination-state" className="input" value={destinationState} onChange={(e) => setDestinationState(e.target.value.toUpperCase())} maxLength={2} />

            <label className="label" htmlFor="customer-name">Cliente</label>
            <input id="customer-name" className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />

            <label className="label" htmlFor="customer-phone">Telefone do cliente</label>
            <input id="customer-phone" className="input" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />

            <label className="label" htmlFor="assigned-motorcyclist">Motoqueiro</label>
            <select id="assigned-motorcyclist" className="select" value={assignedMotorcyclistId} onChange={(e) => setAssignedMotorcyclistId(e.target.value)}>
              <option value="">Fila automática</option>
              {drivers
                .filter((driver) => driver.active !== false && driver.current_shop_id === shopId && driver.is_online)
                .map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}{driver.available ? '' : ' - já em rota'}{groupingSuggestionDriverIds.has(driver.id) ? ' - boa combinação' : ''}
                </option>
              ))}
            </select>

            {groupingSuggestions.length > 0 && (
              <div className="merge-suggestions">
                <strong>Possíveis entregas para agrupar</strong>
                {groupingSuggestions.map((suggestion) => (
                  <button
                    className={`merge-suggestion merge-suggestion-${suggestion.level}`}
                    key={`${suggestion.driver.id}-${suggestion.delivery.id}`}
                    type="button"
                    onClick={() => setAssignedMotorcyclistId(suggestion.driver.id)}
                  >
                    <span>{suggestion.driver.name}</span>
                    <small>{suggestion.reason}: {suggestion.delivery.destination_address}</small>
                  </button>
                ))}
              </div>
            )}

            <button className="button" disabled={!shopId || creatingDelivery}>
              <Send size={18} /> {creatingDelivery ? 'Criando entrega...' : 'Chamar motoqueiro'}
            </button>
          </form>
        </div>

        <div className="panel wide">
          <div className="section-header">
            <div>
              <h2>Pedidos da loja</h2>
              {lastUpdatedAt && (
                <p className="small-text">
                  Atualizado às {lastUpdatedAt} · {formatDateLabel(selectedDate)}
                </p>
              )}
            </div>
            <button className="button secondary" onClick={loadDeliveries} disabled={refreshing || !shopId}>
              <RefreshCw size={18} /> Atualizar
            </button>
          </div>
          {dispatchableDeliveries.length > 0 && (
            <div className="dispatch-panel">
              <div className="dispatch-panel-header">
                <div>
                  <strong>Pedidos aceitos pelo motoqueiro</strong>
                  <p className="small-text">Agora a loja confirma a saída do pedido para a rua.</p>
                </div>
                <span>{dispatchableDeliveries.length} pendente(s)</span>
              </div>
              <div className="dispatch-list">
                {dispatchableDeliveries.map((delivery) => (
                  <article className="dispatch-card" key={delivery.id}>
                    <div className="dispatch-card-main">
                      <CheckCircle2 size={20} />
                      <div>
                        <strong>{delivery.motorcyclists?.name ?? 'Motoqueiro'}</strong>
                        <p>{delivery.destination_address}</p>
                        <small>Aceito em {formatDateTime(delivery.accepted_at)}</small>
                      </div>
                    </div>
                    <button
                      className="button dispatch-action"
                      disabled={dispatchingDeliveryId === delivery.id}
                      onClick={() => handleDispatchDelivery(delivery)}
                    >
                      <Send size={18} /> {dispatchingDeliveryId === delivery.id ? 'Despachando...' : 'Despachar agora'}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}
          {activeRouteDeliveries.length > 0 && canFinishDeliveryByShop && (
            <div className="dispatch-panel">
              <div className="dispatch-panel-header">
                <div>
                  <strong>Pedidos em rota</strong>
                  <p className="small-text">
                    Finalize pela loja quando o cliente confirmar a entrega ou quando o GPS do motoqueiro falhar.
                  </p>
                </div>
                <span>{activeRouteDeliveries.length} em rota</span>
              </div>
              <div className="dispatch-list">
                {activeRouteDeliveries.map((delivery) => (
                  <article className="dispatch-card" key={delivery.id}>
                    <div className="dispatch-card-main">
                      <PackageCheck size={20} />
                      <div>
                        <strong>{delivery.motorcyclists?.name ?? 'Motoqueiro'}</strong>
                        <p>{delivery.destination_address}</p>
                        <small>Despachado em {formatDateTime(delivery.departed_at)}</small>
                      </div>
                    </div>
                    <div className="actions">
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => startEditDelivery(delivery)}
                      >
                        <Pencil size={18} /> Editar endereço
                      </button>
                      <button
                        className="button dispatch-action"
                        disabled={finishingDeliveryId === delivery.id}
                        onClick={() => handleFinishDelivery(delivery)}
                      >
                        <PackageCheck size={18} /> {finishingDeliveryId === delivery.id ? 'Finalizando...' : 'Marcar entregue'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
          <div className="history-toolbar">
            <div>
              <h3 className="panel-subtitle">Histórico de pedidos</h3>
              <p className="small-text">
                Exibindo {filteredHistoryDeliveries.length} pedido(s) de {formatDateLabel(selectedDate)}.
              </p>
            </div>
            <div className="filters">
              <input
                className="input compact"
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
              <select
                className="select compact"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              >
                {historyDateOptions.map((dateKey) => (
                  <option key={dateKey} value={dateKey}>
                    {formatDateLabel(dateKey)}
                  </option>
                ))}
              </select>
              <button className="button secondary" type="button" onClick={() => setSelectedDate(getTodayDateKey())}>
                Hoje
              </button>
            </div>
          </div>
          <DeliveryTable
            deliveries={filteredHistoryDeliveries}
            canDelete={isAdminMaster}
            deletingDeliveryId={deletingDeliveryId}
            onDeleteDelivery={(delivery) => handleDeleteDelivery(delivery as Delivery)}
            canEditAddress={canEditDeliveryAddress}
            editingDeliveryId={editingDelivery?.id ?? null}
            onEditDelivery={(delivery) => startEditDelivery(delivery as Delivery)}
          />
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Escolher motoqueiro com fila em andamento</h2>
            <p className="small-text">
              Troque o motoqueiro enquanto a entrega ainda não saiu para a rua. Exibindo {formatDateLabel(selectedDate)}.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Criada</th>
                <th>Destino</th>
                <th>Atual</th>
                <th>Status</th>
                <th>Novo motoqueiro</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {reassignableDeliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{formatDateTime(delivery.created_at)}</td>
                  <td>{delivery.destination_address}</td>
                  <td>{delivery.motorcyclists?.name ?? 'Fila sem motoqueiro'}</td>
                  <td><StatusBadge status={delivery.status} /></td>
                  <td>
                    <select
                      className="select compact"
                      value={assignmentChoices[delivery.id] ?? ''}
                      onChange={(event) => setAssignmentChoices((current) => ({ ...current, [delivery.id]: event.target.value }))}
                    >
                      <option value="">Escolher</option>
                      {selectableDrivers.map((driver) => (
                        <option
                          key={driver.id}
                          value={driver.id}
                          disabled={!canAssignDriverToDelivery(driver, delivery)}
                        >
                          {driverOptionLabel(driver, delivery)}
                        </option>
                      ))}
                      {selectableDrivers.length === 0 && <option disabled>Nenhum motoqueiro cadastrado</option>}
                    </select>
                  </td>
                  <td>
                    <button className="button" disabled={!assignmentChoices[delivery.id] || reassigningDeliveryId === delivery.id} onClick={() => handleReassign(delivery)}>
                      <UserCheck size={18} /> Chamar
                    </button>
                  </td>
                </tr>
              ))}
              {reassignableDeliveries.length === 0 && (
                <tr>
                  <td colSpan={6}>Nenhuma entrega em chamada para trocar motoqueiro nesta data.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </ProtectedPage>
  );
}
