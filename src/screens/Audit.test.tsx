import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWith, signedIn } from '../test/harness';
import { API, server } from '../test/server';
import { Audit } from './Audit';

function entry(seq: number, over: Record<string, unknown> = {}) {
  return {
    seq,
    at: '2026-09-22T14:05:09.123Z',
    actor: 'u-9',
    actorName: 'marta@islapay.cu',
    kind: 'route',
    action: 'PUT /v1/admin/p2p/rates',
    permission: 'p2p.manage',
    target: '/v1/admin/p2p/rates',
    outcome: 'ok',
    status: 204,
    details: {},
    correlation: 'abc',
    hash: 'f'.repeat(64),
    ...over,
  };
}

describe('Auditoría', () => {
  it('shows who did what, and pages back through older rows', async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get(`${API}/v1/admin/audit`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        asked.push(cursor);
        return cursor === null
          ? HttpResponse.json({ items: [entry(2), entry(1, { kind: 'denied', outcome: 'denied', status: 403 })], nextCursor: '1' })
          : HttpResponse.json({ items: [entry(0, { action: 'treasury.proposal.approved' })], nextCursor: null });
      }),
    );
    const user = userEvent.setup();

    renderWith(<Audit />, signedIn(['audit.read']));

    expect(await screen.findAllByText('PUT /v1/admin/p2p/rates')).toHaveLength(2);
    expect(screen.getByText(/denied · 403/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Más antiguos' }));
    expect(await screen.findByText('treasury.proposal.approved')).toBeInTheDocument();
    await waitFor(() => expect(asked).toEqual([null, '1']));
    expect(screen.getByRole('button', { name: 'Más antiguos' })).toBeDisabled();
  });
});
