import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWith, signedIn } from '../test/harness';
import { API, p2pCatalogue, problem, server } from '../test/server';
import { P2PDesk, waited } from './P2PDesk';

const operator = signedIn(['p2p.read', 'p2p.settle']);

// Shapes copied from `admin-queue.json` / `admin-search.json`, which the
// backend's `Capture_the_p2p_responses` wrote from a running server.
const sale = {
  id: 'e5131680-68f5-419f-b5a0-3e6fcf64caf5',
  side: 'sell',
  methodId: 'cup',
  methodName: 'CUP',
  userId: 'u-1',
  userName: 'Ana Pérez',
  amount: { amount: '100.00', currency: 'EISLA' },
  local: { amount: '11880.00', currency: 'CUP' },
  status: 'awaiting_payout',
  reference: 'JHD0-24G9',
  createdAt: '2026-09-25T11:46:58.158Z',
  waiting: '00:00:04.7714051',
  payoutTo: '9205 1299 0000 1234',
  expiresAt: '2026-09-25T15:46:58.158Z',
};

const expiredBuy = {
  ...sale,
  id: '7b1f0c4e-2d7a-4c1b-9d55-0c0e8c9a1f00',
  side: 'buy',
  userName: 'Luis Gómez',
  amount: { amount: '40.00', currency: 'EISLA' },
  local: { amount: '5000.00', currency: 'CUP' },
  status: 'expired',
  reference: 'K7QM-2X9A',
  payoutTo: null,
};

function queue(items: unknown[]) {
  return http.get(`${API}/v1/admin/p2p/queue`, () => HttpResponse.json(items));
}

describe('Mesa P2P', () => {
  it('shows what to send, where, and against which reference', async () => {
    server.use(p2pCatalogue(), queue([sale]));

    renderWith(<P2PDesk />, operator);

    const row = (await screen.findByText('JHD0-24G9')).closest('tr')!;
    // Six places for nothing: pesos at the scale the catalogue gives CUP.
    expect(within(row).getByText('11,880.00 CUP')).toBeInTheDocument();
    expect(within(row).getByText('100.00 EISLA')).toBeInTheDocument();
    expect(within(row).getByText('9205 1299 0000 1234')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Pagado' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Falló' })).toBeInTheDocument();
    expect(screen.getByText('1 esperando')).toBeInTheDocument();
  });

  it('pays a sale only with the bank reference, under one idempotency key', async () => {
    const sent: { body: unknown; key: string | null }[] = [];
    server.use(
      p2pCatalogue(),
      queue([sale]),
      http.post(`${API}/v1/admin/p2p/trades/:id/paid`, async ({ request, params }) => {
        expect(params['id']).toBe(sale.id);
        sent.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        return HttpResponse.json({ ...sale, status: 'completed' });
      }),
    );
    const user = userEvent.setup();

    renderWith(<P2PDesk />, operator);
    await user.click(await screen.findByRole('button', { name: 'Pagado' }));

    const dialog = screen.getByRole('dialog', { name: 'Marcar la venta como pagada' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirmar pago' });
    // Nothing moves without the reference: a dispute later needs it.
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Referencia del banco'), 'TM-55512');
    await user.click(confirm);

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({ reference: 'TM-55512' });
    expect(sent[0]!.key).toMatch(/.{16,}/);
  });

  it('fails a sale with a reason the customer will read', async () => {
    let reason: unknown;
    server.use(
      p2pCatalogue(),
      queue([sale]),
      http.post(`${API}/v1/admin/p2p/trades/:id/failed`, async ({ request }) => {
        reason = await request.json();
        return HttpResponse.json({ ...sale, status: 'refunded' });
      }),
    );
    const user = userEvent.setup();

    renderWith(<P2PDesk />, operator);
    await user.click(await screen.findByRole('button', { name: 'Falló' }));

    const dialog = screen.getByRole('dialog', { name: 'La venta no se pudo pagar' });
    await user.type(
      within(dialog).getByLabelText('Motivo, para el cliente'),
      'El teléfono no está registrado en Transfermóvil.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Devolver el saldo' }));

    await waitFor(() =>
      expect(reason).toEqual({ reason: 'El teléfono no está registrado en Transfermóvil.' }),
    );
  });

  it('finds an expired buy by the reference the bank printed, and credits it', async () => {
    let searched: URLSearchParams | undefined;
    let received = false;
    server.use(
      p2pCatalogue(),
      queue([]),
      http.get(`${API}/v1/admin/p2p/trades`, ({ request }) => {
        searched = new URL(request.url).searchParams;
        return HttpResponse.json([expiredBuy]);
      }),
      http.post(`${API}/v1/admin/p2p/trades/:id/received`, () => {
        received = true;
        return HttpResponse.json({ ...expiredBuy, status: 'completed' });
      }),
    );
    const user = userEvent.setup();

    renderWith(<P2PDesk />, operator);

    // Invisible in the queue, which only shows what is still expected.
    expect(await screen.findByText('No hay ventas por pagar ni compras por recibir.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Referencia'), 'k7qm2x9a');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    const row = (await screen.findByText('K7QM-2X9A')).closest('tr')!;
    expect(searched?.get('reference')).toBe('k7qm2x9a');
    expect(within(row).getByText('Vencida')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Recibido' }));
    const dialog = screen.getByRole('dialog', { name: 'Marcar la compra como recibida' });
    expect(within(dialog).getByText(/la compra venció/i)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Referencia del banco'), 'TM-9001');
    await user.click(within(dialog).getByRole('button', { name: 'Acreditar al cliente' }));

    await waitFor(() => expect(received).toBe(true));
  });

  it('explains a refusal instead of closing as if it had worked', async () => {
    server.use(
      p2pCatalogue(),
      queue([sale]),
      http.post(`${API}/v1/admin/p2p/trades/:id/paid`, () => problem(409, 'trade_not_open')),
    );
    const user = userEvent.setup();

    renderWith(<P2PDesk />, operator);
    await user.click(await screen.findByRole('button', { name: 'Pagado' }));
    const dialog = screen.getByRole('dialog', { name: 'Marcar la venta como pagada' });
    await user.type(within(dialog).getByLabelText('Referencia del banco'), 'TM-1');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar pago' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/ya no está abierta/);
  });

  it('says how long somebody has waited the way a person would', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    expect(waited('2026-09-25T11:59:40Z', now)).toBe('hace un momento');
    expect(waited('2026-09-25T11:35:00Z', now)).toBe('hace 25 min');
    expect(waited('2026-09-25T09:50:00Z', now)).toBe('hace 2 h 10 min');
  });
});
