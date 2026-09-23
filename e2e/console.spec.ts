import { expect, test } from '@playwright/test';

const EMAIL = 'tesorera@islapay.cu';
const PASSWORD = 'Correct-Horse-9';
const SHOTS = process.env.SHOTS ?? 'e2e/shots';

test('la consola, contra el host de verdad', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // The URL as well as the status, because "404" on its own sends somebody
  // hunting through a network tab that no longer exists.
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/');

  // 1. Sign in, which happens at Keycloak and not here.
  await expect(page.getByRole('button', { name: /entrar con keycloak/i })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1-entrar.png`, fullPage: true });

  await page.getByRole('button', { name: /entrar con keycloak/i }).click();
  await page.waitForURL(/8080\/realms\/islapay/);
  await page.fill('#username', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('#kc-login');

  // 2. Funds.
  await page.waitForURL(/\/fondos$/);
  await expect(page.getByRole('heading', { name: 'Fondos' })).toBeVisible();
  await expect(page.getByText('tesorera@islapay.cu')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/2-fondos-vacio.png`, fullPage: true });

  // 3. Put money in.
  //
  // A mirror nobody has used before, because this runs against a database that
  // keeps what earlier runs did. Asserting a total would be asserting about
  // whatever ran this morning; asserting about a fresh mirror is asserting
  // about this posting.
  const mirror = `bank:e2e${Date.now()}`;
  const reason = `Capital de prueba ${Date.now()}`;

  await page.getByRole('button', { name: /ingresar dinero/i }).click();
  await page.getByLabel('Importe').fill('2500.00');
  await page.getByLabel('Origen').fill(mirror);
  await page.getByLabel('Motivo').fill(reason);
  await page.screenshot({ path: `${SHOTS}/3-ingreso.png`, fullPage: true });

  await page.getByRole('button', { name: /registrar ingreso/i }).click();
  await expect(page.getByText(/el asiento se escribió/i)).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/4-recibo.png`, fullPage: true });
  await page.getByRole('button', { name: /^cerrar$/i }).click();

  // 4. Both halves of one posting, on the same screen. The mirror fell by
  // exactly what the float rose by, which is what makes this an accounting
  // fact rather than a number somebody typed.
  const row = page.getByRole('row', { name: new RegExp(mirror) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('-2,500.00 EISLA');
  await expect(page.getByRole('heading', { name: 'Float' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/5-fondos.png`, fullPage: true });

  // 5. The history, with who signed for it and why.
  await row.getByRole('button', { name: /movimientos/i }).click();
  await expect(page.getByText(reason)).toBeVisible();
  await expect(page.getByText('funding').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/6-movimientos.png`, fullPage: true });
  await page.getByRole('button', { name: /^cerrar$/i }).click();

  // 6. Reconciliation.
  await page.getByRole('link', { name: /conciliación/i }).click();
  await expect(page.getByRole('heading', { name: 'Conciliación' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/7-conciliacion.png`, fullPage: true });

  // 7. The catalogue.
  await page.getByRole('link', { name: /monedas y redes/i }).click();
  await expect(page.getByRole('heading', { name: 'Monedas y redes' })).toBeVisible();
  await expect(page.getByText('EISLA')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/8-catalogo.png`, fullPage: true });

  expect(problems, `consola del navegador:\n${problems.join('\n')}`).toEqual([]);
});
