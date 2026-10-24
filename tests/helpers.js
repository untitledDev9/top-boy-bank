'use strict';
// Test harness: starts the real server (ts-node, transpile-only) against a real
// MongoDB and gives tests helpers to seed data and call the API.
//
//   TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test
//
// Each test file gets its own throwaway database (dropped afterwards). Point
// TEST_MONGO_URI at a LOCAL or disposable MongoDB — never at production data.
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
const mongoose = require('mongoose');

const ROOT = path.resolve(__dirname, '..');
const SECRET = 'test-secret';
const BASE_URI = process.env.TEST_MONGO_URI;
const { ObjectId } = mongoose.Types;

// These tests create users, move money and drop their database afterwards. Refuse
// to point them at a hosted/Atlas cluster by accident — use a local or disposable
// MongoDB. (Set TEST_ALLOW_REMOTE=1 only if you really mean it.)
if (BASE_URI && !process.env.TEST_ALLOW_REMOTE && (/\+srv:/.test(BASE_URI) || /mongodb\.net/i.test(BASE_URI))) {
  throw new Error('TEST_MONGO_URI looks like a hosted MongoDB. Use a local/disposable instance, or set TEST_ALLOW_REMOTE=1.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startApp(extraEnv = {}) {
  const port = await freePort();
  const dbName = `topboy_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const child = spawn(
    process.execPath,
    ['-r', path.join(__dirname, 'support', 'stub-mail.cjs'), require.resolve('ts-node/dist/bin.js'), 'server.ts'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        MONGO_URI: `${BASE_URI}/${dbName}`,
        JWT_SECRET: SECRET,
        CLIENT_URL: 'http://localhost:5173',
        NODE_ENV: 'test',
        EMAIL_USER: 'test',
        EMAIL_APP_PASSWORD: 'test',
        GROQ_API_KEY: 'test',
        TS_NODE_TRANSPILE_ONLY: '1',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));

  const base = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let i = 0; i < 240 && !healthy; i++) {
    try {
      healthy = (await fetch(`${base}/api/health`)).status === 200;
    } catch {
      /* not up yet */
    }
    if (!healthy) await sleep(250);
  }
  if (!healthy) {
    child.kill();
    throw new Error(`server did not start:\n${log.slice(-1500)}`);
  }

  const conn = await mongoose.createConnection(`${BASE_URI}/${dbName}`).asPromise();
  const db = conn.db;

  const token = (id, role = 'customer') => jwt.sign({ id: String(id), role }, SECRET, { expiresIn: '1h' });

  async function request(method, urlPath, { token: tok, body, headers } = {}) {
    const res = await fetch(base + urlPath, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(tok ? { authorization: `Bearer ${tok}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  let seq = 0;
  async function makeUser({ balance = 0, verified = true, active = true, pin = '1234', role = 'customer', name, password } = {}) {
    // Capture the counter now: other makeUser() calls run concurrently and would
    // otherwise bump it while this one is awaiting the database.
    const n = ++seq;
    const userId = new ObjectId();
    await db.collection('users').insertOne({
      _id: userId,
      full_name: name || `Test User ${n}`,
      email: `user${n}-${userId}@test.local`,
      // Cost 4 keeps test setup fast; the app verifies any bcrypt cost.
      password: password ? await bcryptjs.hash(password, 4) : 'x',
      ...(pin ? { transaction_pin: pin } : {}),
      role,
      is_verified: verified,
      is_active: active,
      login_attempts: 0,
      pin_attempts: 0,
      created_at: new Date(),
    });
    const accountId = new ObjectId();
    const accountNumber = String(3000000000 + n * 13 + Math.floor(Math.random() * 10));
    if (role === 'customer') {
      await db.collection('accounts').insertOne({
        _id: accountId, user_id: userId, account_number: accountNumber, balance, currency: 'USD', updated_at: new Date(),
      });
    }
    return {
      userId: String(userId),
      accountId,
      accountNumber,
      email: `user${n}-${userId}@test.local`,
      token: token(userId, role),
    };
  }

  const balanceOf = async (accountId) => (await db.collection('accounts').findOne({ _id: accountId })).balance;
  const countTxns = (accountId, type) => db.collection('transactions').countDocuments({ account_id: accountId, ...(type ? { type } : {}) });

  async function stop() {
    await conn.dropDatabase().catch(() => undefined);
    await conn.close().catch(() => undefined);
    child.kill();
  }

  return { base, db, token, request, makeUser, balanceOf, countTxns, stop, sleep, dbName, ObjectId };
}

module.exports = { startApp, sleep, hasMongo: Boolean(BASE_URI), SKIP_REASON: 'set TEST_MONGO_URI (e.g. mongodb://127.0.0.1:27017) to run the API tests' };
