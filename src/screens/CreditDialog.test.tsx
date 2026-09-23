import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWith } from '../test/harness';
import { API, catalogue, problem, server } from '../test/server';
import { CreditDialog } from './CreditDialog';

interface Seen {
  body: Record<string, unknown>;
  idempotencyKey: string | null;
}

function acceptCredits(seen: Seen[]) {
  return http.post(`${API}/v1/admin/treasury/credits`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seen.push({ body, idempotencyKey: request.headers.get('Idempotency-Key') });

    return HttpResponse.json({
      postingId: '0195f2ac-0000-7000-8000-000000000001',
      destination: body['destination'],
      amount: body['amount'],
      balanceAfter: { amount: '1500.00', currency: 'EISLA' },
      source: body['source'],
      reason: body['reason'],
      by: 'op-1',
      at: '2026-09-22T14:05:09.123Z',
      applied: true,
    });
  });
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  values: { amount?: string; source?: string; reason?: string; currency?: string },
) {
  if (values.currency !== undefined) {
    await user.selectOptions(screen.getByLabelText('Moneda'), values.currency);
  }
  if (values.amount !== undefined) {
    await user.type(screen.getByLabelText('Importe'), values.amount);
  }
  if (values.source !== undefined) {
    await user.type(screen.getByLabelText('Origen'), values.source);
  }
  if (values.reason !== undefined) {
    await user.type(screen.getByLabelText('Motivo'), values.reason);
  }
}

describe('Ingresar dinero', () => {
  it('sends the wire shape the server expects, with a key', async () => {
    const seen: Seen[] = [];
    server.use(catalogue(), acceptCredits(seen));
    const user = userEvent.setup();

    renderWith(<CreditDialog open onClose={() => {}} />);
    await screen.findByLabelText('Moneda');

    await fill(user, { amount: '1500', source: 'BANK:BANDEC', reason: 'Capital inicial' });
    await user.click(screen.getByRole('button', { name: /registrar ingreso/i }));

    await waitFor(() => expect(seen).toHaveLength(1));

    // The amount goes as a decimal string at the currency's own scale — never
    // as a JSON number, which is read as a float and loses exactness.
    expect(seen[0]!.body).toEqual({
      destination: 'float',
      amount: { amount: '1500.00', currency: 'EISLA' },
      source: 'bank:bandec',
      reason: 'Capital inicial',
    });

    // Without a key, a retry on a dropped connection funds the float twice and
    // the second one looks exactly like the first in every report.
    expect(seen[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives each deliberate press its own key', async () => {
    const seen: Seen[] = [];
    server.use(catalogue(), acceptCredits(seen));
    const user = userEvent.setup();

    // Two separate visits rather than a rerender: Testing Library's rerender
    // replaces the whole tree with what it is given, which would drop the
    // providers this component needs.
    const first = renderWith(<CreditDialog open onClose={() => {}} />);
    await screen.findByLabelText('Moneda');
    await fill(user, { amount: '10', source: 'capital', reason: 'Primero' });
    await user.click(screen.getByRole('button', { name: /registrar ingreso/i }));
    await waitFor(() => expect(seen).toHaveLength(1));
    first.unmount();

    renderWith(<CreditDialog open onClose={() => {}} />);
    await screen.findByLabelText('Moneda');
    await fill(user, { amount: '10', source: 'capital', reason: 'Segundo' });
    await user.click(screen.getByRole('button', { name: /registrar ingreso/i }));
    await waitFor(() => expect(seen).toHaveLength(2));

    // Two intentional deposits of the same amount to the same place are two
    // deposits. A key derived from the amount and destination would collapse
    // them and silently discard the second.
    expect(seen[0]!.idempotencyKey).not.toBe(seen[1]!.idempotencyKey);
  });

  it('refuses an amount with more decimals than the currency has, before sending', async () => {
    const seen: Seen[] = [];
    server.use(catalogue(), acceptCredits(seen));
    const user = userEvent.setup();

    renderWith(<CreditDialog open onClose={() => {}} />);
    await screen.findByLabelText('Moneda');

    await fill(user, { amount: '1.005', source: 'capital', reason: 'Tres decimales' });

    expect(screen.getByText(/3 decimal places and the currency has 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /registrar ingreso/i })).toBeDisabled();
    expect(seen).toHaveLength(0);
  });

  it('refuses zero, which is not an ingreso', async () => {
    server.use(catalogue());
    const user = userEvent.setup();

    renderWith(<CreditDialog open onClose={() => {}} />);
    await screen.findByLabelText('Moneda');

    await fill(user, { amount: '0', source: 'capital', reason: 'Nada' });

    expect(screen.getByText(/se asienta el inverso/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /registrar ingreso/i })).toBeDisabled();
  });

  it('will not send without a reason', async () => {
    server.use(catalogue());
    const user = userEvent.setup();

    renderWith(<CreditDialog open onClose={() => {}} />);
    await screen.findByLabelText('Moneda');

    await fill(user, { amount: '10', source: 'capital' });

    // An unexplained credit is indistinguishable from a mistake six months
    // later, which is the only moment anybody reads it.
    expect(screen.getByRole('button', { name: /registrar ingreso/i })).toBeDisabled();
  });

  it('shows the server’s refusal in words, not a code', async () => {
    server.use(
      catalogue(),
      http.post(`${API}/v1/admin/treasury/credits`, () =>
        problem(422, 'unknown_destination'),
      ),
    );
    const user = userEvent.setup();

    renderWith(<CreditDialog open onClose={() => {}} />);
    await screen.findByLabelText('Moneda');

    await fill(user, { amount: '10', source: 'capital', reason: 'Prueba' });
    await user.click(screen.getByRole('button', { name: /registrar ingreso/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/float o al fondo/i);
  });

  it('says plainly when a replay moved no money', async () => {
    server.use(
      catalogue(),
      http.post(`${API}/v1/admin/treasury/credits`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          postingId: '0195f2ac-0000-7000-8000-000000000001',
          destination: 'float',
          amount: body['amount'],
          balanceAfter: { amount: '1500.00', currency: 'EISLA' },
          source: 'capital',
          reason: 'Repetido',
          by: 'op-1',
          at: '2026-09-22T14:05:09.123Z',
          applied: false,
        });
      }),
    );
    const user = userEvent.setup();

    renderWith(<CreditDialog open onClose={() => {}} />);
    await screen.findByLabelText('Moneda');

    await fill(user, { amount: '10', source: 'capital', reason: 'Repetido' });
    await user.click(screen.getByRole('button', { name: /registrar ingreso/i }));

    // "Registrado" with no more would let somebody believe the money moved
    // twice, or that it did not move at all. It says which.
    expect(await screen.findByText(/no se movió dinero por segunda vez/i)).toBeInTheDocument();
  });
});
