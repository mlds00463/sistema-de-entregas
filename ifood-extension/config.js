window.MADALENA_IFOOD_CONFIG = {
  targetUrl: 'http://localhost:3001/loja/dashboard',
  productionUrl: 'https://sistemas-pi.vercel.app/loja/dashboard',
  pollIntervalMs: 8000,
  selectors: {
    orderCard: "[data-testid*='order'], article, .order-card, [class*='order']",
    orderNumber: "[data-testid*='order-number'], [class*='order-number'], [class*='code']",
    customerName: "[data-testid*='customer'], [class*='customer'], [class*='client']",
    address: "[data-testid*='address'], [class*='address'], [class*='delivery-address']",
    total: "[data-testid*='total'], [class*='total'], [class*='price']"
  }
};
