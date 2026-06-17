'use client';

import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useProfile } from '@/hooks/useProfile';
import { useEmergencyCode } from '@/services/accessService';

export default function EmergencyReleasePage() {
  const { profile, loading } = useProfile();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);

    const { error: requestError } = await useEmergencyCode(code);
    setSaving(false);

    if (requestError) {
      setError(requestError.message);
      return;
    }

    setMessage('Acesso liberado por 24 horas. Recarregando o sistema...');
    window.setTimeout(() => router.push('/'), 900);
  }

  if (loading) {
    return <main className="container"><div className="panel">Carregando...</div></main>;
  }

  return (
    <main className="container narrow-page">
      <section className="panel">
        <p className="eyebrow">Liberação emergencial</p>
        <h1>Digite a senha temporária</h1>
        <p className="small-text">
          Essa senha é individual, só pode ser usada uma vez e libera o acesso por 24 horas.
        </p>

        {!profile && (
          <p className="error-text">Entre no sistema antes de usar uma senha emergencial.</p>
        )}

        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="label" htmlFor="emergency-code">Código</label>
          <input
            id="emergency-code"
            className="input"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Ex.: A1B2C3D4"
            required
          />
          {error && <p className="error-text">{error}</p>}
          {message && <p className="success-text">{message}</p>}
          <button className="button" disabled={saving || !profile}>
            <KeyRound size={18} />
            {saving ? 'Validando...' : 'Liberar por 24 horas'}
          </button>
        </form>
      </section>
    </main>
  );
}
