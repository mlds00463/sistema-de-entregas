'use client';

import { CheckCircle2, MapPin, Send } from 'lucide-react';
import { useState } from 'react';
import ProtectedPage from '@/components/ProtectedPage';
import QRScanner from '@/components/QRScanner';
import { useGeolocation } from '@/hooks/useGeolocation';
import { buildTelegramDeepLink } from '@/lib/telegram';
import type { Motorcyclist } from '@/lib/types';
import { driverCheckIn, updateDriverLocation } from '@/services/driverService';
import { parseShopQrPayload } from '@/services/shopService';

export default function DriverQrPage() {
  const { requestOnce, startWatching, watching } = useGeolocation();
  const [driver, setDriver] = useState<Motorcyclist | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState('');
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

  async function activateFromQr(value: string) {
    setMessage(null);
    setTelegramLink(null);

    try {
      const payload = parseShopQrPayload(value);
      const coords = await requestOnce();
      const { data, error } = await driverCheckIn(payload.shopId, payload.token, coords.latitude, coords.longitude);
      if (error) throw error;
      setDriver(data);
      startWatching((nextCoords) => {
        updateDriverLocation(nextCoords.latitude, nextCoords.longitude);
      });
      const nextTelegramLink = buildTelegramDeepLink(botUsername, data?.id ? `rider_${data.id}` : null);

      if (nextTelegramLink && !data?.telegram_chat_id) {
        setTelegramLink(nextTelegramLink);
        setMessage('Check-in confirmado. Você está online. Conecte o Telegram uma vez para receber chamadas pelo bot.');
      } else {
        setMessage('Check-in confirmado. Você está online e pronto para receber chamadas.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível ativar o motoqueiro.');
    }
  }

  async function handleManualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await activateFromQr(rawCode);
  }

  return (
    <ProtectedPage roles={['MOTOQUEIRO']}>
      <section className="content-grid two">
        <div className="panel">
          <h2>Ler QR Code da loja</h2>
          <p className="small-text">Autorize a câmera e o GPS no celular. O check-in usa o QR real gerado no cadastro da loja.</p>
          <QRScanner onResult={activateFromQr} />
          {message && <p className={driver ? 'success-text' : 'error-text'}>{message}</p>}
          {telegramLink && (
            <a className="button" href={telegramLink} target="_blank" rel="noreferrer">
              <Send size={18} /> Conectar Telegram
            </a>
          )}
        </div>

        <div className="panel">
          <h2>Entrada manual</h2>
          <p className="small-text">Use apenas para teste quando a câmera do navegador estiver bloqueada.</p>
          <form onSubmit={handleManualSubmit} className="form-grid">
            <label className="label" htmlFor="qr-payload">Conteúdo do QR</label>
            <textarea id="qr-payload" className="textarea" value={rawCode} onChange={(e) => setRawCode(e.target.value)} required />
            <button className="button"><MapPin size={18} /> Ativar com GPS</button>
          </form>
          {driver && (
            <div className="success-box">
              <CheckCircle2 size={22} />
              <div>
                <strong>{driver.name}</strong>
                <p className="small-text">Online: {driver.is_online ? 'sim' : 'não'} · Disponível: {driver.available ? 'sim' : 'não'} · GPS: {watching ? 'ao vivo' : 'capturado'}</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </ProtectedPage>
  );
}
