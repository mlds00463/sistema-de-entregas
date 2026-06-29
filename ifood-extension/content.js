(() => {
  const config = window.MADALENA_IFOOD_CONFIG;
  const extensionVersion = '0.2.5';
  const targetStorageKey = 'sistemasPiIfoodTargetUrlV2';
  let lastFoundCount = 0;

  function log(message) {
    const panel = ensurePanel();
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString('pt-BR')} - ${message}`;
    const logArea = panel.querySelector('[data-madalena-log]');
    logArea.appendChild(line);
    while (logArea.children.length > 10) logArea.firstChild.remove();
    logArea.scrollTop = logArea.scrollHeight;
    console.log(`[Sistemas Pi iFood] ${message}`);
  }

  function ensurePanel() {
    document.getElementById('madalena-ifood-panel')?.remove();

    let panel = document.getElementById('sistemas-pi-ifood-panel');
    if (panel && panel.dataset.version === extensionVersion) return panel;
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = 'sistemas-pi-ifood-panel';
    panel.dataset.version = extensionVersion;
    panel.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2147483647',
      'width:390px',
      'max-width:calc(100vw - 24px)',
      'max-height:330px',
      'overflow:hidden',
      'padding:10px',
      'background:#16202d',
      'color:#fff',
      'font:12px Arial,sans-serif',
      'border-radius:8px',
      'box-shadow:0 8px 24px rgba(0,0,0,.25)'
    ].join(';');

    const title = document.createElement('strong');
    title.textContent = 'Sistemas Pi iFood -> Motoqueiros';
    panel.appendChild(title);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;margin:8px 0;flex-wrap:wrap;background:#16202d;padding-bottom:6px';

    const importFirstButton = createButton('Abrir 1 pedido', '#22c55e', '#052e16', () => openFirstOrder());
    const importAllButton = createButton('Enviar lista', '#38bdf8', '#082f49', () => openAllOrders());
    const productionButton = createButton('', '#facc15', '#422006', () => toggleTargetUrl());
    productionButton.dataset.targetToggle = 'true';
    const diagnosticButton = createButton('Diagnóstico', '#c4b5fd', '#2e1065', () => showDiagnostic());

    actions.append(importFirstButton, importAllButton, productionButton, diagnosticButton);
    panel.appendChild(actions);

    const targetLine = document.createElement('div');
    targetLine.dataset.madalenaTarget = 'true';
    targetLine.style.cssText = 'margin-bottom:7px;color:#cbd5e1;word-break:break-all';
    panel.appendChild(targetLine);
    updateTargetLine();

    const logArea = document.createElement('div');
    logArea.dataset.madalenaLog = 'true';
    logArea.style.cssText = 'max-height:170px;overflow:auto;border-top:1px solid rgba(255,255,255,.16);padding-top:7px';
    panel.appendChild(logArea);

    document.documentElement.appendChild(panel);
    return panel;
  }

  function createButton(label, background, color, onClick) {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.cssText = `font:12px Arial;padding:5px 7px;border:0;border-radius:5px;background:${background};color:${color};cursor:pointer`;
    button.addEventListener('click', onClick);
    return button;
  }

  function updateTargetLine() {
    const target = document.querySelector('[data-madalena-target]');
    if (target) target.textContent = `Destino: ${currentTargetUrl()}`;

    const button = document.querySelector('[data-target-toggle]');
    if (button) button.textContent = currentTargetUrl().includes('localhost') ? 'Usar produção' : 'Usar local';
  }

  function currentTargetUrl() {
    return localStorage.getItem(targetStorageKey) || config.targetUrl;
  }

  function toggleTargetUrl() {
    const next = currentTargetUrl().includes('localhost') ? config.productionUrl : config.targetUrl;
    localStorage.setItem(targetStorageKey, next);
    updateTargetLine();
    log(`Destino alterado para ${next}`);
  }

  function onlyDigits(value = '') {
    return String(value).replace(/\D/g, '');
  }

  function moneyToNumber(value = '') {
    const match = String(value).match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/);
    if (!match) return 0;
    return Number(`${match[1].replace(/\./g, '')}.${match[2]}`);
  }

  function textOf(root, selector) {
    const element = root.querySelector(selector);
    return element?.innerText?.trim() || '';
  }

  function pickLine(lines, pattern) {
    return lines.find(line => pattern.test(line)) || '';
  }

  function sanitizeAddress(value = '') {
    return String(value)
      .replace(/\bLocalizador\b.*$/i, '')
      .replace(/\b(?:ID|Telefone|Entrega prevista)\s*:?.*$/i, '')
      .replace(/\bvia iFood\b.*$/i, '')
      .replace(/\biFood\s*#[A-Za-zÀ-ÿ0-9_-]+/gi, '')
      .replace(/\s*•\s*/g, ', ')
      .replace(/\s+-\s+/g, ', ')
      .replace(/,\s*,/g, ',')
      .replace(/\s+/g, ' ')
      .replace(/[,\s]+$/g, '')
      .trim();
  }

  function findAddress(lines) {
    const addressIndex = lines.findIndex(line => /\b(rua|avenida|av\.|r\.|praça|praca|travessa|alameda|rodovia)\b/i.test(line));
    if (addressIndex < 0) return '';

    const addressLines = [];
    for (const line of lines.slice(addressIndex, addressIndex + 5)) {
      if (/^(despachado|em preparo|pronto|pago|incentivos|problemas|fale com|inclui|localizador|telefone|entrega prevista)/i.test(line)) break;
      addressLines.push(line);
    }

    return sanitizeAddress(addressLines.join(', '));
  }

  function findZipcode(address = '') {
    const match = sanitizeAddress(address).match(/\b(?:CEP\s*)?(\d{5}-?\d{3})\b/i);
    return match?.[1] || '';
  }

  function parseOrderText(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const fullText = lines.join(' ');
    const numericLine = lines.find(line => /^[0-9]{3,6}$/.test(line) && !/^[0-9]{1,2}:[0-9]{2}$/.test(line)) || '';
    const numero =
      (fullText.match(/pedido\s*#?\s*([A-Z0-9-]{4,})/i) || [])[1] ||
      (fullText.match(/(?:codigo|código|cod\.?)\s*([A-Z0-9-]{4,})/i) || [])[1] ||
      numericLine ||
      (fullText.match(/#([0-9]{3,6})/) || [])[1] ||
      (lines.find(line => /^[A-Z0-9-]{4,}$/.test(line) && !/^[0-9]{1,2}:[0-9]{2}$/.test(line)) || '');

    const numeroIndex = lines.findIndex(line => line === numero || onlyDigits(line) === onlyDigits(numero));
    const labelLine = /^(pr[oó]pria|entrega|retirada|agendada|imediata|em preparo|preparo|[0-9]+\s*min)$/i;
    const customerAfterNumber = numeroIndex >= 0
      ? lines.slice(numeroIndex + 1).find(line => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{2,}$/.test(line) && !labelLine.test(line))
      : '';

    const cliente =
      pickLine(lines, /cliente|nome/i).replace(/cliente|nome|:/gi, '').trim() ||
      customerAfterNumber ||
      lines.find(line => /^[A-Za-zÀ-ÿ\s.'-]{5,}$/.test(line) && !labelLine.test(line)) ||
      'Cliente iFood';

    const endereco = findAddress(lines) || pickLine(lines, /rua|avenida|av\.|travessa|alameda|praça|praca|rodovia|endereço|endereco/i)
      .replace(/endereço|endereco|:/gi, '')
      .trim();
    const cleanAddress = sanitizeAddress(endereco);

    return {
      orderId: numero,
      customerName: cliente,
      customerPhone: onlyDigits(pickLine(lines, /telefone|celular|whats/i)),
      destinationAddress: cleanAddress.replace(/\bCEP\s*\d{5}-?\d{3}\b/gi, '').replace(/\b\d{5}-?\d{3}\b/g, '').trim(),
      destinationZipcode: findZipcode(cleanAddress),
      total: moneyToNumber(pickLine(lines, /total|valor|r\$/i)),
      rawText: text
    };
  }

  function parseCompactOrderList(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const orders = [];
    const statusLines = /^(em rota|em preparo|pronto|despachado|conclu[ií]do|cancelado|pr[oó]pria|retirada|entrega|\d+\s*min|\d+)$/i;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!/^[A-Z0-9-]{4,}$/i.test(line) || /^[0-9]{1,2}:[0-9]{2}$/.test(line)) continue;

      const prev = lines[index - 1] || '';
      const next = lines[index + 1] || '';
      const after = lines[index + 2] || '';
      const looksLikeOrder = /pr[oó]pria|retirada|entrega|em rota|em preparo|pronto|despachado|^\d+$/i.test(prev)
        && /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{2,}$/.test(next)
        && !statusLines.test(next);

      if (!looksLikeOrder) continue;

      orders.push({
        card: document.body,
        order: {
          orderId: line,
          customerName: next,
          customerPhone: '',
          destinationAddress: '',
          destinationZipcode: '',
          total: 0,
          rawText: [prev, line, next, after].filter(Boolean).join('\n')
        }
      });
    }

    return orders;
  }

  function looksLikePreparationCard(element) {
    if (!element || element.id === 'sistemas-pi-ifood-panel' || element.closest('#sistemas-pi-ifood-panel')) return false;
    const text = element.innerText?.trim() || '';
    if (!text || text.length > 1600) return false;
    if (!/(^|\n|\s)[A-Z0-9-]{4,}($|\n|\s)/i.test(text) && !/pedido|c[oó]digo|#\s*[A-Z0-9-]{4,}/i.test(text)) return false;
    return /[0-9]+\s*min|pr[oó]pria|retirada|entrega|cliente|endereco|endereço|em preparo|preparo|r\$/i.test(text);
  }

  function getCandidateCards() {
    const bySelector = [...document.querySelectorAll(config.selectors.orderCard)]
      .filter(card => card.innerText && /pedido|cliente|entrega|r\$|[0-9]+\s*min|pr[oó]pria/i.test(card.innerText));

    const byHeuristic = [...document.querySelectorAll('button, [role="button"], article, li, section, div, [data-testid], [class*="card"], [class*="Card"]')]
      .filter(looksLikePreparationCard);

    const unique = [];
    const seen = new Set();
    for (const card of [...bySelector, ...byHeuristic]) {
      if (seen.has(card)) continue;
      if (unique.some(parent => parent !== card && parent.contains(card) && (parent.innerText || '').length <= 1600)) continue;
      seen.add(card);
      unique.push(card);
    }

    return unique;
  }

  function readVisibleOrders() {
    const seen = new Set();
    const orders = [];
    const cards = getCandidateCards();

    for (const card of cards) {
      const parsed = parseOrderText(card.innerText);
      const numberText = textOf(card, config.selectors.orderNumber);
      if (numberText) parsed.orderId = onlyDigits(numberText) || numberText.trim();

      const customer = textOf(card, config.selectors.customerName);
      if (customer) parsed.customerName = customer;

      const address = textOf(card, config.selectors.address);
      if (address) parsed.destinationAddress = address;

      const total = textOf(card, config.selectors.total);
      if (total) parsed.total = moneyToNumber(total);

      if (parsed.orderId && !seen.has(parsed.orderId)) {
        seen.add(parsed.orderId);
        orders.push({ card, order: parsed });
      }
    }

    const bodyText = document.body?.innerText || '';
    const compactOrders = parseCompactOrderList(bodyText);
    for (const item of compactOrders) {
      if (item.order.orderId && !seen.has(item.order.orderId)) {
        seen.add(item.order.orderId);
        orders.push(item);
      }
    }

    if (!orders.length && /(pedido|em preparo|em rota|despachado)/i.test(bodyText) && /r\$|total|entrega|cliente|[0-9]+\s*min|pr[oó]pria|em rota/i.test(bodyText)) {
      const parsed = parseOrderText(bodyText);
      if (parsed.orderId) {
        seen.add(parsed.orderId);
        orders.push({ card: document.body, order: parsed });
      }
    }

    lastFoundCount = orders.length;
    return orders;
  }

  function buildImportUrl(order) {
    const url = new URL(currentTargetUrl());
    url.searchParams.set('ifood', '1');
    url.searchParams.set('orderId', order.orderId || '');
    url.searchParams.set('customerName', order.customerName || '');
    url.searchParams.set('customerPhone', order.customerPhone || '');
    url.searchParams.set('destinationZipcode', order.destinationZipcode || '');
    url.searchParams.set('destinationAddress', order.destinationAddress || '');
    url.searchParams.set('rawText', order.rawText || '');
    return url.toString();
  }

  function buildBatchImportUrl(orders) {
    const url = new URL(currentTargetUrl());
    const payload = orders.slice(0, 25).map(({ order }) => ({
      orderId: order.orderId || '',
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      destinationZipcode: order.destinationZipcode || '',
      destinationAddress: order.destinationAddress || '',
      rawText: order.rawText || ''
    }));
    const encodedPayload = btoa(unescape(encodeURIComponent(JSON.stringify({ orders: payload }))));
    url.searchParams.set('ifoodImport', encodedPayload);
    url.searchParams.set('ifoodOrders', JSON.stringify(payload));
    return url.toString();
  }

  function openFirstOrder() {
    const orders = readVisibleOrders();
    if (!orders.length) {
      log('Nenhum pedido visivel encontrado.');
      return;
    }

    const order = orders[0].order;
    window.open(buildImportUrl(order), '_blank');
    log(`Aberto pedido ${order.orderId || 'sem numero'} no sistema.`);
  }

  function openAllOrders() {
    const orders = readVisibleOrders();
    if (!orders.length) {
      log('Nenhum pedido visivel encontrado.');
      return;
    }

    window.open(buildBatchImportUrl(orders), '_blank');
    log(`Enviando ${Math.min(orders.length, 25)} pedido(s) para a lista do sistema.`);
  }

  function showDiagnostic() {
    const cards = getCandidateCards();
    const orders = readVisibleOrders();
    const sample = cards[0]?.innerText?.trim() || document.body?.innerText?.trim() || '';
    log(`Diagnostico: ${cards.length} cards, ${orders.length} pedido(s).`);
    log(`Amostra: ${sample.replace(/\s+/g, ' ').slice(0, 180) || 'sem texto visivel'}`);
    console.log('[Sistemas Pi iFood] Diagnostico completo', {
      url: location.href,
      orders: orders.map(item => item.order),
      cards: cards.map(card => card.innerText?.trim()).filter(Boolean).slice(0, 5),
      bodySample: document.body?.innerText?.trim().slice(0, 2000)
    });
  }

  ensurePanel();
  log('Extensao ativa. Abra a tela de pedidos do iFood.');
  window.setInterval(() => {
    const orders = readVisibleOrders();
    if (orders.length !== lastFoundCount) log(`Pedidos reconhecidos nesta tela: ${orders.length}`);
  }, config.pollIntervalMs || 8000);
})();
