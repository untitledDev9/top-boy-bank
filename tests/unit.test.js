'use strict';
// Pure unit tests — no database or server needed.
require('ts-node/register/transpile-only');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const TtlCache = require('../utils/ttlCache').default;
const escapeRegex = require('../utils/escapeRegex').default;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('TtlCache', () => {
  it('serves a cached value until it expires, then reloads', async () => {
    const cache = new TtlCache(60);
    let loads = 0;
    const load = async () => ++loads;
    assert.equal(await cache.getOrLoad('k', load), 1);
    assert.equal(await cache.getOrLoad('k', load), 1);
    await sleep(90);
    assert.equal(await cache.getOrLoad('k', load), 2);
  });

  it('is disabled (always loads) when the TTL is 0', async () => {
    const cache = new TtlCache(0);
    let loads = 0;
    const load = async () => ++loads;
    await cache.getOrLoad('k', load);
    await cache.getOrLoad('k', load);
    assert.equal(loads, 2);
  });

  it('collapses concurrent misses into a single load (no stampede)', async () => {
    const cache = new TtlCache(1000);
    let loads = 0;
    const load = async () => {
      loads++;
      await sleep(30);
      return 'v';
    };
    const results = await Promise.all(Array.from({ length: 25 }, () => cache.getOrLoad('k', load)));
    assert.equal(loads, 1);
    assert.ok(results.every((r) => r === 'v'));
  });

  it('does not cache "not found" (null) results', async () => {
    const cache = new TtlCache(1000);
    let loads = 0;
    const load = async () => {
      loads++;
      return null;
    };
    await cache.getOrLoad('k', load);
    await cache.getOrLoad('k', load);
    assert.equal(loads, 2);
  });

  it('does not cache a failed load and lets the next call retry', async () => {
    const cache = new TtlCache(1000);
    let loads = 0;
    const load = async () => {
      loads++;
      if (loads === 1) throw new Error('db down');
      return 'ok';
    };
    await assert.rejects(cache.getOrLoad('k', load), /db down/);
    assert.equal(await cache.getOrLoad('k', load), 'ok');
  });

  it('delete() drops the entry', async () => {
    const cache = new TtlCache(1000);
    let loads = 0;
    const load = async () => ++loads;
    await cache.getOrLoad('k', load);
    cache.delete('k');
    assert.equal(await cache.getOrLoad('k', load), 2);
  });

  it('an invalidation during an in-flight load stops the stale value being cached', async () => {
    const cache = new TtlCache(1000);
    let loads = 0;
    const slowOld = async () => {
      loads++;
      await sleep(60);
      return 'old';
    };
    const pending = cache.getOrLoad('k', slowOld);
    await sleep(10);
    cache.delete('k'); // e.g. the user was deactivated while the lookup was running
    assert.equal(await pending, 'old'); // the in-flight caller still gets what it asked for
    assert.equal(cache.get('k'), undefined); // ...but it must not be served to later requests
    assert.equal(await cache.getOrLoad('k', async () => 'new'), 'new');
  });

  it('stays bounded by evicting the oldest entries', () => {
    const cache = new TtlCache(1000, 3);
    for (const k of ['a', 'b', 'c', 'd', 'e']) cache.set(k, k);
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('c'), 'c');
    assert.equal(cache.get('e'), 'e');
  });
});

describe('escapeRegex', () => {
  it('turns every regex metacharacter into a literal', () => {
    const input = '.*+?^${}()|[]\\';
    const re = new RegExp(escapeRegex(input));
    assert.ok(re.test(`before ${input} after`));
    assert.ok(!re.test('before after'));
  });

  it('makes a catastrophic-backtracking pattern harmless (it is matched as text)', () => {
    const evil = '(a+)+$';
    const re = new RegExp(escapeRegex(evil), 'i');
    const started = Date.now();
    assert.ok(!re.test('a'.repeat(5000) + '!'));
    assert.ok(Date.now() - started < 100);
    assert.ok(re.test(`price ${evil}`));
  });

  it('leaves ordinary text untouched', () => {
    assert.equal(escapeRegex('Whole Foods 42'), 'Whole Foods 42');
  });
});

describe('password hashing', () => {
  const bcryptjs = require('bcryptjs');
  const { hashPassword, verifyPassword, BCRYPT_ROUNDS, passwordHashImplementation } = require('../utils/passwordHash');

  it('uses a recognised implementation and keeps the work factor at 12', async () => {
    assert.ok(['native bcrypt', 'bcryptjs'].includes(passwordHashImplementation));
    assert.equal(BCRYPT_ROUNDS, 12);
    const hash = await hashPassword('Password123!');
    assert.match(hash, /^\$2[aby]\$12\$/);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('Password123!');
    assert.equal(await verifyPassword('Password123!', hash), true);
    assert.equal(await verifyPassword('password123!', hash), false);
    assert.equal(await verifyPassword('', hash), false);
  });

  it('accepts hashes made by bcryptjs (existing accounts keep working)', async () => {
    const legacy = await bcryptjs.hash('Existing-Pass-1', 10);
    assert.equal(await verifyPassword('Existing-Pass-1', legacy), true);
    assert.equal(await verifyPassword('wrong', legacy), false);
  });

  it('produces hashes bcryptjs can verify (safe to fall back to bcryptjs)', async () => {
    const hash = await hashPassword('Fresh-Pass-2');
    assert.equal(await bcryptjs.compare('Fresh-Pass-2', hash), true);
  });
});
