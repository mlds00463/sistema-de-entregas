'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

type RegisterResult = {
  shop?: {
    name?: string;
  };
  loginUrl?: string;
  riderRegistrationUrl?: string;
  trialEndDate?: string;
};

const initialForm = {
  ownerName: '',
  email: '',
  password: '',
  phone: '',
  shopName: '',
  address: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: 'Assis',
  state: 'SP',
  zipcode: '',
};

export default function LojistaRegisterPage() {
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);

  function updateField(field: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    setResult(null);

    const response = await fetch('/api/public/lojista-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const payload = await response.json().catch(() => null);
    setLoading(false);

    if (!response.ok) {
      setError(payload?.error ?? 'Não foi possível concluir o cadastro.');
      return;
    }

    setResult(payload);
    setMessage('Cadastro criado com sucesso. A loja já pode entrar no sistema.');
  }

  async function copyRiderLink() {
    if (!result?.riderRegistrationUrl) return;
    await navigator.clipboard.writeText(result.riderRegistrationUrl);
    setMessage('Link dos motoqueiros copiado.');
  }

  return (
    <main className="public-page">
      <section className="auth-card panel">
        <p className="eyebrow">MR Entregas</p>
        <h1>Cadastro de novo cliente</h1>
        <p className="small-text">
          Crie sua loja para começar o teste do sistema. Depois você poderá cadastrar motoqueiros pelo link da loja.
        </p>

        {error && <p className="error-text">{error}</p>}
        {message && <p className="success-text">{message}</p>}

        {!result ? (
          <form className="form-grid signup-form" onSubmit={submit}>
            <div className="form-section-title">Responsável</div>
            <label className="label">
              Nome
              <input className="input" value={form.ownerName} onChange={(event) => updateField('ownerName', event.target.value)} required />
            </label>
            <label className="label">
              E-mail
              <input className="input" type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} required />
            </label>
            <label className="label">
              Senha
              <input className="input" type="password" minLength={6} value={form.password} onChange={(event) => updateField('password', event.target.value)} required />
            </label>
            <label className="label">
              Telefone
              <input className="input" value={form.phone} onChange={(event) => updateField('phone', event.target.value)} required />
            </label>

            <div className="form-section-title">Loja</div>
            <label className="label columns-span">
              Nome da loja
              <input className="input" value={form.shopName} onChange={(event) => updateField('shopName', event.target.value)} required />
            </label>
            <label className="label columns-span">
              Endereço
              <input className="input" value={form.address} onChange={(event) => updateField('address', event.target.value)} required />
            </label>
            <label className="label">
              Número
              <input className="input" value={form.number} onChange={(event) => updateField('number', event.target.value)} />
            </label>
            <label className="label">
              Complemento
              <input className="input" value={form.complement} onChange={(event) => updateField('complement', event.target.value)} />
            </label>
            <label className="label">
              Bairro
              <input className="input" value={form.neighborhood} onChange={(event) => updateField('neighborhood', event.target.value)} />
            </label>
            <label className="label">
              CEP
              <input className="input" value={form.zipcode} onChange={(event) => updateField('zipcode', event.target.value)} />
            </label>
            <label className="label">
              Cidade
              <input className="input" value={form.city} onChange={(event) => updateField('city', event.target.value)} required />
            </label>
            <label className="label">
              UF
              <input className="input" maxLength={2} value={form.state} onChange={(event) => updateField('state', event.target.value.toUpperCase())} required />
            </label>

            <button className="button full" disabled={loading}>
              {loading ? 'Criando cadastro...' : 'Criar loja'}
            </button>
          </form>
        ) : (
          <div className="stack signup-result">
            <div className="success-box">
              <div>
                <strong>{result.shop?.name ?? 'Loja cadastrada'}</strong>
                <p className="small-text">
                  Teste grátis até {result.trialEndDate ?? 'a data configurada pelo administrador'}.
                </p>
              </div>
              <Link className="button" href="/auth">Entrar no sistema</Link>
            </div>

            {result.riderRegistrationUrl && (
              <div className="share-link-card">
                <h3>Link para motoqueiros desta loja</h3>
                <p className="small-text">Envie este link para o motoqueiro fazer o cadastro rápido e conectar o Telegram.</p>
                <div className="copy-row">
                  <input className="input" readOnly value={result.riderRegistrationUrl} />
                  <button className="button secondary" type="button" onClick={copyRiderLink}>Copiar</button>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="small-text auth-footer-link">
          Já tem conta? <Link href="/auth">Entrar no sistema</Link>
        </p>
      </section>
    </main>
  );
}
