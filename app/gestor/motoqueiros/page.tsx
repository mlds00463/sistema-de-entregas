'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import { CheckCircle2, Copy, ExternalLink, Pencil, PlusCircle, QrCode, RefreshCw, Save, Search, Send, X } from 'lucide-react';
import ProtectedPage from '@/components/ProtectedPage';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { formatDateTime } from '@/lib/format';
import { buildTelegramAppLink, buildTelegramDeepLink } from '@/lib/telegram';
import type { Motorcyclist } from '@/lib/types';
import { createMotorcyclistByAdmin, getMotorcyclists, setMotorcyclistActiveByManager, updateMotorcyclistByManager } from '@/services/driverService';
import { syncTelegramUpdates } from '@/services/telegramService';

type DriverWithShop = Motorcyclist & {
  shops?: {
    name?: string | null;
    cnpj?: string | null;
    address?: string | null;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
};

const emptyForm = {
  name: '',
  phone: '',
  pixKey: '',
  pixKeyType: 'cpf',
  payoutName: '',
};

const emptyCreateForm = {
  name: '',
  phone: '',
  email: '',
  password: '',
  pixKey: '',
  pixKeyType: 'cpf',
  payoutName: '',
};

function statusChip(label: string, active: boolean) {
  return (
    <span className={`status-chip ${active ? 'status-delivered' : 'status-cancelled'}`}>
      {label}
    </span>
  );
}

function phoneHint(phone: string | null | undefined) {
  if (!phone) return 'Sem telefone cadastrado';
  return 'Telefone usado apenas como contato. As chamadas automaticas agora usam Telegram.';
}

export default function ManagerMotorcyclistsPage() {
  const [drivers, setDrivers] = useState<DriverWithShop[]>([]);
  const [editingDriver, setEditingDriver] = useState<DriverWithShop | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncingTelegram, setSyncingTelegram] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [telegramQr, setTelegramQr] = useState<{ driverName: string; appLink: string; webLink: string; startCommand: string } | null>(null);
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await getMotorcyclists();
    setLoading(false);

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setDrivers((data ?? []) as DriverWithShop[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeTable('motorcyclists', load);

  const filteredDrivers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return drivers;

    return drivers.filter((driver) => {
      const content = [
        driver.name,
        driver.phone,
        driver.pix_key,
        driver.payout_name,
        driver.shops?.name,
        driver.telegram_username,
        driver.telegram_first_name,
        driver.telegram_last_name,
      ].filter(Boolean).join(' ').toLowerCase();

      return content.includes(term);
    });
  }, [drivers, search]);

  const totals = useMemo(() => ({
    total: drivers.length,
    online: drivers.filter((driver) => driver.active !== false && driver.is_online).length,
    available: drivers.filter((driver) => driver.active !== false && driver.available).length,
    withoutTelegram: drivers.filter((driver) => !driver.telegram_chat_id).length,
    inactive: drivers.filter((driver) => driver.active === false).length,
  }), [drivers]);

  function startEditing(driver: DriverWithShop) {
    setEditingDriver(driver);
    setForm({
      name: driver.name ?? '',
      phone: driver.phone ?? '',
      pixKey: driver.pix_key ?? '',
      pixKeyType: driver.pix_key_type ?? 'cpf',
      payoutName: driver.payout_name ?? '',
    });
    setMessage(null);
    setError(null);
  }

  function cancelEditing() {
    setEditingDriver(null);
    setForm(emptyForm);
    setMessage(null);
    setError(null);
  }

  async function createDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!createForm.name.trim()) {
      setError('Informe o nome do motoqueiro.');
      return;
    }

    if (!createForm.phone.trim()) {
      setError('Informe o telefone do motoqueiro.');
      return;
    }

    if (createForm.password.trim() && createForm.password.trim().length < 6) {
      setError('A senha inicial precisa ter pelo menos 6 caracteres.');
      return;
    }

    setCreating(true);
    setMessage(null);
    setError(null);

    const { data: createdDriver, error: createError } = await createMotorcyclistByAdmin({
      name: createForm.name,
      phone: createForm.phone,
      email: createForm.email || undefined,
      password: createForm.password || undefined,
      pixKey: createForm.pixKey,
      pixKeyType: createForm.pixKeyType,
      payoutName: createForm.payoutName,
    });

    setCreating(false);

    if (createError) {
      setError(createError.message);
      return;
    }

    const generated = createdDriver?.generatedCredentials;
    setMessage(generated
      ? `Motoqueiro cadastrado. Login gerado: ${generated.email}. Senha inicial: ${generated.password}`
      : `Motoqueiro cadastrado. Login: ${createForm.email}`);
    setCreateForm(emptyCreateForm);
    load();
  }

  async function toggleDriverStatus(driver: DriverWithShop) {
    const nextActive = driver.active === false;
    const confirmed = window.confirm(nextActive
      ? `Reativar o cadastro de ${driver.name}?`
      : `Cancelar o cadastro de ${driver.name}? Ele sairá da fila e não receberá novas corridas.`);
    if (!confirmed) return;

    setUpdatingStatusId(driver.id);
    setMessage(null);
    setError(null);

    const { error: statusError } = await setMotorcyclistActiveByManager(driver.id, nextActive);
    setUpdatingStatusId(null);

    if (statusError) {
      setError(statusError.message);
      return;
    }

    setMessage(nextActive ? 'Cadastro do motoqueiro reativado.' : 'Cadastro do motoqueiro cancelado.');
    load();
  }

  async function saveDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDriver) return;

    if (!form.name.trim()) {
      setError('Informe o nome do motoqueiro.');
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    const { error: saveError } = await updateMotorcyclistByManager({
      motorcyclistId: editingDriver.id,
      name: form.name,
      phone: form.phone,
      pixKey: form.pixKey,
      pixKeyType: form.pixKeyType,
      payoutName: form.payoutName,
    });

    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setMessage('Dados do motoqueiro salvos.');
    setEditingDriver(null);
    setForm(emptyForm);
    load();
  }

  async function syncTelegram() {
    setSyncingTelegram(true);
    setMessage(null);
    setError(null);

    const result = await syncTelegramUpdates();
    setSyncingTelegram(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const linked = result.data.linked ?? 0;
    const received = result.data.received ?? 0;
    const failed = result.data.failed?.length ?? 0;

    if (linked > 0) {
      setMessage(`Telegram sincronizado. ${linked} motoqueiro(s) vinculado(s).`);
    } else if (failed > 0) {
      setError(`Telegram sincronizado, mas ${failed} conexao(oes) falharam. Confira permissao ou service role.`);
    } else if (received > 0) {
      setMessage('Telegram sincronizado, mas nenhuma nova conexao de motoqueiro foi encontrada.');
    } else {
      setMessage('Nenhuma mensagem nova do Telegram para sincronizar.');
    }

    load();
  }

  async function copyTelegramStartCommand(command: string) {
    await navigator.clipboard.writeText(command);
    setMessage('Comando do Telegram copiado. Envie essa mensagem na conversa do bot.');
  }

  async function copyTelegramLink(link: string) {
    await navigator.clipboard.writeText(link);
    setMessage('Link individual do Telegram copiado. Envie para o motoqueiro abrir no celular e tocar em Start.');
  }

  return (
    <ProtectedPage roles={['ADMIN_MASTER']}>
      <section className="section-header">
        <div>
          <p className="eyebrow">Gestao de equipe</p>
          <h2>Motoqueiros</h2>
          <p className="small-text">
            Confira telefone, Telegram, loja atual e dados de pagamento dos motoqueiros cadastrados.
          </p>
        </div>
        <div className="actions">
          <button className="button secondary" onClick={syncTelegram} disabled={syncingTelegram}>
            <Send size={16} />
            {syncingTelegram ? 'Sincronizando...' : 'Sincronizar Telegram'}
          </button>
          <button className="button secondary" onClick={load} disabled={loading}>
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <span>Total cadastrado</span>
          <strong>{totals.total}</strong>
        </div>
        <div className="stat-card">
          <span>Online</span>
          <strong>{totals.online}</strong>
        </div>
        <div className="stat-card">
          <span>Disponiveis</span>
          <strong>{totals.available}</strong>
        </div>
        <div className="stat-card">
          <span>Sem Telegram</span>
          <strong>{totals.withoutTelegram}</strong>
        </div>
        <div className="stat-card">
          <span>Cancelados</span>
          <strong>{totals.inactive}</strong>
        </div>
      </section>

      <form className="panel" onSubmit={createDriver}>
        <div className="section-header">
          <div>
            <p className="eyebrow">Novo cadastro</p>
            <h3>Cadastrar motoqueiro</h3>
            <p className="small-text">
              Nome e telefone bastam para ativar. E-mail, senha e Pix podem ser completados depois.
            </p>
          </div>
          <button className="button" disabled={creating}>
            <PlusCircle size={18} />
            {creating ? 'Cadastrando...' : 'Cadastrar motoqueiro'}
          </button>
        </div>

        <div className="content-grid three">
          <div className="form-grid">
            <label className="label" htmlFor="new-driver-name">Nome</label>
            <input
              id="new-driver-name"
              className="input"
              value={createForm.name}
              onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </div>

          <div className="form-grid">
            <label className="label" htmlFor="new-driver-phone">Telefone</label>
            <input
              id="new-driver-phone"
              className="input"
              placeholder="Ex.: 18996683576"
              value={createForm.phone}
              onChange={(event) => setCreateForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </div>

          <div className="form-grid">
            <label className="label" htmlFor="new-driver-email">E-mail de acesso opcional</label>
            <input
              id="new-driver-email"
              className="input"
              type="email"
              value={createForm.email}
              onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))}
            />
          </div>

          <div className="form-grid">
            <label className="label" htmlFor="new-driver-password">Senha inicial opcional</label>
            <input
              id="new-driver-password"
              className="input"
              type="text"
              minLength={6}
              value={createForm.password}
              onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
            />
          </div>

          <div className="form-grid">
            <label className="label" htmlFor="new-driver-pix-type">Tipo da chave Pix</label>
            <select
              id="new-driver-pix-type"
              className="select"
              value={createForm.pixKeyType}
              onChange={(event) => setCreateForm((current) => ({ ...current, pixKeyType: event.target.value }))}
            >
              <option value="cpf">CPF</option>
              <option value="cnpj">CNPJ</option>
              <option value="phone">Telefone</option>
              <option value="email">E-mail</option>
              <option value="random">Aleatoria</option>
            </select>
          </div>

          <div className="form-grid">
            <label className="label" htmlFor="new-driver-pix">Chave Pix</label>
            <input
              id="new-driver-pix"
              className="input"
              value={createForm.pixKey}
              onChange={(event) => setCreateForm((current) => ({ ...current, pixKey: event.target.value }))}
            />
          </div>

          <div className="form-grid">
            <label className="label" htmlFor="new-driver-payout-name">Nome do recebedor</label>
            <input
              id="new-driver-payout-name"
              className="input"
              value={createForm.payoutName}
              onChange={(event) => setCreateForm((current) => ({ ...current, payoutName: event.target.value }))}
            />
          </div>
        </div>
      </form>

      {editingDriver && (
        <form className="panel" onSubmit={saveDriver}>
          <div className="section-header">
            <div>
              <h3>Editando {editingDriver.name}</h3>
              <p className="small-text">
                Ajuste os dados do motoqueiro. Para receber chamadas, ele precisa conectar o Telegram pelo link individual.
              </p>
            </div>
            <button className="icon-button" type="button" onClick={cancelEditing} title="Cancelar edicao">
              <X size={16} />
              Cancelar
            </button>
          </div>

          <div className="content-grid two">
            <div className="form-grid">
              <label className="label" htmlFor="driver-name">Nome</label>
              <input
                id="driver-name"
                className="input"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </div>

            <div className="form-grid">
              <label className="label" htmlFor="driver-phone">Telefone</label>
              <input
                id="driver-phone"
                className="input"
                placeholder="Ex.: 14996683576"
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
              <p className="small-text">{phoneHint(form.phone)}</p>
            </div>

            <div className="form-grid">
              <label className="label" htmlFor="driver-pix-type">Tipo da chave Pix</label>
              <select
                id="driver-pix-type"
                className="select"
                value={form.pixKeyType}
                onChange={(event) => setForm((current) => ({ ...current, pixKeyType: event.target.value }))}
              >
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="phone">Telefone</option>
                <option value="email">E-mail</option>
                <option value="random">Aleatoria</option>
              </select>
            </div>

            <div className="form-grid">
              <label className="label" htmlFor="driver-pix">Chave Pix</label>
              <input
                id="driver-pix"
                className="input"
                value={form.pixKey}
                onChange={(event) => setForm((current) => ({ ...current, pixKey: event.target.value }))}
              />
            </div>

            <div className="form-grid">
              <label className="label" htmlFor="driver-payout-name">Nome do recebedor</label>
              <input
                id="driver-payout-name"
                className="input"
                value={form.payoutName}
                onChange={(event) => setForm((current) => ({ ...current, payoutName: event.target.value }))}
              />
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}
          {message && <p className="success-text">{message}</p>}

          <div className="actions" style={{ marginTop: 16 }}>
            <button className="button" disabled={saving}>
              <Save size={16} />
              {saving ? 'Salvando...' : 'Salvar motoqueiro'}
            </button>
          </div>
        </form>
      )}

      {telegramQr && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="QR Code do Telegram">
          <div className="modal-card qr-modal-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Conectar Telegram</p>
                <h3>{telegramQr.driverName}</h3>
                <p className="small-text">
                  Peça para o motoqueiro ler este QR Code no celular. Ele abre direto no aplicativo do Telegram.
                </p>
              </div>
              <button className="icon-button" type="button" onClick={() => setTelegramQr(null)} title="Fechar QR Code">
                <X size={16} />
                Fechar
              </button>
            </div>

            <div className="telegram-qr-box">
              <QRCode value={telegramQr.appLink} size={260} />
            </div>

            <div className="telegram-command-box">
              <p className="small-text">
                Se aparecer somente a mensagem /start, copie e envie este comando completo na conversa do bot:
              </p>
              <code className="code-line">{telegramQr.startCommand}</code>
              <button
                className="button secondary full"
                type="button"
                onClick={() => copyTelegramStartCommand(telegramQr.startCommand)}
              >
                <Copy size={16} />
                Copiar comando
              </button>
            </div>

            <a className="button full" href={telegramQr.appLink} target="_blank" rel="noreferrer">
              <ExternalLink size={18} />
              Abrir direto no app Telegram
            </a>
            <a className="button secondary full" href={telegramQr.webLink} target="_blank" rel="noreferrer">
              <ExternalLink size={18} />
              Abrir pelo navegador
            </a>
          </div>
        </div>
      )}

      <section className="panel">
        <div className="section-header">
          <div>
            <h3>Lista de motoqueiros</h3>
            <p className="small-text">
              Use a busca para encontrar por nome, telefone, Telegram, Pix ou loja.
            </p>
          </div>
          <label className="input compact" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Search size={16} />
            <input
              aria-label="Buscar motoqueiro"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar"
              style={{ border: 0, outline: 0, width: '100%', minWidth: 0 }}
            />
          </label>
        </div>

        {error && !editingDriver && <p className="error-text">{error}</p>}
        {message && !editingDriver && <p className="success-text">{message}</p>}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Motoqueiro</th>
                <th>Telefone</th>
                <th>Status</th>
                <th>Loja atual</th>
                <th>Ultimo GPS</th>
                <th>Ultima chamada</th>
                <th>Pix</th>
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((driver) => {
                const startPayload = `rider_${driver.id}`;
                const startCommand = `/start ${startPayload}`;
                const telegramLink = buildTelegramDeepLink(botUsername, startPayload);
                const telegramAppLink = buildTelegramAppLink(botUsername, startPayload);
                const telegramLabel = driver.telegram_username
                  ? `@${driver.telegram_username}`
                  : [driver.telegram_first_name, driver.telegram_last_name].filter(Boolean).join(' ') || 'Conectado';

                return (
                  <tr key={driver.id}>
                    <td>
                      <strong>{driver.name}</strong>
                      <p className="small-text">Criado em {formatDateTime(driver.created_at)}</p>
                    </td>
                    <td>
                      <strong>{driver.phone || '-'}</strong>
                      <p className="small-text">Contato</p>
                    </td>
                    <td>
                      <div className="actions">
                        {statusChip(driver.active === false ? 'Cadastro cancelado' : 'Cadastro ativo', driver.active !== false)}
                        {statusChip(driver.is_online ? 'Online' : 'Offline', driver.is_online)}
                        {statusChip(driver.available ? 'Disponivel' : 'Ocupado', driver.available)}
                        {statusChip(driver.telegram_chat_id ? 'Telegram conectado' : 'Sem Telegram', Boolean(driver.telegram_chat_id))}
                      </div>
                      {driver.telegram_chat_id ? (
                        <p className="success-text">
                          <Send size={14} /> {telegramLabel}
                        </p>
                      ) : telegramLink && telegramAppLink ? (
                        <div className="actions">
                          <button
                            className="button secondary"
                            type="button"
                            onClick={() => setTelegramQr({
                              driverName: driver.name,
                              appLink: telegramAppLink,
                              webLink: telegramLink,
                              startCommand,
                            })}
                          >
                            <QrCode size={16} />
                            QR Telegram
                          </button>
                          <button
                            className="button secondary"
                            type="button"
                            onClick={() => copyTelegramLink(telegramLink)}
                          >
                            <Copy size={16} />
                            Copiar link
                          </button>
                          <a className="small-text" href={telegramAppLink} target="_blank" rel="noreferrer">
                            <ExternalLink size={14} /> Link
                          </a>
                        </div>
                      ) : (
                        <p className="error-text">Configure NEXT_PUBLIC_TELEGRAM_BOT_USERNAME</p>
                      )}
                    </td>
                    <td>
                      <strong>{driver.shops?.name ?? '-'}</strong>
                      {driver.shops?.city && <p className="small-text">{driver.shops.city}</p>}
                    </td>
                    <td>
                      <strong>{formatDateTime(driver.last_seen)}</strong>
                      {driver.latitude && driver.longitude && (
                        <p className="small-text">
                          {driver.latitude.toFixed(5)}, {driver.longitude.toFixed(5)}
                        </p>
                      )}
                    </td>
                    <td>{formatDateTime(driver.last_assigned_at)}</td>
                    <td>
                      <strong>{driver.payout_name || '-'}</strong>
                      <p className="small-text">
                        {driver.pix_key ? `${driver.pix_key_type ?? 'pix'}: ${driver.pix_key}` : 'Sem Pix'}
                      </p>
                    </td>
                    <td>
                      <div className="actions">
                        <button className="button secondary" type="button" onClick={() => startEditing(driver)}>
                          {editingDriver?.id === driver.id ? <CheckCircle2 size={16} /> : <Pencil size={16} />}
                          Editar
                        </button>
                        <button
                          className={driver.active === false ? 'button' : 'button danger'}
                          type="button"
                          disabled={updatingStatusId === driver.id}
                          onClick={() => toggleDriverStatus(driver)}
                        >
                          {updatingStatusId === driver.id
                            ? 'Salvando...'
                            : driver.active === false ? 'Reativar' : 'Cancelar cadastro'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredDrivers.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <p className="small-text">Nenhum motoqueiro encontrado.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </ProtectedPage>
  );
}
