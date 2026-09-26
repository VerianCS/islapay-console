import { useState } from 'react';
import type { FormEvent } from 'react';
import { describe } from '../api/problems';
import { Card, Field, Note } from '../ui/components';
import type { Ended } from './session';

/**
 * Email and password, on this page.
 *
 * The password lives in this component's state for as long as the form is on
 * screen, and nowhere else: it is not lifted, not logged, and cleared after a
 * refusal so it is not sitting in memory while somebody reads the error.
 */
export function SignIn({
  onSignIn,
  ended,
}: {
  onSignIn: (email: string, password: string, code?: string) => Promise<void>;
  ended: Ended;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setFailure(null);
    try {
      await onSignIn(email, password, code);
    } catch (error) {
      setFailure(error);
      setPassword('');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  const complete = email.trim() !== '' && password !== '';

  return (
    <div className="centered">
      <Card title="IslaPay · Consola">
        <form className="card__body" onSubmit={submit} style={{ textAlign: 'left' }}>
          {ended === 'expired' && failure === null && (
            <Note tone="warn">La sesión caducó. Vuelve a entrar.</Note>
          )}
          {failure !== null && <Note>{describe(failure)}</Note>}

          <Field label="Correo">
            {(parts) => (
              <input
                {...parts}
                type="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>

          <Field label="Contraseña">
            {(parts) => (
              <input
                {...parts}
                type="password"
                // So a password manager fills it, which is what makes a long
                // password something a treasurer will actually use.
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Código de la app de autenticación"
            hint="Seis cifras. El personal lo necesita; si tu cuenta no tiene app configurada, déjalo vacío."
          >
            {(parts) => (
              <input
                {...parts}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="num"
              />
            )}
          </Field>

          <button
            type="submit"
            className="primary"
            disabled={!complete || busy}
            style={{ width: '100%', marginTop: 4 }}
          >
            {busy ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="muted" style={{ fontSize: 12, margin: '14px 0 0' }}>
            La misma cuenta que en la app, con un rol de personal. Lo que ves depende de
            tus roles.
          </p>
        </form>
      </Card>
    </div>
  );
}
