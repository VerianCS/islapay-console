import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { renderWith, signedIn } from './test/harness';
import { catalogue, server } from './test/server';
import { App } from './App';
import type { AuthState } from './auth/AuthProvider';

function anonymous(): AuthState {
  return { ...signedIn(), operator: null };
}

describe('La consola', () => {
  it('sends an unknown visitor to Keycloak rather than asking for a password', async () => {
    renderWith(<MemoryRouter>{<App />}</MemoryRouter>, anonymous());

    expect(screen.getByRole('button', { name: /entrar con keycloak/i })).toBeInTheDocument();
    // No password field anywhere. This is the surface whose holder can raise
    // the float, so its sign-in is Keycloak's to harden.
    expect(document.querySelector('input[type="password"]')).toBeNull();
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
});
