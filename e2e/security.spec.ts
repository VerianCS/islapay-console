import { expect, test } from '@playwright/test';

/**
 * Compliance and the audit log, against the real host.
 *
 * Needs an account holding `compliance` and `auditor` (they do not conflict),
 * and the address of some other account to freeze and unfreeze:
 *
 *     COMPLIANCE='{"email": "…", "password": "…"}' CUSTOMER=cliente@correo.cu \
 *     npm run e2e -- security
 */
const staff = JSON.parse(process.env.COMPLIANCE ?? '{}') as { email?: string; password?: string };
const CUSTOMER = process.env.CUSTOMER ?? '';
const SHOTS = process.env.SHOTS ?? 'e2e/shots';

test.skip(!staff.email || !CUSTOMER, 'COMPLIANCE y CUSTOMER no están');

test('congelar una cuenta, descongelarla, y verlo en la auditoría', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/');
  await page.getByLabel('Correo').fill(staff.email!);
  await page.getByLabel('Contraseña').fill(staff.password!);
  await page.getByRole('button', { name: /^entrar$/i }).click();

  // An auditor reads everything and changes nothing; compliance acts on accounts.
  const nav = page.getByRole('navigation');
  await expect(nav).toContainText('Cuentas');
  await expect(nav).toContainText('Auditoría');
  await expect(nav).not.toContainText('Monedas y redes');

  const reason = `Prueba e2e ${Date.now()}`;
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await page.getByRole('main').getByLabel('Correo').fill(CUSTOMER);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('button', { name: 'Congelar' }).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill(reason);
  await page.getByRole('dialog').getByRole('button', { name: 'Congelar la cuenta' }).click();
  await expect(page.getByText(`«${reason}»`, { exact: false })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/s1-congelada.png`, fullPage: true });

  await page.getByRole('button', { name: 'Descongelar' }).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('Revisado, sin fraude');
  await page.getByRole('dialog').getByRole('button', { name: 'Descongelar la cuenta' }).click();
  await expect(page.getByText('Activa')).toBeVisible();

  await page.getByRole('link', { name: 'Auditoría' }).click();
  await page.getByLabel('Acción').fill('compliance.account');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('compliance.account.frozen').first()).toBeVisible();
  await expect(page.getByText(reason).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/s2-auditoria.png`, fullPage: true });

  expect(problems).toEqual([]);
});
