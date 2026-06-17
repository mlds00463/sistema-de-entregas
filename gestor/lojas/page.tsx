'use client';

import { Pencil, Plus, Save, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import ProtectedPage from '@/components/ProtectedPage';
import ShopQrCode from '@/components/ShopQrCode';
import { useProfile } from '@/hooks/useProfile';
import type { Shop } from '@/lib/types';
import { lookupCep } from '@/services/cepService';
import { geocodeAddress } from '@/services/geocodeService';
import { createShop, getShops, updateShop } from '@/services/shopService';

export default function ShopsPage() {
  const { profile } = useProfile();
  const [shops, setShops] = useState<Shop[]>([]);
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [zipcode, setZipcode] = useState('');
  const [address, setAddress] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [payoutAmount, setPayoutAmount] = useState('0');
  const [minimumDeliveries, setMinimumDeliveries] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingShopId, setEditingShopId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await getShops();
    if (loadError) setError(loadError.message);
    setShops(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setName('');
    setLegalName('');
    setCnpj('');
    setZipcode('');
    setAddress('');
    setNumber('');
    setComplement('');
    setNeighborhood('');
    setCity('');
    setState('');
    setContactName('');
    setContactPhone('');
    setContactEmail('');
    setPayoutAmount('0');
    setMinimumDeliveries('10');
    setEditingShopId(null);
  }

  function fillForm(shop: Shop) {
    setName(shop.name);
    setLegalName(shop.legal_name ?? '');
    setCnpj(shop.cnpj ?? '');
    setZipcode(shop.zipcode ?? '');
    setAddress(shop.address);
    setNumber(shop.number ?? '');
    setComplement(shop.complement ?? '');
    setNeighborhood(shop.neighborhood ?? '');
    setCity(shop.city);
    setState(shop.state ?? '');
    setContactName(shop.contact_name ?? '');
    setContactPhone(shop.contact_phone ?? '');
    setContactEmail(shop.contact_email ?? '');
    setPayoutAmount(String(shop.payout_amount_per_delivery ?? 0));
    setMinimumDeliveries(String(shop.minimum_guaranteed_deliveries ?? 10));
    setEditingShopId(shop.id);
    setError(null);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getShopInput() {
    return {
      name,
      legalName,
      cnpj,
      zipcode,
      address,
      number,
      complement,
      neighborhood,
      city,
      state,
      contactName,
      contactPhone,
      contactEmail,
      payoutAmountPerDelivery: Number(payoutAmount || 0),
      minimumGuaranteedDeliveries: Number(minimumDeliveries || 10),
    };
  }

  function getFullAddressForMap() {
    return [
      address,
      number,
      complement,
      neighborhood,
      city,
      state,
      zipcode ? `CEP ${zipcode}` : '',
      'Brasil',
    ].filter(Boolean).join(', ');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile && !editingShopId) return;
    setError(null);
    setMessage(null);
    setSaving(true);

    let coordinates: { latitude: number; longitude: number } | null = null;
    try {
      coordinates = await geocodeAddress(getFullAddressForMap());
    } catch {
      coordinates = null;
    }
    const input = {
      ...getShopInput(),
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
    };
    const { error: saveError } = editingShopId
      ? await updateShop(editingShopId, input)
      : await createShop(profile!, input);

    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }

    const baseMessage = editingShopId ? 'Loja atualizada com sucesso.' : 'Loja criada com sucesso.';
    setMessage(coordinates ? baseMessage : `${baseMessage} Não consegui localizar coordenadas para o mapa.`);
    resetForm();
    await load();
    setSaving(false);
  }

  async function handleCepBlur() {
    if (zipcode.replace(/\D/g, '').length !== 8) return;
    setCepLoading(true);
    setError(null);

    try {
      const cep = await lookupCep(zipcode);
      setAddress(cep.logradouro);
      setNeighborhood(cep.bairro);
      setCity(cep.localidade);
      setState(cep.uf);
      if (!complement) setComplement(cep.complemento);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível consultar o CEP.');
    } finally {
      setCepLoading(false);
    }
  }

  return (
    <ProtectedPage roles={['ADMIN_MASTER']}>
      <section className="content-grid two">
        <div className="panel">
          <h2>{editingShopId ? 'Editar loja' : 'Cadastrar loja'}</h2>
          <form onSubmit={handleSubmit} className="form-grid">
            <label className="label" htmlFor="shop-name">Nome fantasia</label>
            <input id="shop-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />

            <label className="label" htmlFor="shop-legal-name">Razão social</label>
            <input id="shop-legal-name" className="input" value={legalName} onChange={(e) => setLegalName(e.target.value)} />

            <label className="label" htmlFor="shop-cnpj">CNPJ</label>
            <input id="shop-cnpj" className="input" value={cnpj} onChange={(e) => setCnpj(e.target.value)} required />

            <label className="label" htmlFor="shop-zipcode">CEP</label>
            <input id="shop-zipcode" className="input" value={zipcode} onBlur={handleCepBlur} onChange={(e) => setZipcode(e.target.value)} required />
            {cepLoading && <p className="small-text">Consultando CEP...</p>}

            <label className="label" htmlFor="shop-address">Endereço</label>
            <input id="shop-address" className="input" value={address} onChange={(e) => setAddress(e.target.value)} required />

            <label className="label" htmlFor="shop-number">Número</label>
            <input id="shop-number" className="input" value={number} onChange={(e) => setNumber(e.target.value)} required />

            <label className="label" htmlFor="shop-complement">Complemento</label>
            <input id="shop-complement" className="input" value={complement} onChange={(e) => setComplement(e.target.value)} />

            <label className="label" htmlFor="shop-neighborhood">Bairro</label>
            <input id="shop-neighborhood" className="input" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />

            <label className="label" htmlFor="shop-city">Cidade</label>
            <input id="shop-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} required />

            <label className="label" htmlFor="shop-state">UF</label>
            <input id="shop-state" className="input" value={state} onChange={(e) => setState(e.target.value.toUpperCase())} maxLength={2} />

            <label className="label" htmlFor="shop-contact-name">Responsável</label>
            <input id="shop-contact-name" className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} />

            <label className="label" htmlFor="shop-contact-phone">Telefone comercial</label>
            <input id="shop-contact-phone" className="input" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />

            <label className="label" htmlFor="shop-contact-email">Email comercial</label>
            <input id="shop-contact-email" className="input" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />

            <label className="label" htmlFor="shop-payout-amount">Valor por corrida</label>
            <input id="shop-payout-amount" className="input" type="number" min="0" step="0.01" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} />

            <label className="label" htmlFor="shop-minimum-deliveries">Mínimo garantido por motoqueiro</label>
            <input id="shop-minimum-deliveries" className="input" type="number" min="0" step="1" value={minimumDeliveries} onChange={(e) => setMinimumDeliveries(e.target.value)} />

            {error && <p className="error-text">{error}</p>}
            {message && <p className="success-text">{message}</p>}
            <button className="button" disabled={saving}>
              {editingShopId ? <Save size={18} /> : <Plus size={18} />}
              {saving ? 'Salvando...' : editingShopId ? 'Salvar alterações' : 'Criar loja'}
            </button>
            {editingShopId && (
              <button className="button secondary" type="button" onClick={resetForm} disabled={saving}>
                <X size={18} /> Cancelar edição
              </button>
            )}
          </form>
        </div>

        <div className="panel">
          <h2>QR Codes das lojas</h2>
          <div className="stack">
            {shops.map((shop) => (
              <ShopQrCode key={shop.id} shop={shop}>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="button secondary" type="button" onClick={() => fillForm(shop)}>
                    <Pencil size={18} /> Editar loja
                  </button>
                </div>
              </ShopQrCode>
            ))}
            {shops.length === 0 && <p className="small-text">Nenhuma loja cadastrada ainda.</p>}
          </div>
        </div>
      </section>
    </ProtectedPage>
  );
}
