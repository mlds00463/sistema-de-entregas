'use client';

import { Bike, LogIn, Store, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { normalizeRole } from '@/lib/access';
import { ensureProfile, signIn, signUp } from '@/services/authService';
import type { UserRole } from '@/lib/types';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }
  return 'Não foi possível autenticar.';
}

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('lojista');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();

      if (mode === 'login') {
        const { error: signInError } = await signIn(normalizedEmail, password);
        if (signInError) throw signInError;
        const { data: profile, error: profileError } = await ensureProfile();
        if (profileError) throw profileError;
        const normalizedRole = normalizeRole(profile?.role);
        if (normalizedRole === 'MOTOQUEIRO') router.push('/motoqueiro/dashboard');
        else if (normalizedRole === 'LOJISTA' || normalizedRole === 'COLABORADOR_LOJISTA') router.push('/loja/dashboard');
        else router.push('/gestor/dashboard');
        return;
      }

      const { error: signUpError } = await signUp(normalizedEmail, password, name, role, phone);
      if (signUpError) throw signUpError;
      router.push(role === 'motoqueiro' ? '/motoqueiro/qrcode' : '/loja/dashboard');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <p className="eyebrow">MVP real com Supabase</p>
        <h1>{mode === 'login' ? 'Entrar no sistema' : 'Criar conta operacional'}</h1>
        <p className="small-text">
          Use uma conta real do Supabase Auth. Motoqueiros entram, leem o QR da loja e ficam disponíveis com GPS.
        </p>

        <form onSubmit={handleSubmit} className="form-grid">
          {mode === 'register' && (
            <>
              <label className="label" htmlFor="name">Nome completo</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />

              <label className="label" htmlFor="phone">Telefone</label>
              <input id="phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} required />

              <label className="label" htmlFor="role">Tipo de conta</label>
              <select id="role" className="select" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                <option value="lojista">Lojista</option>
                <option value="motoqueiro">Motoqueiro</option>
              </select>
            </>
          )}

          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

          <label className="label" htmlFor="password">Senha</label>
          <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />

          {error && <p className="error-text">{error}</p>}

          <button className="button" disabled={loading}>
            {mode === 'login' ? <LogIn size={18} /> : <UserPlus size={18} />}
            {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Cadastrar'}
          </button>
        </form>

        <button className="button secondary full" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Criar uma conta' : 'Já tenho conta'}
        </button>
      </section>

      <aside className="auth-side">
        <div className="metric-card">
          <Store size={24} />
          <strong>Lojas</strong>
          <span>QR Code único e entregas reais</span>
        </div>
        <div className="metric-card">
          <Bike size={24} />
          <strong>Motoqueiros</strong>
          <span>Fila disponível, aceite e GPS ao vivo</span>
        </div>
      </aside>
    </main>
  );
}
