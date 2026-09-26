import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWith, signedIn } from '../test/harness';
import { API, problem, server } from '../test/server';
import { Announcements } from './Announcements';

function broadcast(over: Record<string, unknown> = {}) {
  return {
    id: 'b-1',
    title: 'Mantenimiento el domingo',
    body: 'El domingo de 2:00 a 3:00 la app puede no responder.',
    audience: 'all',
    sentBy: 'comms@islapay.cu',
    sentAt: '2026-09-26T10:00:00.000Z',
    expiresAt: '2026-10-10T10:00:00.000Z',
    devices: 42,
    ...over,
  };
}

describe('Avisos', () => {
  it('lists what was sent, to whom and to how many phones', async () => {
    server.use(
      http.get(`${API}/v1/admin/notifications/broadcasts`, () =>
        HttpResponse.json([broadcast(), broadcast({ id: 'b-2', title: 'Tu tarjeta', audience: 'lucia@correo.cu', expiresAt: undefined, devices: 1 })]),
      ),
    );

    renderWith(<Announcements />, signedIn(['notifications.send']));

    expect(await screen.findByText('Mantenimiento el domingo')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]!).getByText('Todos')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('42')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('lucia@correo.cu')).toBeInTheDocument();
  });

  it('shows the preview, asks once more, and sends to everybody with a key', async () => {
    const seen: { body: unknown; key: string | null }[] = [];
    server.use(
      http.get(`${API}/v1/admin/notifications/broadcasts`, () => HttpResponse.json([])),
      http.post(`${API}/v1/admin/notifications/broadcasts`, async ({ request }) => {
        seen.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        return HttpResponse.json(broadcast({ devices: 7 }), { status: 201 });
      }),
    );
    const user = userEvent.setup();

    renderWith(<Announcements />, signedIn(['notifications.send']));
    await screen.findByText(/todavía no se ha enviado/i);

    const send = screen.getByRole('button', { name: 'Revisar y enviar' });
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText('Título'), 'Mantenimiento el domingo');
    await user.type(screen.getByLabelText('Mensaje'), 'El domingo de 2:00 a 3:00 la app puede no responder.');
    // The preview is the words as typed.
    expect(within(screen.getByRole('figure', { name: 'Vista previa' })).getByText('Mantenimiento el domingo')).toBeInTheDocument();

    await user.click(send);
    const dialog = screen.getByRole('dialog', { name: '¿Enviar a todos los clientes?' });
    expect(within(dialog).getByText(/no se puede retirar/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.body).toEqual({
      title: 'Mantenimiento el domingo',
      body: 'El domingo de 2:00 a 3:00 la app puede no responder.',
      days: 14,
    });
    expect(seen[0]!.key).toBeTruthy();
    expect(await screen.findByText(/push en cola para 7 dispositivos/i)).toBeInTheDocument();
  });

  it('sends to one account by e-mail, and says so when there is no such account', async () => {
    const seen: unknown[] = [];
    server.use(
      http.get(`${API}/v1/admin/notifications/broadcasts`, () => HttpResponse.json([])),
      http.post(`${API}/v1/admin/notifications/broadcasts`, async ({ request }) => {
        seen.push(await request.json());
        return problem(404, 'recipient_not_found');
      }),
    );
    const user = userEvent.setup();

    renderWith(<Announcements />, signedIn(['notifications.send']));
    await screen.findByText(/todavía no se ha enviado/i);

    await user.click(screen.getByLabelText('Una cuenta'));
    expect(screen.queryByLabelText('Días en la lista')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Correo de la cuenta'), 'Nadie@Correo.cu');
    await user.type(screen.getByLabelText('Título'), 'Tu tarjeta');
    await user.type(screen.getByLabelText('Mensaje'), 'Puedes recogerla.');
    await user.click(screen.getByRole('button', { name: 'Revisar y enviar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar' }));

    await waitFor(() =>
      expect(seen).toEqual([{ title: 'Tu tarjeta', body: 'Puedes recogerla.', email: 'nadie@correo.cu' }]),
    );
    expect(await screen.findByText('No hay ninguna cuenta con ese correo.')).toBeInTheDocument();
  });
});
