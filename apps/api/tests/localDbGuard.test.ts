import { afterEach, describe, expect, it } from 'vitest';
import { assertLocalDatabase, isLocalMongoUri } from '../scripts/localDbGuard';

describe('sample-data guard (seed, e2e)', () => {
  afterEach(() => {
    delete process.env.ALLOW_REMOTE_DB_WRITES;
  });

  it('accepts only databases on this machine', () => {
    for (const ok of [
      'mongodb://127.0.0.1:27017/innovexa',
      'mongodb://localhost/innovexa-dev',
      'mongodb://user:pw@localhost:27017,127.0.0.1:27018/x?replicaSet=rs',
      'mongodb://[::1]:27017/x',
    ])
      expect(isLocalMongoUri(ok)).toBe(true);
    for (const bad of [
      'mongodb+srv://user:pw@cluster0.abcde.mongodb.net/innovexa',
      'mongodb://db.example.com:27017/innovexa',
      'mongodb://localhost:27017,db.example.com:27017/x',
      'mongodb://localhost.evil.com/x',
      '',
    ])
      expect(isLocalMongoUri(bad)).toBe(false);
  });

  it('refuses a remote database without printing credentials, unless explicitly allowed', () => {
    const uri = 'mongodb+srv://someone:Sup3rSecret@cluster0.abcde.mongodb.net/innovexa';
    expect(() => assertLocalDatabase('the demo seed', uri)).toThrow(
      /cluster0\.abcde\.mongodb\.net/,
    );
    try {
      assertLocalDatabase('the demo seed', uri);
    } catch (e) {
      expect(String(e)).not.toContain('Sup3rSecret');
      expect(String(e)).not.toContain('someone');
    }
    process.env.ALLOW_REMOTE_DB_WRITES = '1';
    expect(() => assertLocalDatabase('the demo seed', uri)).not.toThrow();
  });
});
