/**
 * What this build points at.
 *
 * Read once, at module load, and never from `import.meta.env` anywhere else:
 * a setting read in two places is a setting that can be spelled wrong in one
 * of them and nothing will say so until somebody signs in against the wrong
 * realm.
 */
export const config = {
  /**
   * Where the API is.
   *
   * Unset means this page's own origin, which is how the console is deployed
   * and what the dev server's proxy imitates — so CORS never enters into it.
   * Resolved to an absolute URL here rather than left as a relative path:
   * `new Request('/v1/…')` works in a browser, where it resolves against the
   * document, and throws `Invalid URL` under Node's fetch, where there is no
   * document. Leaving it relative would mean the console worked and every
   * test of it failed for a reason that has nothing to do with the console.
   */
  apiBase:
    (import.meta.env['VITE_API_BASE'] as string | undefined) || window.location.origin,

  oidc: {
    authority:
      (import.meta.env['VITE_OIDC_AUTHORITY'] as string | undefined) ??
      'http://127.0.0.1:8080/realms/islapay',
    clientId: (import.meta.env['VITE_OIDC_CLIENT_ID'] as string | undefined) ?? 'islapay-console',
  },

  /** The realm role every route here requires. */
  role: 'treasury-admin',
} as const;
