'use client';

import { FormEvent, Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Bike, CheckCircle2, Send } from 'lucide-react';
import { buildTelegramAppLink, buildTelegramDeepLink } from '@/lib/telegram';

type QuickRegisterResult = {
  motorcyclist?: { id: string; name: string };
  shop?: { id: string; name: string };
  generatedCredentials?: { email: string; password: string } | null;
  telegramStartPayload?: string;
  error?: string;
};

function MotorcyclistQuickRegisterContent() {
  const searchParams = useSearchParams();
  const shopId = searchParams.get('shopId') ?? '';
  const token = searchParams.get('token') ?? '';
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<QuickRegisterResult | null>(null);

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const telegramLinks = useMemo(() => {
    if (!result?.telegramStartPayload) return { app: null, web: null };
    return {
      app: buildTelegramAppLink(botUsername, result.telegramStartPayload),
      web: buildTelegramDeepLink(botUsername, result.telegramStartPayload),
    };
  }, [botUsername, result?.telegramStartPayload]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setResult(null);

    const response = await fetch('/api/motoqueiro/quick-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, token, name, phone }),
    });

    const payload = await response.json().catch(() => null) as QuickRegisterResult | null;
    setLoading(false);

    if (!response.ok) {
      setMessage(payload?.error ?? 'Não foi possível cadastrar agora.');
      return;
    }

    setResult(payload);
    setMessage('Cadastro pronto. Agora conecte seu Telegram para receber corridas.');
  }

  if (!shopId || !token) {
    return (
      <main className="public-page">
        <section className="auth-card">
          <h1>QR Code inválido</h1>
          <p>Peça para a loja gerar novamente o QR Code de cadastro.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="public-page">
      <section className="auth-card">
        <p className="eyebrow">Cadastro rápido</p>
        <h1>Entrar na fila de entregas</h1>
        <p className="muted">Informe nome e telefone. O restante do cadastro pode ser completado depois.</p>

        <form className="form-grid single-column" onSubmit={handleSubmit}>
          <label>
            Nome
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" required />
          </label>
          <label>
            Telefone
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="DDD + número" required />
          </label>
          <button className="button primary" disabled={loading} type="submit">
            <Bike size={18} />
            {loading ? 'Cadastrando...' : 'Cadastrar motoqueiro'}
          </button>
        </form>

        {message && <p className={result ? 'success-text' : 'error-text'}>{message}</p>}

        {result?.motorcyclist && (
          <div className="panel soft-panel">
            <h2><CheckCircle2 size={20} /> {result.motorcyclist.name}</h2>
            <p className="small-text">Loja: {result.shop?.name ?? 'loja vinculada'}</p>
            {result.generatedCredentials && (
              <p className="small-text">
                Acesso gerado: {result.generatedCredentials.email} · senha {result.generatedCredentials.password}
              </p>
            )}
            {telegramLinks.web ? (
              <a className="button primary" href={telegramLinks.app ?? telegramLinks.web}>
                <Send size={18} />
                Conectar Telegram
              </a>
            ) : (
              <p className="error-text">Configure o usuário público do bot Telegram para gerar o link.</p>
            )}
            <Link className="button secondary" href="/motoqueiro/dashboard">Abrir painel do motoqueiro</Link>
          </div>
        )}
      </section>
    </main>
  );
}

export default function MotorcyclistQuickRegisterPage() {
  return (
    <Suspense fallback={(
      <main className="public-page">
        <section className="auth-card">
          <h1>Carregando cadastro</h1>
          <p>Preparando o QR Code da loja...</p>
        </section>
      </main>
    )}>
      <MotorcyclistQuickRegisterContent />
    </Suspense>
  );
}
