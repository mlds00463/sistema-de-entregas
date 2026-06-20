function emv(id: string, value: string) {
  const length = value.length.toString().padStart(2, '0');
  return `${id}${length}${value}`;
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function sanitize(value: string, maxLength: number) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .slice(0, maxLength)
    .toUpperCase();
}

function crc16(payload: string) {
  let crc = 0xffff;

  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function normalizePixKeyType(pixKeyType?: string | null) {
  if (pixKeyType === 'telefone') return 'phone';
  if (pixKeyType === 'aleatoria') return 'random';
  return pixKeyType ?? '';
}

function looksLikePhone(digits: string) {
  return (digits.length === 12 && digits.startsWith('0'))
    || ((digits.length === 12 || digits.length === 13) && digits.startsWith('55'))
    || (digits.length === 10 || digits.length === 11);
}

export function resolvePixKeyType(pixKey: string, pixKeyType?: string | null) {
  const key = pixKey.trim();
  const type = normalizePixKeyType(pixKeyType);
  const digits = onlyDigits(key);

  if (type === 'phone' || type === 'email') return type;
  if (type === 'cpf' && digits.length === 11) return 'cpf';
  if (key.includes('@')) return 'email';
  if (looksLikePhone(digits)) return 'phone';
  if (type === 'cpf') return 'cpf';

  return type || 'cpf';
}

export function normalizePixKey(pixKey: string, pixKeyType?: string | null) {
  const key = pixKey.trim();
  const type = resolvePixKeyType(key, pixKeyType);

  if (['cpf', 'cnpj'].includes(type)) {
    return onlyDigits(key);
  }

  if (type === 'phone') {
    let digits = onlyDigits(key);
    if (!digits) return key;
    if (digits.length === 12 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.startsWith('55')) return `+${digits}`;
    if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
    return key.startsWith('+') ? `+${digits}` : digits;
  }

  if (type === 'email') {
    return key.toLowerCase();
  }

  return key;
}

export function getPixKeyWarning(pixKey: string, pixKeyType?: string | null) {
  const type = resolvePixKeyType(pixKey, pixKeyType);
  const normalized = normalizePixKey(pixKey, pixKeyType);
  const digits = onlyDigits(normalized);

  if (type === 'cpf' && digits.length !== 11) return 'CPF Pix precisa ter 11 números.';
  if (type === 'cnpj' && digits.length !== 14) return 'CNPJ Pix precisa ter 14 números.';
  if (type === 'phone' && !/^\+55\d{10,11}$/.test(normalized)) return 'Telefone Pix precisa estar cadastrado no banco, normalmente como +55DDDNUMERO.';
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return 'E-mail Pix parece incompleto.';

  return null;
}

export function createPixPayload(input: {
  pixKey: string;
  pixKeyType?: string | null;
  amount: number;
  recipientName: string;
  city?: string;
  txid: string;
  description?: string;
}) {
  const pixKey = normalizePixKey(input.pixKey, input.pixKeyType);
  const merchantAccount = [
    emv('00', 'BR.GOV.BCB.PIX'),
    emv('01', pixKey),
    input.description ? emv('02', sanitize(input.description, 72)) : '',
  ].join('');

  const txid = sanitize(input.txid.replace(/-/g, ''), 25) || 'PAGAMENTO';
  const payloadWithoutCrc = [
    emv('00', '01'),
    emv('26', merchantAccount),
    emv('52', '0000'),
    emv('53', '986'),
    emv('54', input.amount.toFixed(2)),
    emv('58', 'BR'),
    emv('59', sanitize(input.recipientName, 25) || 'MOTOQUEIRO'),
    emv('60', sanitize(input.city ?? 'BRASIL', 15) || 'BRASIL'),
    emv('62', emv('05', txid)),
  ].join('');

  const payloadForCrc = `${payloadWithoutCrc}6304`;
  return `${payloadForCrc}${crc16(payloadForCrc)}`;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}
