import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWith, signedIn } from '../test/harness';
import { API, p2pCatalogue, server } from '../test/server';
import captured from '../test/fixtures/p2p-admin-methods.json';
import { P2PMethods } from './P2PMethods';

const operator = signedIn(['p2p.read', 'p2p.manage']);

/** `admin-methods.json`, exactly as the running backend wrote it. */
function methods(body: object = captured) {
  return http.get(`${API}/v1/admin/p2p/methods`, () => HttpResponse.json(body as never));
}

describe('Métodos P2P', () => {
  it('shows the one CUP rail with its prices per wallet currency', async () => {
    server.use(p2pCatalogue(), methods());

    renderWith(<P2PMethods />, operator);

    expect(await screen.findByRole('heading', { name: 'CUP · CUP' })).toBeInTheDocument();
    expect(screen.getByText('Encendido')).toBeInTheDocument();
    expect(screen.getByLabelText('Mínimo (CUP)')).toHaveValue('500.00');
    expect(screen.getByLabelText('Máximo (CUP)')).toHaveValue('60000.00');

    expect(screen.getByLabelText('EISLA el cliente vende')).toHaveValue('120');
    expect(screen.getByLabelText('EISLA el cliente compra')).toHaveValue('125');
    // USDT is sold for pesos and not bought: the other side is simply empty.
    expect(screen.getByLabelText('USDT el cliente compra')).toHaveValue('130');
    expect(screen.getByLabelText('USDT el cliente vende')).toHaveValue('');
    // USDC, held by customers but unpriced here, is offered to be priced.
    expect(screen.getByLabelText('USDC el cliente vende')).toHaveValue('');
    expect(screen.getByLabelText('Dónde paga el comprador')).toHaveValue(
      captured[0]!.instructions,
    );
  });

  it('publishes what changed, and withdraws a side left empty', async () => {
    const published: unknown[] = [];
    server.use(
      p2pCatalogue(),
      methods(),
      http.put(`${API}/v1/admin/p2p/rates`, async ({ request }) => {
        published.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();

    renderWith(<P2PMethods />, operator);

    await user.type(await screen.findByLabelText('USDT el cliente vende'), '127.5');
    await user.clear(screen.getByLabelText('EISLA el cliente compra'));
    await user.click(screen.getByRole('button', { name: /publicar 2 precios/i }));

    await waitFor(() => expect(published).toHaveLength(2));
    expect(published).toContainEqual({
      methodId: 'cup',
      side: 'sell',
      walletCurrency: 'USDT',
      rate: '127.5',
    });
    expect(published).toContainEqual({
      methodId: 'cup',
      side: 'buy',
      walletCurrency: 'EISLA',
      rate: null,
    });
  });

  it('moves the limits in pesos', async () => {
    let patched: unknown;
    server.use(
      p2pCatalogue(),
      methods(),
      http.patch(`${API}/v1/admin/p2p/methods/:id`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json(captured[0]);
      }),
    );
    const user = userEvent.setup();

    renderWith(<P2PMethods />, operator);

    const max = await screen.findByLabelText('Máximo (CUP)');
    await user.clear(max);
    await user.type(max, '50000');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(patched).toEqual({
        minimum: { amount: '500.00', currency: 'CUP' },
        maximum: { amount: '50000.00', currency: 'CUP' },
      }),
    );
  });

  it('switches a rail off', async () => {
    let asked: string | null = null;
    server.use(
      p2pCatalogue(),
      methods(),
      http.put(`${API}/v1/admin/p2p/methods/:id/available`, ({ request }) => {
        asked = new URL(request.url).searchParams.get('value');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();

    renderWith(<P2PMethods />, operator);
    await user.click(await screen.findByRole('button', { name: 'Apagar' }));

    await waitFor(() => expect(asked).toBe('false'));
  });

  it('opens a rail only for a switched-on fiat currency that has none', async () => {
    let created: unknown;
    server.use(
      p2pCatalogue(),
      methods(),
      http.post(`${API}/v1/admin/p2p/methods`, async ({ request }) => {
        created = await request.json();
        return HttpResponse.json(
          { ...captured[0], id: 'mxn', code: 'MXN', name: 'MXN', available: false, rates: [] },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();

    renderWith(<P2PMethods />, operator);
    await user.click(await screen.findByRole('button', { name: 'Nuevo método' }));

    const dialog = screen.getByRole('dialog', { name: 'Nuevo método' });
    const currency = within(dialog).getByLabelText('Moneda');
    // CUP has its rail, USD is switched off, wallet currencies are not local
    // money: MXN is the only choice.
    expect(within(currency).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'MXN — MXN',
    ]);

    await user.type(within(dialog).getByLabelText('Mínimo por operación (MXN)'), '100');
    await user.type(within(dialog).getByLabelText('Máximo por operación (MXN)'), '20000');
    await user.click(within(dialog).getByRole('button', { name: 'Crear método' }));

    await waitFor(() =>
      expect(created).toEqual({
        currency: 'MXN',
        minimum: { amount: '100.00', currency: 'MXN' },
        maximum: { amount: '20000.00', currency: 'MXN' },
      }),
    );
  });
});
