import { Badge, Card, Failure, Loading, Note } from '../ui/components';
import {
  useAdminCurrencies,
  useNetworks,
  useSetCurrencyEnabled,
  useSetNetworkEnabled,
} from '../api/queries';

/**
 * The currencies and chains, as the switches they are.
 *
 * This is the screen that makes the table worth having: a currency is turned
 * on by writing a row, and the running process starts accepting it. No deploy,
 * no restart. Which also means a careless click here stops every wallet in
 * that currency, so each switch says what it will do before it does it.
 */
export function Catalogue() {
  const currencies = useAdminCurrencies();
  const networks = useNetworks();
  const setCurrency = useSetCurrencyEnabled();
  const setNetwork = useSetNetworkEnabled();

  if (currencies.isPending) return <Loading what="el catálogo" />;
  if (currencies.isError) return <Failure error={currencies.error} />;

  const sorted = [...currencies.data].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Monedas y redes</h1>
          <p>
            Filas, no un <code>enum</code>. Encender una moneda es escribir en la tabla y
            el proceso en marcha empieza a aceptarla; apagarla deja de aceptarla en el
            acto, y los saldos que ya existen se siguen leyendo.
          </p>
        </div>
      </div>

      {(setCurrency.isError || setNetwork.isError) && (
        <Failure error={setCurrency.error ?? setNetwork.error} />
      )}

      <Card title="Monedas">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Clase</th>
              <th className="right">Decimales</th>
              <th>Billetera</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((currency) => (
              <tr key={currency.code}>
                <td className="num">
                  <strong>{currency.code}</strong>
                </td>
                <td>{currency.name}</td>
                <td className="muted">{currency.kind}</td>
                <td className="right num">{currency.scale}</td>
                <td>
                  {currency.customerHoldable ? (
                    <span className="muted">Sí</span>
                  ) : (
                    <span
                      className="muted"
                      title="Nadie abre una cuenta en ella: la plataforma sólo la debe a través del escrow."
                    >
                      No
                    </span>
                  )}
                </td>
                <td>
                  {currency.enabled ? (
                    <Badge tone="ok">Encendida</Badge>
                  ) : (
                    <Badge tone="quiet">Apagada</Badge>
                  )}
                </td>
                <td className="right">
                  <button
                    type="button"
                    disabled={setCurrency.isPending}
                    onClick={() =>
                      setCurrency.mutate({ code: currency.code, value: !currency.enabled })
                    }
                  >
                    {currency.enabled ? 'Apagar' : 'Encender'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Redes">
        {networks.isPending ? (
          <Loading what="las redes" />
        ) : networks.isError ? (
          <Failure error={networks.error} />
        ) : (
          <>
            <div style={{ padding: '12px 16px 0' }}>
              <Note tone="warn">
                Esta lista sólo trae las redes encendidas: es la vista que usa un cliente.
                Apagar una apaga con ella todos los activos que viajan por ahí.
              </Note>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Identificador</th>
                  <th>Nombre</th>
                  <th className="right">Confirmaciones</th>
                  <th>Memo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {networks.data.map((network) => (
                  <tr key={network.id}>
                    <td className="num">{network.id}</td>
                    <td>{network.name}</td>
                    <td
                      className="right num"
                      title="Bloques tras los que esta versión da por irreversible una transferencia."
                    >
                      {network.confirmations}
                    </td>
                    <td className="muted">{network.memoRequired ? 'Obligatorio' : '—'}</td>
                    <td className="right">
                      <button
                        type="button"
                        disabled={setNetwork.isPending}
                        onClick={() => setNetwork.mutate({ id: network.id, value: false })}
                      >
                        Apagar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </>
  );
}
