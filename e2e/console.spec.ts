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

  // 1. A wrong password first: the refusal has to be a sentence, and the
  // password field has to be empty again afterwards.
  await page.getByLabel('Correo').fill(EMAIL);
  await page.getByLabel('Contraseña').fill('not-the-password');
  await page.getByRole('button', { name: /^entrar$/i }).click();
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
  await expect(page.getByLabel('Contraseña')).toHaveValue('');
  await page.screenshot({ path: `${SHOTS}/1-entrar-mal.png`, fullPage: true });

  // Then the right one.
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.screenshot({ path: `${SHOTS}/1-entrar.png`, fullPage: true });
  await page.getByRole('button', { name: /^entrar$/i }).click();

  // 2. Funds.
  await page.waitForURL(/\/fondos$/);
  // The password is not left anywhere the page can read it back.
  const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
  expect(stored).not.toContain(PASSWORD);
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

  // 8. A reload keeps the treasurer signed in, from the refresh token the tab
  // kept, and never asks for the password again.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Monedas y redes' })).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toHaveCount(0);

  // 9. Sign out, and a reload after it does not bring the session back.
  await page.getByRole('button', { name: /^salir$/i }).click();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Contraseña')).toBeVisible();

  // The wrong password in step 1 is a 401 the browser logs by itself; it is
  // the refusal this test asked for, not a fault.
  const unexpected = problems.filter((p) => !/401/.test(p));
  expect(unexpected, `consola del navegador:\n${unexpected.join('\n')}`).toEqual([]);
});

test('sigue funcionando cuando el token de acceso caduca', async ({ page }) => {
  // Access tokens in the development realm live sixty seconds. The unit tests
  // prove the refresh logic against a stubbed server; this proves Keycloak
  // actually accepts the refresh token this page kept, and rotates it.
  test.setTimeout(150_000);

  await page.goto('/');
  await page.getByLabel('Correo').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: /^entrar$/i }).click();
  await page.waitForURL(/\/fondos$/);

  const before = await page.evaluate(() => sessionStorage.getItem('islapay.console.refresh'));

  // Past the sixty seconds, and past the fifteen-second margin.
  await page.waitForTimeout(62_000);

  const refreshes: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/v1/auth/token/refresh')) refreshes.push(r.status());
  });

  await page.getByRole('link', { name: /conciliación/i }).click();
  await expect(page.getByRole('heading', { name: 'Conciliación' })).toBeVisible();
  await expect(page.getByText(/No hay nada que conciliar|Cuadra|No cuadra/).first()).toBeVisible();

  // One refresh, however many requests the screen made; and a new refresh
  // token, because Keycloak rotates them and the old one is now spent.
  expect(refreshes).toEqual([200]);
  const after = await page.evaluate(() => sessionStorage.getItem('islapay.console.refresh'));
  expect(after).not.toBeNull();
  expect(after).not.toBe(before);
});
