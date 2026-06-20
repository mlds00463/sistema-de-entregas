'use client';

import QRCode from 'react-qr-code';
import { Check, CreditCard, FileUp, History, Pencil, RefreshCw, Save, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import ProtectedPage from '@/components/ProtectedPage';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { formatDateTime } from '@/lib/format';
import { createPixPayload, formatCurrency, getPixKeyWarning, normalizePixKey } from '@/lib/pix';
import type { Delivery, DriverPayout, Motorcyclist, Shop } from '@/lib/types';
import { getDeliveries } from '@/services/deliveryService';
import { getMotorcyclists, updateMotorcyclistByManager } from '@/services/driverService';
import {
  createDriverPayout,
  getDriverPayouts,
  getPayoutReceiptUrl,
  updatePayoutPaymentStatus,
  updateShopPayoutSettings,
  uploadPayoutReceipt,
} from '@/services/paymentService';
import { getShops } from '@/services/shopService';

const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';
const DAY_KEY_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: SAO_PAULO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

type PayoutDriver = Motorcyclist & {
  shops?: { name: string | null; cnpj: string | null } | null;
};

type DailyPayoutBreakdown = {
  dayKey: string;
  deliveryCount: number;
  paidUnits: number;
};

type PayoutSummary = {
  driver: PayoutDriver;
  unpaidDeliveries: Delivery[];
  dailyBreakdown: DailyPayoutBreakdown[];
  coveredDays: number;
  deliveryCount: number;
  minimumPerDay: number;
  paidUnits: number;
  amountPerDelivery: number;
  amountTotal: number;
  lastPayout?: DriverPayout;
};

const emptyDriverForm = {
  name: '',
  phone: '',
  pixKey: '',
  pixKeyType: 'cpf',
  payoutName: '',
};

function dayKeyFromValue(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = DAY_KEY_FORMATTER.formatToParts(date).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dayKey: string, amount: number) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return date.toISOString().slice(0, 10);
}

function buildDayRange(startDay: string, endDay: string) {
  const days: string[] = [];
  let current = startDay;

  while (current <= endDay && days.length < 3700) {
    days.push(current);
    current = addDays(current, 1);
  }

  return days;
}

function formatDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split('-');
  return `${day}/${month}/${year}`;
}

function getPeriodStartDay(lastPayout: DriverPayout | undefined, unpaidDayKeys: string[], todayKey: string) {
  const firstUnpaidDay = unpaidDayKeys[0];

  if (!lastPayout?.paid_at) {
    return firstUnpaidDay ?? todayKey;
  }

  const lastPaidDay = dayKeyFromValue(lastPayout.paid_at);
  const nextOpenDay = addDays(lastPaidDay, 1);

  if (firstUnpaidDay && firstUnpaidDay <= lastPaidDay) {
    return firstUnpaidDay;
  }

  return nextOpenDay;
}

export default function PaymentsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState('');
  const [drivers, setDrivers] = useState<PayoutDriver[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [payouts, setPayouts] = useState<DriverPayout[]>([]);
  const [amountInput, setAmountInput] = useState('0');
  const [minimumInput, setMinimumInput] = useState('10');
  const [message, setMessage] = useState<string | null>(null);
  const [generatedPayout, setGeneratedPayout] = useState<DriverPayout | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingDriver, setEditingDriver] = useState<PayoutDriver | null>(null);
  const [driverForm, setDriverForm] = useState(emptyDriverForm);
  const [receiptFiles, setReceiptFiles] = useState<Record<string, File | null>>({});
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});
  const [paymentNotes, setPaymentNotes] = useState<Record<string, string>>({});
  const [savingPaymentId, setSavingPaymentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');

  const selectedShop = useMemo(() => shops.find((shop) => shop.id === shopId) ?? null, [shops, shopId]);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: shopData }, { data: driverData }, { data: deliveryData }, { data: payoutData }] = await Promise.all([
      getShops(),
      getMotorcyclists(),
      getDeliveries(shopId || undefined),
      getDriverPayouts(shopId || undefined),
    ]);

    setShops(shopData ?? []);
    setDrivers((driverData ?? []) as PayoutDriver[]);
    setDeliveries(deliveryData ?? []);
    setPayouts(payoutData ?? []);
    setShopId((current) => current || shopData?.[0]?.id || '');
    setRefreshing(false);
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedShop) return;
    setAmountInput(String(selectedShop.payout_amount_per_delivery ?? 0));
    setMinimumInput(String(selectedShop.minimum_guaranteed_deliveries ?? 10));
  }, [selectedShop]);

  useRealtimeTable('deliveries', load);
  useRealtimeTable('driver_payouts', load);
  useRealtimeTable('motorcyclists', load);

  useEffect(() => {
    const paths = payouts.filter((payout) => payout.receipt_path);
    if (paths.length === 0) {
      setReceiptUrls({});
      return;
    }

    let active = true;
    Promise.all(paths.map(async (payout) => {
      const { data } = await getPayoutReceiptUrl(payout.receipt_path!);
      return [payout.id, data?.signedUrl ?? ''] as const;
    })).then((entries) => {
      if (!active) return;
      setReceiptUrls(Object.fromEntries(entries.filter(([, url]) => Boolean(url))));
    });

    return () => {
      active = false;
    };
  }, [payouts]);

  const summaries = useMemo<PayoutSummary[]>(() => {
    if (!selectedShop) return [];

    const unpaid = deliveries.filter((delivery) => (
      delivery.shop_id === selectedShop.id
      && delivery.status === 'delivered'
      && !delivery.driver_payout_id
      && delivery.motorcyclist_id
    ));

    const driverIds = new Set<string>();
    drivers.forEach((driver) => {
      if (driver.current_shop_id === selectedShop.id) driverIds.add(driver.id);
    });
    unpaid.forEach((delivery) => {
      if (delivery.motorcyclist_id) driverIds.add(delivery.motorcyclist_id);
    });

    const amountPerDelivery = Number(selectedShop.payout_amount_per_delivery ?? 0);
    const minimumPerDay = Number(selectedShop.minimum_guaranteed_deliveries ?? 10);
    const todayKey = dayKeyFromValue(new Date());

    return Array.from(driverIds)
      .map((driverId) => {
        const driver = drivers.find((item) => item.id === driverId);
        if (!driver) return null;

        const driverDeliveries = unpaid.filter((delivery) => delivery.motorcyclist_id === driverId);
        const deliveriesByDay = new Map<string, number>();

        driverDeliveries.forEach((delivery) => {
          const dayKey = dayKeyFromValue(delivery.delivered_at ?? delivery.created_at);
          deliveriesByDay.set(dayKey, (deliveriesByDay.get(dayKey) ?? 0) + 1);
        });

        const unpaidDayKeys = Array.from(deliveriesByDay.keys()).sort();
        const lastPaidPayout = payouts.find((payout) => (
          payout.shop_id === selectedShop.id
          && payout.motorcyclist_id === driverId
          && (payout.payment_status ?? 'pending') === 'paid'
        ));
        const periodStartDay = getPeriodStartDay(lastPaidPayout, unpaidDayKeys, todayKey);
        const periodDays = periodStartDay <= todayKey ? buildDayRange(periodStartDay, todayKey) : [];

        const dailyBreakdown = periodDays.map((dayKey) => {
          const deliveryCount = deliveriesByDay.get(dayKey) ?? 0;
          return {
            dayKey,
            deliveryCount,
            paidUnits: Math.max(deliveryCount, minimumPerDay),
          };
        });

        const deliveryCount = dailyBreakdown.reduce((sum, item) => sum + item.deliveryCount, 0);
        const paidUnits = dailyBreakdown.reduce((sum, item) => sum + item.paidUnits, 0);

        return {
          driver,
          unpaidDeliveries: driverDeliveries,
          dailyBreakdown,
          coveredDays: dailyBreakdown.length,
          deliveryCount,
          minimumPerDay,
          paidUnits,
          amountPerDelivery,
          amountTotal: paidUnits * amountPerDelivery,
          lastPayout: lastPaidPayout,
        };
      })
      .filter(Boolean) as PayoutSummary[];
  }, [deliveries, drivers, payouts, selectedShop]);

  const paidPayouts = useMemo(() => (
    payouts.filter((payout) => (payout.payment_status ?? 'pending') === 'paid')
  ), [payouts]);

  const pixPayload = generatedPayout?.pix_key
    ? createPixPayload({
      pixKey: generatedPayout.pix_key,
      pixKeyType: generatedPayout.pix_key_type,
      amount: Number(generatedPayout.amount_total),
      recipientName: generatedPayout.recipient_name,
      txid: generatedPayout.id,
      description: `Pagamento ${generatedPayout.covered_days ?? 1} dia(s)`,
    })
    : '';

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedShop) return;

    const { error } = await updateShopPayoutSettings(
      selectedShop.id,
      Number(amountInput || 0),
      Number(minimumInput || 0)
    );

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Configuração de pagamento salva.');
    load();
  }

  function startEditingDriver(driver: PayoutDriver) {
    setEditingDriver(driver);
    setDriverForm({
      name: driver.name ?? '',
      phone: driver.phone ?? '',
      pixKey: driver.pix_key ?? '',
      pixKeyType: driver.pix_key_type === 'telefone' ? 'phone' : driver.pix_key_type ?? 'cpf',
      payoutName: driver.payout_name ?? driver.name ?? '',
    });
  }

  const generatedPixKey = generatedPayout?.pix_key
    ? normalizePixKey(generatedPayout.pix_key, generatedPayout.pix_key_type)
    : '';
  const generatedPixWarning = generatedPayout?.pix_key
    ? getPixKeyWarning(generatedPayout.pix_key, generatedPayout.pix_key_type)
    : null;
  const driverPixWarning = getPixKeyWarning(driverForm.pixKey, driverForm.pixKeyType);

  async function saveDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDriver) return;

    const { error } = await updateMotorcyclistByManager({
      motorcyclistId: editingDriver.id,
      name: driverForm.name,
      phone: driverForm.phone,
      pixKey: driverForm.pixKey,
      pixKeyType: driverForm.pixKeyType,
      payoutName: driverForm.payoutName,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Pix salvo com sucesso.');
    setEditingDriver(null);
    setDriverForm(emptyDriverForm);
    load();
  }

  async function payDriver(summary: PayoutSummary) {
    if (!selectedShop) return;
    setMessage(null);
    setGeneratedPayout(null);

    const { data, error } = await createDriverPayout(selectedShop.id, summary.driver.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setGeneratedPayout(data as DriverPayout);
    setMessage('Pix gerado como pendente. Depois de pagar, marque como pago e anexe o comprovante.');
    load();
  }

  function openCurrentTab() {
    setActiveTab('current');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openHistoryTab() {
    setActiveTab('history');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function updatePaymentStatus(payout: DriverPayout, paymentStatus: 'paid' | 'not_paid') {
    setSavingPaymentId(payout.id);
    setMessage(null);

    const file = receiptFiles[payout.id];
    let receiptPath: string | null = null;
    let receiptFileName: string | null = null;

    if (file) {
      const { data, error } = await uploadPayoutReceipt(payout.id, file);
      if (error) {
        setSavingPaymentId(null);
        setMessage(error.message);
        return;
      }
      receiptPath = data.path;
      receiptFileName = file.name;
    }

    const { data, error } = await updatePayoutPaymentStatus({
      payoutId: payout.id,
      paymentStatus,
      receiptPath,
      receiptFileName,
      paymentNote: paymentNotes[payout.id] ?? payout.payment_note,
    });

    if (error) {
      setMessage(error.message);
    } else {
      if (generatedPayout?.id === payout.id && paymentStatus === 'not_paid') {
        setGeneratedPayout(null);
      } else if (generatedPayout?.id === payout.id) {
        setGeneratedPayout(data as DriverPayout);
      }
      setMessage(paymentStatus === 'paid' ? 'Pagamento marcado como pago.' : 'Pagamento marcado como não pago. Você pode gerar um novo QR Code na apuração atual.');
      setReceiptFiles((current) => ({ ...current, [payout.id]: null }));
      load();
    }

    setSavingPaymentId(null);
  }

  function paymentStatusLabel(status: DriverPayout['payment_status']) {
    if (status === 'paid') return 'Pago';
    if (status === 'not_paid') return 'Não pago';
    return 'Pendente';
  }

  function paymentStatusClass(status: DriverPayout['payment_status']) {
    if (status === 'paid') return 'status-delivered';
    if (status === 'not_paid') return 'status-rejected';
    return 'status-assigned';
  }

  function getPayBlockReason(summary: PayoutSummary) {
    if (!summary.driver.pix_key) return 'Cadastre a chave Pix primeiro.';
    if (summary.coveredDays <= 0 || summary.amountTotal <= 0) return 'Sem valor aberto para gerar Pix.';
    return null;
  }

  function startPixRegister(summary: PayoutSummary) {
    setMessage('Cadastre a chave Pix do motoqueiro para liberar o botão Gerar Pix.');
    startEditingDriver(summary.driver);
  }

  return (
    <ProtectedPage roles={['ADMIN_MASTER']}>
      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Pagamentos dos motoqueiros</h2>
            <p className="small-text">Apure corridas por dia, mínimo diário garantido e gere Pix com registro de pagamento.</p>
          </div>
          <div className="actions">
            <button className={activeTab === 'current' ? 'button' : 'button secondary'} type="button" onClick={openCurrentTab}>
              <CreditCard size={18} /> Apuração
            </button>
            <button className={activeTab === 'history' ? 'button' : 'button secondary'} type="button" onClick={openHistoryTab}>
              <History size={18} /> Histórico
            </button>
            <button className="button secondary" type="button" onClick={load} disabled={refreshing}>
              <RefreshCw size={18} /> Atualizar
            </button>
          </div>
        </div>

        <div className="filters">
          <select className="select compact" value={shopId} onChange={(event) => setShopId(event.target.value)}>
            {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
          </select>
        </div>
      </section>

      {activeTab === 'current' && selectedShop && (
        <section className="content-grid two">
          <div className="panel">
            <h2>Regra da loja</h2>
            <form className="form-grid" onSubmit={saveSettings}>
              <label className="label" htmlFor="amount">Valor por corrida</label>
              <input id="amount" className="input" type="number" min="0" step="0.01" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} />

              <label className="label" htmlFor="minimum">Mínimo garantido por dia</label>
              <input id="minimum" className="input" type="number" min="0" step="1" value={minimumInput} onChange={(event) => setMinimumInput(event.target.value)} />

              {message && <p className="small-text">{message}</p>}
              <button className="button"><Save size={18} /> Salvar regra</button>
            </form>
          </div>

          <div className="panel">
            <h2>Pix gerado</h2>
            {!generatedPayout && <p className="small-text">Ao registrar um pagamento, o QR Code Pix aparece aqui.</p>}
            {generatedPayout && (
              <div className="pix-box">
                <QRCode value={pixPayload} size={220} />
                <div>
                  <strong>{generatedPayout.recipient_name}</strong>
                  <p className="small-text">Valor: {formatCurrency(Number(generatedPayout.amount_total))}</p>
                  <p className="small-text">
                    Dias: {generatedPayout.covered_days ?? 1} · corridas feitas: {generatedPayout.delivery_count} · pagas: {generatedPayout.paid_units}
                  </p>
                  <p className="small-text">Status: {paymentStatusLabel(generatedPayout.payment_status ?? 'pending')}</p>
                  <p className="small-text">Chave usada: {generatedPixKey}</p>
                  {generatedPixWarning && <p className="error-text">{generatedPixWarning}</p>}
                  <textarea className="textarea pix-copy" readOnly value={pixPayload} />
                  {(generatedPayout.payment_status ?? 'pending') === 'pending' && (
                    <div className="payment-actions pix-payment-actions">
                      <input
                        className="input"
                        placeholder="Observação do pagamento"
                        value={paymentNotes[generatedPayout.id] ?? generatedPayout.payment_note ?? ''}
                        onChange={(event) => setPaymentNotes((current) => ({ ...current, [generatedPayout.id]: event.target.value }))}
                      />
                      <label className="button secondary file-button">
                        <FileUp size={18} /> Comprovante
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(event) => setReceiptFiles((current) => ({ ...current, [generatedPayout.id]: event.target.files?.[0] ?? null }))}
                        />
                      </label>
                      {receiptFiles[generatedPayout.id] && <p className="small-text">{receiptFiles[generatedPayout.id]?.name}</p>}
                      <div className="actions">
                        <button className="button" type="button" disabled={savingPaymentId === generatedPayout.id} onClick={() => updatePaymentStatus(generatedPayout, 'paid')}>
                          <Check size={18} /> Pago
                        </button>
                        <button className="button danger" type="button" disabled={savingPaymentId === generatedPayout.id} onClick={() => updatePaymentStatus(generatedPayout, 'not_paid')}>
                          <X size={18} /> Não pago
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === 'current' && editingDriver && (
        <section className="panel">
          <div className="section-header">
            <div>
              <h2>Pix do motoqueiro</h2>
              <p className="small-text">Atualize telefone, chave Pix e nome usado no pagamento.</p>
            </div>
            <button className="button secondary" type="button" onClick={() => setEditingDriver(null)}>
              <X size={18} /> Fechar
            </button>
          </div>

          <form className="form-grid" onSubmit={saveDriver}>
            <label className="label" htmlFor="driver-name">Nome</label>
            <input id="driver-name" className="input" value={driverForm.name} onChange={(event) => setDriverForm((current) => ({ ...current, name: event.target.value }))} />

            <label className="label" htmlFor="driver-phone">Telefone</label>
            <input id="driver-phone" className="input" value={driverForm.phone} onChange={(event) => setDriverForm((current) => ({ ...current, phone: event.target.value }))} />

            <label className="label" htmlFor="driver-pix-type">Tipo da chave Pix</label>
            <select id="driver-pix-type" className="select" value={driverForm.pixKeyType} onChange={(event) => setDriverForm((current) => ({ ...current, pixKeyType: event.target.value }))}>
              <option value="cpf">CPF</option>
              <option value="phone">Telefone</option>
              <option value="email">E-mail</option>
            </select>

            <label className="label" htmlFor="driver-pix">Chave Pix</label>
            <input id="driver-pix" className="input" value={driverForm.pixKey} onChange={(event) => setDriverForm((current) => ({ ...current, pixKey: event.target.value }))} />
            {driverForm.pixKey && (
              <p className={driverPixWarning ? 'error-text' : 'small-text'}>
                {driverPixWarning ?? `Chave no QR: ${normalizePixKey(driverForm.pixKey, driverForm.pixKeyType)}`}
              </p>
            )}

            <label className="label" htmlFor="driver-payout-name">Nome para Pix</label>
            <input id="driver-payout-name" className="input" value={driverForm.payoutName} onChange={(event) => setDriverForm((current) => ({ ...current, payoutName: event.target.value }))} />

            <button className="button"><Save size={18} /> Salvar cadastro</button>
          </form>
        </section>
      )}

      {activeTab === 'current' && (
      <section className="panel">
        <h2>Apuração atual</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Motoqueiro</th>
                <th>Dias</th>
                <th>Corridas feitas</th>
                <th>Mínimo/dia</th>
                <th>Corridas pagas</th>
                <th>Valor</th>
                <th>Pix</th>
                <th>Último pagamento</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((summary) => {
                const hasPix = Boolean(summary.driver.pix_key);
                const payBlockReason = getPayBlockReason(summary);
                const dayText = summary.dailyBreakdown
                  .slice(-4)
                  .map((day) => `${formatDayKey(day.dayKey)}: ${day.deliveryCount}/${day.paidUnits}`)
                  .join(' · ');

                return (
                  <tr key={summary.driver.id}>
                    <td>{summary.driver.name}</td>
                    <td>
                      {summary.coveredDays}
                      {dayText && <p className="small-text">{dayText}</p>}
                    </td>
                    <td>{summary.deliveryCount}</td>
                    <td>{summary.minimumPerDay}</td>
                    <td>{summary.paidUnits}</td>
                    <td>{formatCurrency(summary.amountTotal)}</td>
                    <td>{hasPix ? summary.driver.pix_key_type ?? 'Pix' : 'Sem chave Pix'}</td>
                    <td>{formatDateTime(summary.lastPayout?.paid_at)}</td>
                    <td>
                      <div className="actions">
                        <button className="button secondary" type="button" onClick={() => startEditingDriver(summary.driver)}>
                          <Pencil size={18} /> Editar
                        </button>
                        {!hasPix ? (
                          <button className="button" type="button" onClick={() => startPixRegister(summary)}>
                            <CreditCard size={18} /> Cadastrar Pix
                          </button>
                        ) : (
                          <button className="button" type="button" disabled={Boolean(payBlockReason)} title={payBlockReason ?? undefined} onClick={() => payDriver(summary)}>
                            <CreditCard size={18} /> Gerar Pix
                          </button>
                        )}
                      </div>
                      {payBlockReason && hasPix && <p className="small-text">{payBlockReason}</p>}
                    </td>
                  </tr>
                );
              })}
              {summaries.length === 0 && (
                <tr>
                  <td colSpan={9}>Nenhum motoqueiro para apuração nesta loja.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {activeTab === 'history' && (
      <section className="panel" id="historico-pagamentos">
        <div className="section-header">
          <div>
            <h2>Histórico de pagamentos</h2>
            <p className="small-text">Somente pagamentos confirmados como pagos entram neste histórico.</p>
          </div>
        </div>
        <div className="stack">
          {paidPayouts.map((payout) => {
            return (
              <div className="history-row" key={payout.id}>
                <div>
                  <strong>{payout.motorcyclists?.name ?? payout.recipient_name}</strong>
                  <p className="small-text">
                    {formatDateTime(payout.paid_at)} · {payout.covered_days ?? 1} dia(s) · {payout.delivery_count} corridas feitas · {payout.paid_units} pagas
                  </p>
                  <p className="small-text">
                    Status: Pago
                    {payout.payment_confirmed_at ? ` · confirmado em ${formatDateTime(payout.payment_confirmed_at)}` : ''}
                  </p>
                  {payout.payment_note && <p className="small-text">Obs.: {payout.payment_note}</p>}
                  {receiptUrls[payout.id] && (
                    <a className="small-text" href={receiptUrls[payout.id]} target="_blank" rel="noreferrer">
                      Ver comprovante: {payout.receipt_file_name ?? 'arquivo'}
                    </a>
                  )}
                </div>
                <div className="payment-actions">
                  <div className="actions">
                    <span className={`status-chip ${paymentStatusClass('paid')}`}>
                      <Check size={14} />
                      Pago
                    </span>
                    <span className="status-chip status-delivered">{formatCurrency(Number(payout.amount_total))}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {paidPayouts.length === 0 && <p className="small-text">Nenhum pagamento pago registrado ainda.</p>}
        </div>
      </section>
      )}
    </ProtectedPage>
  );
}
