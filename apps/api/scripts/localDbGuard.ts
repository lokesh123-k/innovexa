/**
 * Guard for tools that write sample data (seed script, Playwright e2e): they must only touch a
 * database on this machine. NODE_ENV alone is not enough — a local .env that says "development"
 * can still point at the shared Atlas database, which is how demo records once reached real data.
 */

/** True when every host in the URI is this machine. `mongodb+srv://` is always a remote cluster. */
export function isLocalMongoUri(uri: string): boolean {
  if (!uri.startsWith('mongodb://')) return false;
  const hosts =
    uri
      .slice('mongodb://'.length)
      .replace(/^[^@/]*@/, '')
      .split('/')[0] ?? '';
  return hosts.split(',').every((h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h));
}

/** Throws unless MONGODB_URI is local or ALLOW_REMOTE_DB_WRITES=1 is set explicitly. */
export function assertLocalDatabase(what: string, uri = process.env.MONGODB_URI ?? ''): void {
  if (isLocalMongoUri(uri) || process.env.ALLOW_REMOTE_DB_WRITES === '1') return;
  let host = 'unknown host';
  try {
    host = new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).hostname; // never print credentials
  } catch {
    /* keep "unknown host" */
  }
  throw new Error(
    `Refusing to run ${what}: MONGODB_URI points at ${host}, not a local database. ` +
      'It writes demo/test records. Use a local or separate development database ' +
      '(e.g. `npm run dev:db` with mongodb://127.0.0.1:27017/innovexa-dev), or set ALLOW_REMOTE_DB_WRITES=1 ' +
      'if you really mean to write sample data there.',
  );
}
