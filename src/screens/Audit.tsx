import { useState } from 'react';
import { useAudit } from '../api/queries';
import type { AuditEntry } from '../api/queries';
import { Badge, Card, Empty, Failure, Field, Loading, Moment } from '../ui/components';

const OUTCOME: Readonly<Record<string, 'ok' | 'warn' | 'alarm' | 'quiet'>> = {
  ok: 'ok',
  refused: 'warn',
  failed: 'alarm',
  denied: 'alarm',
};

/**
 * Who did what, and who tried to.
 *
 * Read-only on purpose, and so is the table behind it: rows are appended,
 * never changed, and each one's hash covers the one before, so a gap or an
 * edit shows. The hash is here so an auditor can compare it with an export.
 */
export function Audit() {
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [asked, setAsked] = useState({ actor: '', action: '' });
  // Pages already walked, so «Más recientes» goes back without the server
  // having to page backwards.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const page = useAudit(asked.actor, asked.action, cursor);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setAsked({ actor, action });
    setCursors([null]);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Auditoría</h1>
          <p>
            Cada cambio hecho con un permiso de personal, y cada intento que se rechazó. No se
            puede editar ni borrar: la base de datos lo impide.
          </p>
        </div>
      </div>

      <Card title="Buscar">
        <form className="card__body" onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <Field label="Quién" hint="Correo o id de la cuenta.">
              {(parts) => <input {...parts} value={actor} onChange={(e) => setActor(e.target.value)} />}
            </Field>
            <Field label="Acción" hint="Parte del texto: p2p, treasury, freeze…">
              {(parts) => <input {...parts} value={action} onChange={(e) => setAction(e.target.value)} />}
            </Field>
            <button type="submit" className="primary">
              Buscar
            </button>
          </div>
        </form>
      </Card>

      <Card title="Registro">
        {page.isError ? (
          <div className="card__body">
            <Failure error={page.error} />
          </div>
        ) : page.data === undefined ? (
          <Loading what="el registro" />
        ) : page.data.items.length === 0 ? (
          <Empty>Nada con esos filtros.</Empty>
        ) : (
          <>
            <Entries items={page.data.items} />
            <div className="card__body" style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={cursors.length === 1}
                onClick={() => setCursors((c) => c.slice(0, -1))}
              >
                Más recientes
              </button>
              <button
                type="button"
                disabled={!page.data.nextCursor}
                onClick={() => setCursors((c) => [...c, page.data!.nextCursor ?? null])}
              >
                Más antiguos
              </button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function Entries({ items }: { items: readonly AuditEntry[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Cuándo</th>
          <th>Quién</th>
          <th>Qué</th>
          <th>Permiso</th>
          <th>Resultado</th>
          <th>Detalle</th>
        </tr>
      </thead>
      <tbody>
        {items.map((e) => (
          <tr key={e.seq}>
            <td>
              <Moment at={e.at} />
            </td>
            <td>{e.actorName ?? e.actor}</td>
            <td>
              <code>{e.action}</code>
              {e.target && (
                <>
                  <br />
                  <small className="muted num">{e.target}</small>
                </>
              )}
            </td>
            <td>{e.permission ?? '—'}</td>
            <td>
              <Badge tone={OUTCOME[e.outcome] ?? 'quiet'}>
                {e.outcome}
                {e.status !== null ? ` · ${e.status}` : ''}
              </Badge>
            </td>
            <td>
              <small className="muted">
                {Object.entries(e.details)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              </small>
              <br />
              <small className="muted num" title="Hash de la fila">
                #{e.seq} · {e.hash.slice(0, 12)}
              </small>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
