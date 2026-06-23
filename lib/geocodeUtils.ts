export function compactAddressParts(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ');
}

export function normalizeAddressText(address: string) {
  return address
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,\s*,+/g, ', ')
    .replace(/(^,\s*|\s*,\s*$)/g, '')
    .trim();
}

export function simplifyBrazilianAddress(address: string) {
  return normalizeAddressText(address)
    .replace(/,\s*de\s+\d+\s*\/\s*\d+\s+ao\s+fim\b/gi, '')
    .replace(/\bde\s+\d+\s*\/\s*\d+\s+ao\s+fim\b/gi, '')
    .replace(/,\s*Brasil\s*,\s*Brasil$/i, ', Brasil')
    .replace(/,\s*Brasil$/i, ', Brasil')
    .trim();
}

export function buildGeocodeQueries(address: string) {
  const clean = simplifyBrazilianAddress(address);
  const withoutZipcode = normalizeAddressText(clean.replace(/,?\s*CEP\s*\d{5}-?\d{3}\b/gi, ''));
  const withoutCountry = normalizeAddressText(withoutZipcode.replace(/,?\s*Brasil$/i, ''));

  return Array.from(new Set([
    clean,
    withoutZipcode,
    withoutCountry,
  ].filter(Boolean)));
}

export function isCompleteAddress(address: string, city?: string | null, zipcode?: string | null) {
  const normalizedAddress = address.toLowerCase();
  const normalizedZipcode = zipcode?.replace(/\D/g, '') ?? '';

  return (
    address.split(',').length >= 4
    || Boolean(city && normalizedAddress.includes(city.toLowerCase()))
    || Boolean(normalizedZipcode && normalizedAddress.replace(/\D/g, '').includes(normalizedZipcode))
  );
}
