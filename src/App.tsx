import { NavLink, Navigate, Route, Routes } from 'react-router';
import { config } from './config';
import { useAuth, useIsTreasuryAdmin } from './auth/AuthProvider';
import { Card, Note } from './ui/components';
import { Funds } from './screens/Funds';
import { Reconciliation } from './screens/Reconciliation';
import { Catalogue } from './screens/Catalogue';

export function App() {
  const { operator, loading, error, signIn, signOut } = useAuth();
  const allowed = useIsTreasuryAdmin();

  if (loading) {
    return (
      <div className="centered">
        <p role="status">Comprobando la sesión…</p>
      </div>
    );
  }

  if (operator === null) return <SignIn onSignIn={signIn} error={error} />;

  // The server checks this on every request; the check here only decides what
  // to show. Showing a credit form to somebody who cannot use it would be a
  // dead end with no explanation, which is the one thing worse than hiding it.
  if (!allowed) return <NoRole operator={operator.email} onSignOut={signOut} />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          IslaPay <span>Tesorería</span>
        </div>
        <nav className="nav">
          <NavLink to="/fondos">Fondos</NavLink>
          <NavLink to="/conciliacion">Conciliación</NavLink>
          <NavLink to="/catalogo">Monedas y redes</NavLink>
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
          <Route path="/" element={<Navigate to="/fondos" replace />} />
          <Route path="/callback" element={<Navigate to="/fondos" replace />} />
          <Route path="/fondos" element={<Funds />} />
          <Route path="/conciliacion" element={<Reconciliation />} />
          <Route path="/catalogo" element={<Catalogue />} />
          <Route path="*" element={<Navigate to="/fondos" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function SignIn({ onSignIn, error }: { onSignIn: () => void; error: string | null }) {
  return (
    <div className="centered">
      <Card title="IslaPay · Tesorería">
        <div className="card__body">
          {error !== null && <Note>{error}</Note>}
          <p>
            Esta consola ve dónde está el dinero de la plataforma y es por donde entra
            más. Se entra por Keycloak: aquí no se teclea ninguna contraseña.
          </p>
          <button type="button" className="primary" onClick={onSignIn}>
            Entrar con Keycloak
          </button>
        </div>
      </Card>
    </div>
  );
}

function NoRole({ operator, onSignOut }: { operator: string; onSignOut: () => void }) {
  return (
    <div className="centered">
      <Card title="Sin permiso">
        <div className="card__body">
          <Note tone="warn">
            <strong>{operator}</strong> no tiene el rol <code>{config.role}</code>.
          </Note>
          <p className="muted">
            Es un rol de realm, aparte de <code>catalog-admin</code> y del de operador de
            P2P: quien enciende una moneda no debería poder además fondearla. Alguien con
            acceso a Keycloak tiene que concedértelo.
          </p>
          <button type="button" onClick={onSignOut}>
            Salir
          </button>
        </div>
      </Card>
    </div>
  );
}
