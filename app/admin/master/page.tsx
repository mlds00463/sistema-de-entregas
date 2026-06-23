'use client';

import { AlertTriangle, CheckCircle2, Copy, ExternalLink, KeyRound, Link as LinkIcon, Lock, RefreshCw, Save, Unlock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ProtectedPage from '@/components/ProtectedPage';
import { roleLabel } from '@/lib/access';
import { formatCurrency } from '@/lib/format';
import type { Profile, Shop, SubscriptionStatus } from '@/lib/types';
import { generateEmergencyCode, getAdminProfiles, getAdminShops, setShopBlocked, updateShopSubscription } from '@/services/adminService';
import { makeShopRegistrationUrl } from '@/services/shopService';

const statusOptions: SubscriptionStatus[] = ['trial', 'active', 'overdue', 'blocked'];
type DiscountType = 'none' | 'fixed' | 'percent';
type ShopForm = {
  trialDays: string;
  monthlyPrice: string;
  baseMonthlyPrice: string;
  discountType: DiscountType;
  discountValue: string;
  dueDate: string;
  status: SubscriptionStatus;
};
const DEFAULT_MONTHLY_PRICE = 99;
const DEFAULT_PUBLIC_ORIGIN = 'https://sistemas-pi.vercel.app';
const emptyShopForm: ShopForm = {
  trialDays: '',
  monthlyPrice: String(DEFAULT_MONTHLY_PRICE),
  baseMonthlyPrice: String(DEFAULT_MONTHLY_PRICE),
  discountType: 'none',
  discountValue: '0',
  dueDate: '',
  status: 'trial',
};

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    trial: 'Teste grátis',
    active: 'Ativo',
    overdue: 'Inadimplente',
    blocked: 'Bloqueado',
  };
  return labels[status ?? ''] ?? 'Sem status';
}

function getTodayDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addOneMonthDateKey(dateKey?: string | null) {
  const today = new Date();
  const [year, month, day] = (dateKey || getTodayDateKey()).split('-').map(Number);
  const base = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
    ? new Date(year, month - 1, day)
    : today;
  const reference = base.getTime() > today.getTime() ? base : today;
  reference.setMonth(reference.getMonth() + 1);
  return `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, '0')}-${String(reference.getDate()).padStart(2, '0')}`;
}

function calculateMonthlyPrice(baseValue: number, discountType: DiscountType, discountValue: number) {
  const base = Number.isFinite(baseValue) ? Math.max(0, baseValue) : 0;
  const discount = Number.isFinite(discountValue) ? Math.max(0, discountValue) : 0;

  if (discountType === 'percent') return Math.max(0, base - (base * Math.min(discount, 100) / 100));
  if (discountType === 'fixed') return Math.max(0, base - discount);
  return base;
}

export default function AdminMasterPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [formByShop, setFormByShop] = useState<Record<string, ShopForm>>({});
  const [globalDiscountType, setGlobalDiscountType] = useState<DiscountType>('none');
  const [globalDiscountValue, setGlobalDiscountValue] = useState('0');
  const [publicOrigin, setPublicOrigin] = useState(DEFAULT_PUBLIC_ORIGIN);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: shopData, error: shopError }, { data: profileData, error: profileError }] = await Promise.all([
      getAdminShops(),
      getAdminProfiles(),
    ]);
    setLoading(false);

    if (shopError || profileError) {
      setError(shopError?.message ?? profileError?.message ?? 'Erro ao carregar dados.');
      return;
    }

    setShops(shopData ?? []);
    setProfiles(profileData ?? []);
    setFormByShop((current) => {
      const next = { ...current };
      (shopData ?? []).forEach((shop) => {
        if (!next[shop.id]) {
          next[shop.id] = {
            trialDays: '',
            monthlyPrice: String(shop.monthly_price ?? DEFAULT_MONTHLY_PRICE),
            baseMonthlyPrice: String(shop.base_monthly_price ?? shop.monthly_price ?? DEFAULT_MONTHLY_PRICE),
            discountType: (shop.discount_type ?? 'none') as DiscountType,
            discountValue: String(shop.discount_value ?? 0),
            dueDate: shop.due_date ?? '',
            status: (shop.subscription_status ?? 'trial') as SubscriptionStatus,
          };
        }
      });
      return next;
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (typeof window !== 'undefined') setPublicOrigin(window.location.origin);
  }, []);

  const overdueShops = useMemo(() => shops.filter((shop) => ['overdue', 'blocked'].includes(shop.subscription_status ?? '')), [shops]);
  const activeShops = useMemo(() => shops.filter((shop) => ['trial', 'active'].includes(shop.subscription_status ?? '')), [shops]);
  const monthlyRevenue = useMemo(() => shops.reduce((sum, shop) => (
    ['trial', 'active'].includes(shop.subscription_status ?? '')
      ? sum + Number(shop.monthly_price ?? DEFAULT_MONTHLY_PRICE)
      : sum
  ), 0), [shops]);
  const lojistaSignupUrl = useMemo(() => `${publicOrigin}/cadastro/lojista`, [publicOrigin]);

  async function copyLink(label: string, value: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copiado.`);
    } catch {
      setError('Não consegui copiar automaticamente. Selecione o link e copie manualmente.');
    }
  }

  function updateForm(shopId: string, field: keyof ShopForm, value: string) {
    const nextValue = field === 'status' ? (value as SubscriptionStatus) : value;
    setFormByShop((current) => ({
      ...current,
      [shopId]: {
        ...emptyShopForm,
        ...current[shopId],
        [field]: nextValue,
        ...(field === 'baseMonthlyPrice' || field === 'discountType' || field === 'discountValue'
          ? {
              monthlyPrice: String(calculateMonthlyPrice(
                Number(field === 'baseMonthlyPrice' ? value : current[shopId]?.baseMonthlyPrice ?? DEFAULT_MONTHLY_PRICE),
                (field === 'discountType' ? value : current[shopId]?.discountType ?? 'none') as DiscountType,
                Number(field === 'discountValue' ? value : current[shopId]?.discountValue ?? 0)
              )),
            }
          : {}),
      },
    }));
  }

  function applyGlobalDiscount() {
    setFormByShop((current) => {
      const next = { ...current };
      shops.forEach((shop) => {
        const form = next[shop.id] ?? emptyShopForm;
        const base = Number(form.baseMonthlyPrice || shop.base_monthly_price || shop.monthly_price || DEFAULT_MONTHLY_PRICE);
        const finalPrice = calculateMonthlyPrice(base, globalDiscountType, Number(globalDiscountValue || 0));
        next[shop.id] = {
          ...form,
          baseMonthlyPrice: String(base),
          discountType: globalDiscountType,
          discountValue: String(Number(globalDiscountValue || 0)),
          monthlyPrice: String(finalPrice),
        };
      });
      return next;
    });
    setMessage('Desconto aplicado na tela para todas as lojas. Clique em Salvar nas lojas que deseja confirmar.');
  }

  async function saveSubscription(shop: Shop) {
    setError(null);
    setMessage(null);
    const form = formByShop[shop.id];
    const result = await updateShopSubscription({
      shopId: shop.id,
      subscriptionStatus: form?.status,
      monthlyPrice: Number(form?.monthlyPrice || 0),
      baseMonthlyPrice: Number(form?.baseMonthlyPrice || form?.monthlyPrice || 0),
      discountType: form?.discountType ?? 'none',
      discountValue: Number(form?.discountValue || 0),
      dueDate: form?.dueDate || null,
      trialDays: form?.trialDays ? Number(form.trialDays) : undefined,
    });

    if (result.error) {
      setError(result.error);
      return;
    }

    setMessage('Assinatura atualizada.');
    await load();
  }

  async function toggleBlock(shop: Shop) {
    setError(null);
    setMessage(null);
    const result = await setShopBlocked(shop.id, shop.subscription_status !== 'blocked');
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage(shop.subscription_status === 'blocked' ? 'Loja desbloqueada.' : 'Loja bloqueada.');
    await load();
  }

  async function markPaid(shop: Shop) {
    setError(null);
    setMessage(null);
    const form = formByShop[shop.id] ?? emptyShopForm;
    const nextDueDate = addOneMonthDateKey(form.dueDate || shop.due_date);
    const result = await updateShopSubscription({
      shopId: shop.id,
      subscriptionStatus: 'active',
      monthlyPrice: Number(form.monthlyPrice || shop.monthly_price || DEFAULT_MONTHLY_PRICE),
      baseMonthlyPrice: Number(form.baseMonthlyPrice || shop.base_monthly_price || shop.monthly_price || DEFAULT_MONTHLY_PRICE),
      discountType: form.discountType,
      discountValue: Number(form.discountValue || 0),
      dueDate: nextDueDate,
    });

    if (result.error) {
      setError(result.error);
      return;
    }

    setMessage(`Pagamento marcado para ${shop.name}. Próximo vencimento: ${nextDueDate}.`);
    await load();
  }

  async function markOverdue(shop: Shop) {
    setError(null);
    setMessage(null);
    const form = formByShop[shop.id] ?? emptyShopForm;
    const result = await updateShopSubscription({
      shopId: shop.id,
      subscriptionStatus: 'overdue',
      monthlyPrice: Number(form.monthlyPrice || shop.monthly_price || DEFAULT_MONTHLY_PRICE),
      baseMonthlyPrice: Number(form.baseMonthlyPrice || shop.base_monthly_price || shop.monthly_price || DEFAULT_MONTHLY_PRICE),
      discountType: form.discountType,
      discountValue: Number(form.discountValue || 0),
      dueDate: form.dueDate || shop.due_date || getTodayDateKey(),
    });

    if (result.error) {
      setError(result.error);
      return;
    }

    setMessage(`${shop.name} marcada como vencida.`);
    await load();
  }

  async function createEmergencyCode(shop?: Shop) {
    setGeneratedCode(null);
    setError(null);
    setMessage(null);
    const result = await generateEmergencyCode({
      targetStoreId: shop?.id,
      targetUserId: shop ? undefined : selectedProfileId,
    });

    if (result.error || !result.code) {
      setError(result.error ?? 'Não foi possível gerar a senha.');
      return;
    }

    setGeneratedCode(result.code);
    setMessage('Senha emergencial gerada. Ela vale por 1 dia e libera 24 horas após o uso.');
  }

  return (
    <ProtectedPage roles={['ADMIN_MASTER']}>
      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Admin Master</p>
            <h2>Controle de acesso e assinatura</h2>
            <p className="small-text">Gerencie lojistas, bloqueios, mensalidades e senhas emergenciais.</p>
          </div>
          <button className="icon-button" onClick={load} disabled={loading}>
            <RefreshCw size={18} /> Atualizar
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}
        {message && <p className="success-text">{message}</p>}
        {generatedCode && <p className="code-line"><strong>Senha emergencial:</strong> {generatedCode}</p>}
      </section>

      <section className="stats-grid">
        <div className="stat-card"><span>Lojas</span><strong>{shops.length}</strong></div>
        <div className="stat-card"><span>Ativas / teste</span><strong>{activeShops.length}</strong></div>
        <div className="stat-card"><span>Inadimplentes</span><strong>{overdueShops.length}</strong></div>
        <div className="stat-card"><span>Receita mensal prevista</span><strong>{formatCurrency(monthlyRevenue)}</strong></div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Cadastro rápido</p>
            <h2>Links para novos cadastros</h2>
            <p className="small-text">
              Copie e envie para novos clientes criarem a loja, ou para motoqueiros entrarem direto no cadastro da loja certa.
            </p>
          </div>
          <LinkIcon size={26} />
        </div>

        <div className="share-link-grid">
          <div className="share-link-card">
            <h3>Novo cliente / lojista</h3>
            <p className="small-text">Esse link cria a conta do lojista e a loja em teste grátis.</p>
            <div className="copy-row">
              <input className="input" readOnly value={lojistaSignupUrl} />
              <button className="button secondary" type="button" onClick={() => copyLink('Link de cliente', lojistaSignupUrl)}>
                <Copy size={16} /> Copiar
              </button>
              <a className="icon-button" href={lojistaSignupUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} /> Abrir
              </a>
            </div>
          </div>

          <div className="share-link-card">
            <h3>Motoqueiros por loja</h3>
            <p className="small-text">Cada loja tem um link próprio para o motoqueiro se cadastrar e conectar o Telegram.</p>
            <div className="share-link-list">
              {shops.length === 0 && <p className="small-text">Nenhuma loja cadastrada ainda.</p>}
              {shops.map((shop) => {
                const riderUrl = makeShopRegistrationUrl(shop, publicOrigin);
                return (
                  <div className="share-link-item" key={shop.id}>
                    <div>
                      <strong>{shop.name}</strong>
                      <p className="small-text">Cadastro rápido do motoqueiro vinculado a esta loja.</p>
                    </div>
                    <div className="copy-row">
                      <input className="input" readOnly value={riderUrl} />
                      <button className="button secondary" type="button" onClick={() => copyLink(`Link de motoqueiro de ${shop.name}`, riderUrl)}>
                        <Copy size={16} /> Copiar
                      </button>
                      <a className="icon-button" href={riderUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={16} /> Abrir
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Plano único</p>
            <h2>Assinatura do sistema</h2>
            <p className="small-text">
              O sistema trabalha com um único plano. A mensalidade pode ser ajustada por loja, mas não existem variações de pacote.
            </p>
          </div>
          <strong className="code-line">{formatCurrency(DEFAULT_MONTHLY_PRICE)} como referência</strong>
        </div>
        <div className="filters">
          <select className="select compact" value={globalDiscountType} onChange={(event) => setGlobalDiscountType(event.target.value as DiscountType)}>
            <option value="none">Sem desconto</option>
            <option value="fixed">Desconto em R$</option>
            <option value="percent">Desconto em %</option>
          </select>
          <input
            className="input compact"
            type="number"
            min="0"
            step="0.01"
            value={globalDiscountValue}
            onChange={(event) => setGlobalDiscountValue(event.target.value)}
            placeholder="Valor do desconto"
          />
          <button className="button secondary" type="button" onClick={applyGlobalDiscount}>
            Aplicar desconto a todas
          </button>
        </div>
        <p className="small-text">
          Para motoqueiros, deixei a base de cobrança preparada no banco: futuramente você poderá cobrar mensalidade ou percentual das corridas, com desconto geral ou individual.
        </p>
      </section>

      <section className="panel">
        <h2>Senha emergencial por usuário</h2>
        <div className="filters">
          <select className="select" value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
            <option value="">Selecione um usuário</option>
            {profiles.map((profile) => (
              <option key={profile.user_id} value={profile.user_id}>
                {profile.name} · {roleLabel(profile.role)}
              </option>
            ))}
          </select>
          <button className="button" disabled={!selectedProfileId} onClick={() => createEmergencyCode()}>
            <KeyRound size={18} /> Gerar senha
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Lista de lojistas e lojas</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Loja</th>
                <th>Status</th>
                <th>Teste grátis</th>
                <th>Mensalidade / desconto</th>
                <th>Vencimento</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop) => {
                const form = formByShop[shop.id];
                return (
                  <tr key={shop.id}>
                    <td>
                      <strong>{shop.name}</strong>
                      <p className="small-text">{shop.contact_name || shop.legal_name || 'Sem responsável'}</p>
                    </td>
                    <td>
                      <select className="select compact" value={form?.status ?? 'trial'} onChange={(event) => updateForm(shop.id, 'status', event.target.value)}>
                        {statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                      </select>
                    </td>
                    <td><input className="input compact" type="number" min="0" placeholder="dias" value={form?.trialDays ?? ''} onChange={(event) => updateForm(shop.id, 'trialDays', event.target.value)} /></td>
                    <td>
                      <div className="billing-controls">
                        <label>
                          <span>Valor base</span>
                          <input className="input compact" type="number" min="0" step="0.01" value={form?.baseMonthlyPrice ?? '0'} onChange={(event) => updateForm(shop.id, 'baseMonthlyPrice', event.target.value)} />
                        </label>
                        <label>
                          <span>Desconto</span>
                          <select className="select compact" value={form?.discountType ?? 'none'} onChange={(event) => updateForm(shop.id, 'discountType', event.target.value)}>
                            <option value="none">Sem desconto</option>
                            <option value="fixed">R$</option>
                            <option value="percent">%</option>
                          </select>
                        </label>
                        <label>
                          <span>Valor</span>
                          <input className="input compact" type="number" min="0" step="0.01" value={form?.discountValue ?? '0'} onChange={(event) => updateForm(shop.id, 'discountValue', event.target.value)} />
                        </label>
                        <strong>{formatCurrency(Number(form?.monthlyPrice ?? 0))}</strong>
                      </div>
                    </td>
                    <td><input className="input compact" type="date" value={form?.dueDate ?? ''} onChange={(event) => updateForm(shop.id, 'dueDate', event.target.value)} /></td>
                    <td>
                      <div className="actions">
                        <button className="icon-button" onClick={() => saveSubscription(shop)}><Save size={16} /> Salvar</button>
                        <button className="button" onClick={() => markPaid(shop)}>
                          <CheckCircle2 size={16} /> Marcar pago
                        </button>
                        <button className="button secondary" onClick={() => markOverdue(shop)}>
                          <AlertTriangle size={16} /> Vencido
                        </button>
                        <button className={shop.subscription_status === 'blocked' ? 'button' : 'button danger'} onClick={() => toggleBlock(shop)}>
                          {shop.subscription_status === 'blocked' ? <Unlock size={16} /> : <Lock size={16} />}
                          {shop.subscription_status === 'blocked' ? 'Desbloquear' : 'Bloquear'}
                        </button>
                        <button className="icon-button" onClick={() => createEmergencyCode(shop)}><KeyRound size={16} /> Emergência</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </ProtectedPage>
  );
}
