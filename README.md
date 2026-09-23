# IslaPay · Consola de tesorería

Dónde está el dinero de la plataforma, si el escrow cuadra, y la única puerta
por la que entra más.

Un repositorio aparte del backend a propósito: se despliega en otro sitio, lo
usa otra gente, y nada aquí enlaza contra los ensamblados de `islapay-net-backend`.
El precio de esa separación es que los tipos podrían desviarse, y por eso no se
escriben a mano —se generan.

## Empezar

```bash
npm install
npm run api     # genera src/api/schema.d.ts desde /openapi/v1.json
npm run dev     # http://localhost:5173
```

El backend tiene que estar levantado en `http://127.0.0.1:5000`, y Keycloak en
`http://127.0.0.1:8080` con el realm provisionado:

```bash
# en islapay-net-backend
python3 tools/provision-realm.py
dotnet run --project src/IslaPay.Host
```

Ese script crea el cliente `islapay-console` y el rol `treasury-admin`. El rol
no se concede solo: hay que dárselo a una cuenta desde la consola de Keycloak,
o no se ve nada.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo, con `/v1` proxiado al backend |
| `npm run api` | Regenera los tipos desde la especificación publicada |
| `npm test` | Vitest sobre MSW |
| `npm run build` | `tsc --noEmit` y luego el bundle |
| `npm run e2e` | La consola en un navegador de verdad, contra el stack entero |

`npm run e2e` no forma parte de `npm test` y CI no debería descubrirlo
fallando: necesita Postgres, Keycloak, RabbitMQ, el host y el servidor de
desarrollo levantados, y una cuenta con `treasury-admin`. Lo que compra es la
única comprobación de que la redirección de entrada, el token, el cliente
generado y el servidor se entienden —todo lo cual los tests unitarios simulan,
y en todo lo cual ha vivido un fallo real.

## Las decisiones que importan

**El dinero nunca es un `number`.** `src/money/money.ts` guarda unidades
mínimas enteras en `bigint` y sólo se convierte a decimal camino de la
pantalla. `0.1 + 0.2` es `0.30000000000000004` en JavaScript, y el trabajo de
esta consola es decir cuánto dinero tiene la empresa. La escala sale del
catálogo del servidor, nunca de la cadena: USDT tiene seis decimales y E-ISLA
dos, y una cifra que dedujera la suya de `"5.0"` decidiría que son cero.

Si el catálogo no conoce una moneda, la pantalla muestra la cadena cruda con un
interrogante en vez de inventarse una escala. Renderizar seis decimales de USDT
como dos es equivocarse por diez mil, y parece perfectamente plausible.

**El cliente se genera, no se transcribe.** `npm run api` lee
`/openapi/v1.json` del host y escribe `src/api/schema.d.ts`. Ninguna URL ni
ninguna forma de respuesta está escrita a mano aquí. Una ruta o un campo que
cambie deja de compilar en este repositorio, en vez de fallar delante de un
tesorero. Generar el cliente de verdad ya encontró dos defectos en la
especificación publicada —cada marca de tiempo salía como `unknown`, y cada
entero como `number | string`— que están arreglados en el backend.

**Se entra por Keycloak.** Authorization code con PKCE; aquí no se teclea
ninguna contraseña. Es la superficie cuyo titular puede subir el float, así que
su inicio de sesión debe ser de Keycloak para endurecer —SSO, segundo factor,
política de sesión— y nada de eso es posible con un formulario nuestro. El
token vive en `sessionStorage`, no en `localStorage`: un token de tesorería en
`localStorage` sobrevive a la pestaña, lo comparten todas, y lo lee cualquier
cosa que llegue a ejecutar un script en este origen.

**`code` es lo único que se ramifica.** Toda negativa del API llega como
`application/problem+json`; `src/api/problems.ts` la traduce a una frase que
alguien puede accionar, y enseña el `correlationId`, que es lo que ata una
captura de pantalla a una línea del log del servidor.

**La conciliación es una banda.** El escrow es una sola cuenta por moneda y
tres módulos meten dinero en ella. Cada módulo declara de qué está seguro y qué
tiene en vuelo, y el saldo del libro debe caer entre las dos cifras. Dentro de
la banda sin nada en vuelo es «cuadra»; dentro con algo en vuelo es «vuelve a
mirar en un momento»; fuera es lo que merece despertar a alguien. Contar el
dinero en vuelo de cualquiera de las dos maneras produce alarmas falsas, y una
alarma que grita lobo es la que la gente aprende a ignorar.

**Nunca sólo el color.** Cada veredicto es también una palabra. Un punto rojo y
uno verde son el mismo punto para el ocho por ciento de los hombres que van a
leer esta pantalla.

## Alcance

Esta versión ve los fondos, concilia el escrow, acredita el float y enciende o
apaga monedas y redes. **No** trae la cola de operador de P2P: es otro trabajo,
para otra persona, con otro rol.

Lo que encontró recorrerla en un navegador, y ningún test unitario habría
visto: el código de autorización se canjeaba dos veces (React ejecuta un efecto
dos veces a propósito en desarrollo, y un código se canjea una sola vez); la
autoridad OIDC por defecto decía `127.0.0.1` y el backend valida el emisor como
cadena contra `localhost`, así que la entrada funcionaba y todas las peticiones
respondían 401; y un catálogo que fallaba dejaba todas las pantallas de dinero
cargando para siempre sin decir nada.

Lo que falta: no hay manera de sacar dinero (un ingreso se revierte asentando
su inverso, y ninguna ruta lo hace), no hay exportación, y el saldo no se
comprueba contra la suma de sus propios asientos —`entries` se enseña para que
se pueda vigilar, pero nada recalcula el pliegue.
