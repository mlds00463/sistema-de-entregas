'use client';

import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'react-qr-code';
import type { Shop } from '@/lib/types';
import { makeShopQrPayload, makeShopRegistrationUrl } from '@/services/shopService';

export default function ShopQrCode({ children, shop }: { children?: ReactNode; shop: Shop }) {
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const payload = origin ? makeShopRegistrationUrl(shop, origin) : makeShopQrPayload(shop);

  return (
    <div className="qr-box">
      <QRCode value={payload} size={180} />
      <div>
        <h3>Cadastro rápido do motoqueiro</h3>
        <p className="small-text"><strong>{shop.name}</strong></p>
        <p className="small-text">{shop.address}{shop.number ? `, ${shop.number}` : ''}, {shop.city}</p>
        {shop.cnpj && <p className="small-text">CNPJ: {shop.cnpj}</p>}
        <p className="small-text">
          Corrida: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(shop.payout_amount_per_delivery ?? 0)}
          {' '}· mínimo {shop.minimum_guaranteed_deliveries ?? 10}
        </p>
        <code className="code-line">{payload}</code>
        {children}
      </div>
    </div>
  );
}
