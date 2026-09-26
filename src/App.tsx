import { NavLink, Navigate, Route, Routes } from 'react-router';
import type { ReactNode } from 'react';
import { Can, useAuth } from './auth/AuthProvider';
import type { Permission, StaffAccess } from './auth/AuthProvider';
import { Card, Note } from './ui/components';
import { SignIn } from './auth/SignIn';
import { Funds } from './screens/Funds';
import { Approvals } from './screens/Approvals';
import { Issuance } from './screens/Issuance';
import { Reconciliation } from './screens/Reconciliation';
import { Catalogue } from './screens/Catalogue';
import { P2PDesk } from './screens/P2PDesk';
import { P2PMethods } from './screens/P2PMethods';
import { Accounts } from './screens/Accounts';
import { Audit } from './screens/Audit';
import { Announcements } from './screens/Announcements';

/**
 * Every screen, and the one permission that opens it.
 *
 * In one list so the navigation, the routes and the landing page cannot
 * disagree. A screen that needs more than reading — settling a trade,
 * approving a credit — asks for that on its buttons, not here: an approver
 * and an auditor read the same «Fondos» and see different buttons on it.
 */
const SCREENS: readonly {
  path: string;
  label: string;
  needs: Permission;
  element: ReactNode;
  end?: boolean;
}[] = [
  { path: '/fondos', label: 'Fondos', needs: Can.treasuryRead, element: <Funds /> },
  { path: '/aprobaciones', label: 'Aprobaciones', needs: Can.treasuryRead, element: <Approvals /> },
  { path: '/emision', label: 'Emisión', needs: Can.treasuryRead, element: <Issuance /> },
  { path: '/conciliacion', label: 'Conciliación', needs: Can.treasuryRead, element: <Reconciliation /> },
  { path: '/catalogo', label: 'Monedas y redes', needs: Can.catalogManage, element: <Catalogue /> },
  { path: '/p2p', label: 'Cola P2P', needs: Can.p2pRead, element: <P2PDesk />, end: true },
  { path: '/p2p/metodos', label: 'Métodos P2P', needs: Can.p2pRead, element: <P2PMethods /> },
  { path: '/cuentas', label: 'Cuentas', needs: Can.supportRead, element: <Accounts /> },
  { path: '/auditoria', label: 'Auditoría', needs: Can.auditRead, element: <Audit /> },
  { path: '/avisos', label: 'Avisos', needs: Can.notificationsSend, element: <Announcements /> },
];

export function App() {
  const { operator, access, loading, ended, signIn, signOut } = useAuth();

  if (loading) {
    return (
      <div className="centered">
        <p role="status">Comprobando la sesión…</p>
      </div>
    );
  }

  if (operator === null) return <SignIn onSignIn={signIn} ended={ended} />;

  // The server checks every request; this only decides what to show. Showing
  // a form to somebody who cannot use it would be a dead end with no
  // explanation, which is the one thing worse than hiding it.
  const held = new Set(access?.permissions ?? []);
  const screens = SCREENS.filter((s) => held.has(s.needs));

  if (screens.length === 0) {
    return <NoPermission operator={operator.email} access={access ?? null} onSignOut={signOut} />;
  }

  const home = screens[0]!.path;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          IslaPay <span>Consola</span>
        </div>
        <nav className="nav">
          {screens.map((s) => (
            <NavLink key={s.path} to={s.path} end={s.end ?? false}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar__spacer" />
        <div className="topbar__who">
          {operator.name}
          <br />
          <span style={{ fontSize: 12 }}>{(access?.roles ?? []).join(' · ') || operator.email}</span>
        </div>
        <button type="button" onClick={signOut}>
          Salir
        </button>
      </header>

      <main>
        {(access?.conflicts.length ?? 0) > 0 && (
          <Note tone="warn">
            Tu cuenta tiene roles que no pueden ir juntos ({access!.conflicts.join(', ')}). Esos
            roles no te dan nada hasta que alguien retire uno.
          </Note>
        )}
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          {screens.map((s) => (
            <Route key={s.path} path={s.path} element={s.element} />
          ))}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  );
}

function NoPermission({
  operator,
  access,
  onSignOut,
}: {
  operator: string;
  access: StaffAccess | null;
  onSignOut: () => void;
}) {
  return (
    <div className="centered">
      <Card title="Sin permiso">
        <div className="card__body">
          {access?.multiFactorRequired ? (
            <Note tone="warn">
              <strong>{operator}</strong> tiene roles de personal, pero entró sin el código de su
              app de autenticación. Sal y vuelve a entrar con el código.
            </Note>
          ) : (access?.conflicts.length ?? 0) > 0 ? (
            <Note tone="warn">
              <strong>{operator}</strong> tiene roles que no pueden ir juntos (
              {access!.conflicts.join(', ')}), así que no le dan nada. Quien propone un ingreso no
              puede aprobarlo, y quien concede roles no puede mover dinero.
            </Note>
          ) : (
            <Note tone="warn">
              <strong>{operator}</strong> no tiene ningún rol de personal.
            </Note>
          )}
          <p className="muted">
            Cada pantalla pide un permiso, y cada rol da unos pocos: p2p-operator liquida,
            p2p-manager fija precios, treasury-operator propone ingresos, treasury-approver los
            aprueba, compliance congela cuentas, auditor lo lee todo. Alguien con acceso a
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
