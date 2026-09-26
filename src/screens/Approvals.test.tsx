import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWith, signedIn } from '../test/harness';
import { API, catalogue, problem, server } from '../test/server';
import { Approvals } from './Approvals';

function proposal(over: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    kind: 'credit',
    status: 'pending',
    destination: 'float',
    amount: { amount: '1500.00', currency: 'EISLA' },
    source: 'bank:bandec',
    reason: 'Aporte de septiembre',
    proposedBy: 'someone-else',
    proposedByName: 'beto@islapay.cu',
    proposedAt: '2026-09-22T14:05:09.123Z',
    expiresAt: '2026-09-23T14:05:09.123Z',
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    decisionNote: null,
    postingId: null,
    ...over,
  };
}

function listing(pending: unknown[], all: unknown[] = pending) {
  return http.get(`${API}/v1/admin/treasury/proposals`, ({ request }) =>
    HttpResponse.json(new URL(request.url).searchParams.get('status') === 'pending' ? pending : all),
  );
}

const approver = signedIn(['treasury.read', 'treasury.approve']);

describe('Aprobaciones', () => {
  it('approves somebody else’s proposal with a key, and says what it is doing', async () => {
    const seen: { key: string | null; body: unknown }[] = [];
    server.use(
      catalogue(),
      listing([proposal()]),
      http.post(`${API}/v1/admin/treasury/proposals/p-1/approve`, async ({ request }) => {
        seen.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
        return HttpResponse.json(proposal({ status: 'approved', postingId: 'post-1' }));
      }),
    );
    const user = userEvent.setup();

    renderWith(<Approvals />, approver);

    const row = (await screen.findByText('Aporte de septiembre')).closest('tr')!;
    expect(row).toHaveTextContent('1,500.00');
    await user.click(within(row).getByRole('button', { name: 'Aprobar' }));

    const dialog = screen.getByRole('dialog', { name: 'Aprobar el ingreso' });
    expect(dialog).toHaveTextContent(/compruébalo contra el extracto/i);
    await user.click(within(dialog).getByRole('button', { name: /aprobar y asentar/i }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not offer the proposer their own proposal, and says why', async () => {
    server.use(catalogue(), listing([proposal({ proposedBy: 'op-1' })]));

    renderWith(<Approvals />, signedIn(['treasury.read', 'treasury.propose', 'treasury.approve']));

    const row = (await screen.findByText('Aporte de septiembre')).closest('tr')!;
    expect(row).toHaveTextContent(/tuya: la aprueba otra persona/i);
    expect(within(row).queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Retirar' })).toBeInTheDocument();
  });

  it('will not reject without a reason', async () => {
    server.use(catalogue(), listing([proposal()]));
    const user = userEvent.setup();

    renderWith(<Approvals />, approver);

    const row = (await screen.findByText('Aporte de septiembre')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Rechazar' }));

    const dialog = screen.getByRole('dialog', { name: 'Rechazar el ingreso' });
    const send = within(dialog).getByRole('button', { name: 'Rechazar' });
    expect(send).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Motivo del rechazo'), 'El extracto dice 1400');
    expect(send).toBeEnabled();
  });

  it('explains a proposal somebody else decided first', async () => {
    server.use(
      catalogue(),
      listing([proposal()]),
      http.post(`${API}/v1/admin/treasury/proposals/p-1/approve`, () =>
        problem(409, 'proposal_not_pending'),
      ),
    );
    const user = userEvent.setup();

    renderWith(<Approvals />, approver);

    const row = (await screen.findByText('Aporte de septiembre')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Aprobar' }));
    await user.click(screen.getByRole('button', { name: /aprobar y asentar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya se decidió/i);
  });

  it('shows a reader the proposals and no buttons', async () => {
    server.use(catalogue(), listing([proposal()]));

    renderWith(<Approvals />, signedIn(['treasury.read']));

    const row = (await screen.findByText('Aporte de septiembre')).closest('tr')!;
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });
});
