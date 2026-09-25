import { expect, test } from '@playwright/test';

/**
 * The P2P desk, against the real host.
 *
 * Needs what `console.spec.ts` needs, plus an account with `p2p-operator` and
 * two trades waiting on it — a sale in the queue, and a buy the customer let
 * expire. They are made outside this file because making them takes a
 * customer with a verified phone and money in the wallet, which is the app's
 * job and not the console's:
 *
 *     P2P_OPERATOR='{"email": "…", "password": "…"}' \
 *     P2P_SALE=KC5Y-MAW9 P2P_EXPIRED=PARC-VM9R npm run e2e -- p2p
 */
const operator = JSON.parse(process.env.P2P_OPERATOR ?? '{}') as { email?: string; password?: string };
const SALE = process.env.P2P_SALE ?? '';
const EXPIRED = process.env.P2P_EXPIRED ?? '';
const SHOTS = process.env.SHOTS ?? 'e2e/shots';

test.skip(!operator.email || !SALE || !EXPIRED, 'P2P_OPERATOR, P2P_SALE y P2P_EXPIRED no están');

test('la mesa P2P: pagar una venta, acreditar una compra vencida, poner un precio', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/');
  await page.getByLabel('Correo').fill(operator.email!);
  await page.getByLabel('Contraseña').fill(operator.password!);
  await page.getByRole('button', { name: /^entrar$/i }).click();

  // 1. The queue, with the sale in it: what to send and where.
  await page.getByRole('link', { name: 'Cola P2P' }).click();
  await expect(page.getByRole('heading', { name: 'Mesa P2P' })).toBeVisible();
  const sale = page.getByRole('row').filter({ hasText: SALE });
  await expect(sale).toBeVisible();
  await expect(sale).toContainText('CUP');
  await page.screenshot({ path: `${SHOTS}/p2p-1-cola.png`, fullPage: true });

  // 2. Paid, with the bank's reference. The row leaves the queue.
  await sale.getByRole('button', { name: 'Pagado' }).click();
  const paying = page.getByRole('dialog', { name: 'Marcar la venta como pagada' });
  await paying.getByLabel('Referencia del banco').fill(`TM-E2E-${Date.now()}`);
  await page.screenshot({ path: `${SHOTS}/p2p-2-pagar.png`, fullPage: true });
  await paying.getByRole('button', { name: 'Confirmar pago' }).click();
  await expect(paying).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: SALE })).toHaveCount(0);

  // 3. The expired buy the customer paid late: not in the queue, found by the
  // reference as a bank note prints it — no dash, lower case.
  await page.getByLabel('Referencia').fill(EXPIRED.replace('-', '').toLowerCase());
  await page.getByRole('button', { name: 'Buscar' }).click();
  const late = page.getByRole('row').filter({ hasText: EXPIRED });
  await expect(late).toContainText('Vencida');
  await page.screenshot({ path: `${SHOTS}/p2p-3-vencida.png`, fullPage: true });

  await late.getByRole('button', { name: 'Recibido' }).click();
  const receiving = page.getByRole('dialog', { name: 'Marcar la compra como recibida' });
  await expect(receiving).toContainText('venció');
  await receiving.getByLabel('Referencia del banco').fill(`TM-E2E-${Date.now()}`);
  await receiving.getByRole('button', { name: 'Acreditar al cliente' }).click();
  await expect(receiving).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: EXPIRED })).toContainText('Completada');
  await page.screenshot({ path: `${SHOTS}/p2p-4-acreditada.png`, fullPage: true });

  // 4. The rails: one CUP, priced per wallet currency. A USDT price is
  // published and survives the reload the server's answer triggers.
  await page.getByRole('link', { name: 'Métodos P2P' }).click();
  await expect(page.getByRole('heading', { name: 'CUP · CUP' })).toBeVisible();
  const usdt = page.getByLabel('USDT el cliente compra');
  const price = `13${Date.now() % 10}`;
  await usdt.fill(price);
  await page.getByRole('button', { name: /publicar 1 precio/i }).click();
  await expect(page.getByRole('button', { name: /publicar/i })).toBeDisabled();
  await expect(usdt).toHaveValue(price);
  await page.screenshot({ path: `${SHOTS}/p2p-5-metodos.png`, fullPage: true });

  // A 401 is the token's first expiry being refreshed, which is the design.
  expect(problems.filter((p) => !/401/.test(p))).toEqual([]);
});
