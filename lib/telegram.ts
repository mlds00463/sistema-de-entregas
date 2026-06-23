export function telegramText(value: string, maxLength = 3900) {
  const normalized = value
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export function normalizeTelegramBotUsername(value?: string | null) {
  const username = (value ?? '').trim().replace(/^@/, '');
  return username || null;
}

export function buildTelegramDeepLink(botUsername?: string | null, startPayload?: string | null) {
  const username = normalizeTelegramBotUsername(botUsername);
  if (!username) return null;

  const url = new URL(`https://t.me/${username}`);
  if (startPayload) url.searchParams.set('start', startPayload);
  return url.toString();
}

export function buildTelegramAppLink(botUsername?: string | null, startPayload?: string | null) {
  const username = normalizeTelegramBotUsername(botUsername);
  if (!username) return null;

  const params = new URLSearchParams({ domain: username });
  if (startPayload) params.set('start', startPayload);
  return `tg://resolve?${params.toString()}`;
}
