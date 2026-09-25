import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { renderWith, signedIn } from './test/harness';
import { catalogue, server } from './test/server';
import { App } from './App';
import { ApiFailure } from './api/problems';
import userEvent from '@testing-library/user-event';
import type { AuthState } from './auth/AuthProvider';

function anonymous(): AuthState {
  return { ...signedIn(), operator: null };
}

describe('La consola', () => {
  it('asks for the email and the password on the page', async () => {
    renderWith(<MemoryRouter>{<App />}</MemoryRouter>, anonymous());

    const password = screen.getByLabelText('Contraseña');
    expect(screen.getByLabelText('Correo')).toHaveAttribute('autocomplete', 'username');
    // `current-password`, so a password manager fills it — which is what makes
    // a long password something a treasurer will actually use.
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: /^entrar$/i })).toBeDisabled();
  });

  it('signs in with what was typed, and clears the password after a refusal', async () => {
    const tried: [string, string][] = [];
    const auth = {
      ...anonymous(),
      signIn: async (email: string, password: string) => {
        tried.push([email, password]);
        throw new ApiFailure(401, {
          code: 'invalid_credentials',
          title: 'Unauthorized',
          status: 401,
          detail: null,
          type: '',
          instance: null,
          correlationId: null,
          meta: null,
        });
      },
    };
    const user = userEvent.setup();

    renderWith(<MemoryRouter>{<App />}</MemoryRouter>, auth);

    await user.type(screen.getByLabelText('Correo'), 'ana@islapay.cu');
    await user.type(screen.getByLabelText('Contraseña'), 'wrong-one');
    await user.click(screen.getByRole('button', { name: /^entrar$/i }));

    expect(tried).toEqual([['ana@islapay.cu', 'wrong-one']]);
    // One sentence for a wrong address and a wrong password, as the server
    // intends: telling them apart tells a stranger which addresses exist.
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
    // Kept: the email, which was probably right. Cleared: the password, so it
    // is not sitting in memory while somebody reads the error.
    expect(screen.getByLabelText('Correo')).toHaveValue('ana@islapay.cu');
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
  });

  it('says so when a session ended on its own', async () => {
    renderWith(<MemoryRouter>{<App />}</MemoryRouter>, { ...anonymous(), ended: 'expired' });

    expect(screen.getByText(/la sesión caducó/i)).toBeInTheDocument();
  });

  it('explains a missing role instead of showing empty screens', async () => {
    renderWith(<MemoryRouter>{<App />}</MemoryRouter>, signedIn(['catalog-admin']));

    expect(await screen.findByText(/no tiene el rol/i)).toBeInTheDocument();
    expect(screen.getByText('treasury-admin')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('opens on the funds, because that is the question people come with', async () => {
    server.use(
      catalogue(),
      http.get('/v1/admin/treasury/balances', () =>
        HttpResponse.json({ asOf: '2026-09-22T14:05:09.123Z', accounts: [] }),
      ),
    );

    renderWith(<MemoryRouter initialEntries={['/']}>{<App />}</MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Fondos' })).toBeInTheDocument();
  });

  it('lets a P2P operator in to the desk, and only to the desk', async () => {
    server.use(
      catalogue(),
      http.get('/v1/admin/p2p/queue', () => HttpResponse.json([])),
    );

    renderWith(<MemoryRouter initialEntries={['/fondos']}>{<App />}</MemoryRouter>, signedIn(['p2p-operator']));

    // Sent to the desk: the funds are not theirs to see.
    expect(await screen.findByRole('heading', { name: 'Mesa P2P' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(nav).toHaveTextContent('Cola P2P');
    expect(nav).not.toHaveTextContent('Fondos');
  });
});
