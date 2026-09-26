import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWith, signedIn } from '../test/harness';
import { API, problem, server } from '../test/server';
import { Accounts } from './Accounts';

function standing(over: Record<string, unknown> = {}) {
  return {
    userId: 'u-1',
    name: 'Lucía Gómez',
    email: 'lucia@correo.cu',
    phone: '+5355512345',
    phoneVerified: true,
    identityVerified: false,
    level: 1,
    maxPerMovement: '1000',
    frozen: false,
    frozenReason: null,
    frozenAt: null,
    frozenBy: null,
    ...over,
  };
}

async function lookUp(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Correo'), 'lucia@correo.cu');
  await user.click(screen.getByRole('button', { name: 'Buscar' }));
}

describe('Cuentas', () => {
  it('shows what the customer was told, and whether they read it', async () => {
    server.use(
      http.get(`${API}/v1/admin/compliance/accounts`, () => HttpResponse.json(standing())),
      http.get(`${API}/v1/admin/notifications/users/u-1`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'n-1',
              type: 'account.frozen',
              category: 'account',
              title: 'Tu cuenta está en revisión',
              body: 'Por ahora no puedes enviar, convertir ni comprar.',
              data: {},
              createdAt: '2026-09-26T10:00:00.000Z',
            },
            {
              id: 'n-2',
              type: 'transfer.received',
              category: 'movements',
              title: 'Recibiste 12.50 EISLA',
              body: 'Ana Pérez te envió 12.50 EISLA.',
              data: {},
              createdAt: '2026-09-25T10:00:00.000Z',
              readAt: '2026-09-25T11:00:00.000Z',
            },
          ],
          unread: 1,
        }),
      ),
    );
    const user = userEvent.setup();

    renderWith(<Accounts />, signedIn(['support.read']));
    await lookUp(user);

    const table = (await screen.findByText('Tu cuenta está en revisión')).closest('table')!;
    expect(within(table).getByText('Recibiste 12.50 EISLA')).toBeInTheDocument();
    // Unread says so in a word.
    expect(within(table).getByText('No')).toBeInTheDocument();
  });

  it('freezes with a reason, and shows the account frozen', async () => {
    const seen: unknown[] = [];
    server.use(
      http.get(`${API}/v1/admin/compliance/accounts`, () => HttpResponse.json(standing())),
      http.post(`${API}/v1/admin/compliance/accounts/u-1/freeze`, async ({ request }) => {
        seen.push(await request.json());
        return HttpResponse.json(
          standing({ frozen: true, frozenReason: 'Fraude 114', frozenBy: 'ana', frozenAt: '2026-09-22T14:05:09.123Z' }),
        );
      }),
    );
    const user = userEvent.setup();

    renderWith(<Accounts />, signedIn(['support.read', 'compliance.act']));
    await lookUp(user);

    await user.click(await screen.findByRole('button', { name: 'Congelar' }));
    const dialog = screen.getByRole('dialog', { name: 'Congelar la cuenta' });
    const send = within(dialog).getByRole('button', { name: 'Congelar la cuenta' });
    expect(send).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Motivo'), 'Fraude 114');
    await user.click(send);

    await waitFor(() => expect(seen).toEqual([{ reason: 'Fraude 114' }]));
    expect((await screen.findAllByText('Congelada')).length).toBeGreaterThan(0);
    expect(screen.getByText(/«Fraude 114»/)).toBeInTheDocument();
  });

  it('lets support look and not touch', async () => {
    server.use(http.get(`${API}/v1/admin/compliance/accounts`, () => HttpResponse.json(standing())));
    const user = userEvent.setup();

    renderWith(<Accounts />, signedIn(['support.read']));
    await lookUp(user);

    expect(await screen.findByText('Lucía Gómez')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Congelar' })).not.toBeInTheDocument();
    expect(screen.getByText(/sólo cumplimiento/i)).toBeInTheDocument();
  });

  it('says plainly when there is no such account', async () => {
    server.use(
      http.get(`${API}/v1/admin/compliance/accounts`, () => problem(404, 'account_not_found')),
    );
    const user = userEvent.setup();

    renderWith(<Accounts />, signedIn(['support.read']));
    await lookUp(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no hay ninguna cuenta/i);
  });
});
