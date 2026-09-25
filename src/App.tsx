import { NavLink, Navigate, Route, Routes } from 'react-router';
import { config } from './config';
import { useAuth, useIsP2POperator, useIsTreasuryAdmin } from './auth/AuthProvider';
import { Card, Note } from './ui/components';
import { SignIn } from './auth/SignIn';
import { Funds } from './screens/Funds';
import { Reconciliation } from './screens/Reconciliation';
import { Catalogue } from './screens/Catalogue';
import { P2PDesk } from './screens/P2PDesk';
import { P2PMethods } from './screens/P2PMethods';

export function App() {
  const { operator, loading, ended, signIn, signOut } = useAuth();
  const treasury = useIsTreasuryAdmin();
  const desk = useIsP2POperator();

  if (loading) {
    return (
      <div className="centered">
        <p role="status">Comprobando la sesión…</p>
      </div>
    );
  }

  if (operator === null) return <SignIn onSignIn={signIn} ended={ended} />;

  // The server checks this on every request; the check here only decides what
  // to show. Showing a credit form to somebody who cannot use it would be a
  // dead end with no explanation, which is the one thing worse than hiding it.
  if (!treasury && !desk) return <NoRole operator={operator.email} onSignOut={signOut} />;

  // Each role sees its own screens and lands on the first of them. A route
  // it cannot use is not linked, and the server refuses it anyway.
  const home = treasury ? '/fondos' : '/p2p';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          IslaPay <span>{treasury ? 'Tesorería' : 'Mesa P2P'}</span>
        </div>
        <nav className="nav">
          {treasury && (
            <>
              <NavLink to="/fondos">Fondos</NavLink>
              <NavLink to="/conciliacion">Conciliación</NavLink>
              <NavLink to="/catalogo">Monedas y redes</NavLink>
            </>
          )}
          {desk && (
            <>
              <NavLink to="/p2p" end>
                Cola P2P
              </NavLink>
              <NavLink to="/p2p/metodos">Métodos P2P</NavLink>
            </>
          )}
        </nav>
        <div className="topbar__spacer" />
        <div className="topbar__who">
          {operator.name}
          <br />
          <span style={{ fontSize: 12 }}>{operator.email}</span>
        </div>
        <button type="button" onClick={signOut}>
          Salir
        </button>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          {treasury && (
            <>
              <Route path="/fondos" element={<Funds />} />
              <Route path="/conciliacion" element={<Reconciliation />} />
              <Route path="/catalogo" element={<Catalogue />} />
            </>
          )}
          {desk && (
            <>
              <Route path="/p2p" element={<P2PDesk />} />
              <Route path="/p2p/metodos" element={<P2PMethods />} />
            </>
          )}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  );
}

function NoRole({ operator, onSignOut }: { operator: string; onSignOut: () => void }) {
  return (
    <div className="centered">
      <Card title="Sin permiso">
        <div className="card__body">
          <Note tone="warn">
            <strong>{operator}</strong> no tiene el rol <code>{config.role}</code> ni{' '}
            <code>{config.p2pRole}</code>.
          </Note>
          <p className="muted">
            Son roles de realm distintos, y aparte de <code>catalog-admin</code>: quien
            enciende una moneda no debería poder además fondearla, y quien paga pesos en la
            mesa P2P no debería poder meter dinero en los fondos. Alguien con acceso a
            Keycloak tiene que concederte el que te toque.
          </p>
          <button type="button" onClick={onSignOut}>
            Salir
          </button>
        </div>
      </Card>
    </div>
  );
}
