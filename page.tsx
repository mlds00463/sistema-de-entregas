import Link from 'next/link';
import { Bike, LayoutDashboard, QrCode, Store } from 'lucide-react';

export default function Home() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Sistema real de entregas</p>
        <h1>Despacho, fila de motoqueiros, GPS e relatórios com Supabase.</h1>
        <div className="actions">
          <Link href="/auth" className="button">Entrar / Criar conta</Link>
          <Link href="/gestor/dashboard" className="button secondary">Abrir dashboard</Link>
        </div>
      </section>

      <section className="feature-grid">
        <Link href="/gestor/lojas" className="feature-tile">
          <Store size={24} />
          <strong>Cadastro de lojas</strong>
          <span>Crie lojas e gere QR Codes reais.</span>
        </Link>
        <Link href="/motoqueiro/qrcode" className="feature-tile">
          <QrCode size={24} />
          <strong>Check-in por QR</strong>
          <span>Motoqueiro lê pelo celular e entra na fila.</span>
        </Link>
        <Link href="/loja/dashboard" className="feature-tile">
          <Bike size={24} />
          <strong>Chamada automática</strong>
          <span>A loja cria a entrega e o sistema atribui um disponível.</span>
        </Link>
        <Link href="/gestor/dashboard" className="feature-tile">
          <LayoutDashboard size={24} />
          <strong>Relatórios reais</strong>
          <span>Veja tempo total por dia, loja e motoqueiro.</span>
        </Link>
      </section>
    </main>
  );
}
