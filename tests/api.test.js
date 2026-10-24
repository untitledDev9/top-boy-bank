'use strict';
// Integration tests: the real server against a real MongoDB.
//   TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startApp, hasMongo, SKIP_REASON, sleep } = require('./helpers');

const waitFor = async (fn, { timeout = 6000, step = 100 } = {}) => {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(step);
  }
};

describe('API', { skip: hasMongo ? false : SKIP_REASON }, () => {
  let app;
  let admin;
  let groq;
  let groqMode = 'ok'; // ok | error | hang
  const groqSockets = new Set();

  const transferBody = (to, amount, extra = {}) => ({ recipient_id: to.accountNumber, amount, transaction_pin: '1234', ...extra });

  before(async () => {
    // Stand-in for the AI provider so chat tests never touch the network.
    groq = http.createServer((req, res) => {
      req.resume();
      if (groqMode === 'hang') return;
      if (groqMode === 'error') {
        res.writeHead(500);
        return res.end('boom');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Hello from the stub model' } }] }));
    });
    groq.on('connection', (s) => {
      groqSockets.add(s);
      s.on('close', () => groqSockets.delete(s));
    });
    await new Promise((r) => groq.listen(0, '127.0.0.1', r));

    app = await startApp({ GROQ_URL: `http://127.0.0.1:${groq.address().port}/`, GROQ_TIMEOUT_MS: '700' });
    admin = await app.makeUser({ role: 'admin', pin: null, name: 'Test Admin' });
  });

  after(async () => {
    await app.stop();
    groqSockets.forEach((s) => s.destroy());
    groq.close();
  });

  describe('authentication', () => {
    it('rejects missing, malformed and mid-login tokens', async () => {
      const none = await app.request('GET', '/api/customer/me');
      assert.equal(none.status, 401);
      assert.equal(none.body.message, 'Not authorized. Please log in.');

      const bad = await app.request('GET', '/api/customer/me', { token: 'not-a-jwt' });
      assert.equal(bad.status, 401);
      assert.equal(bad.body.message, 'Invalid or expired token.');

      const jwt = require('jsonwebtoken');
      const u = await app.makeUser();
      const midLogin = jwt.sign({ id: u.userId, role: 'customer', otp_pending: true }, 'test-secret');
      const r = await app.request('GET', '/api/customer/me', { token: midLogin });
      assert.equal(r.status, 401);
      assert.match(r.body.message, /Login not completed/);
    });

    it('rejects a token whose user no longer exists', async () => {
      const jwt = require('jsonwebtoken');
      const ghost = jwt.sign({ id: String(new app.ObjectId()), role: 'customer' }, 'test-secret');
      const r = await app.request('GET', '/api/customer/me', { token: ghost });
      assert.equal(r.status, 401);
      assert.equal(r.body.message, 'User no longer exists.');
    });
  });

  describe('/auth/me and /customer/me', () => {
    it('returns the profile, masked account number, PIN flag and maintenance state', async () => {
      const u = await app.makeUser({ balance: 42.5 });
      const r = await app.request('GET', '/api/auth/me', { token: u.token });
      assert.equal(r.status, 200);
      assert.equal(r.body.user._id, u.userId);
      assert.equal(r.body.user.has_transaction_pin, true);
      assert.equal(r.body.account.balance, 42.5);
      assert.equal(r.body.account.masked_number, '****' + u.accountNumber.slice(-4));
      assert.equal(r.body.maintenance_mode, false);
      assert.equal(typeof r.body.maintenance_message, 'string');
      // secrets must never be serialised
      for (const field of ['password', 'plain_password', 'transaction_pin', 'ssn', 'otp_code']) {
        assert.equal(field in r.body.user, false, `${field} leaked`);
      }
    });

    it('reports has_transaction_pin=false for a user with no PIN', async () => {
      const u = await app.makeUser({ pin: null });
      const r = await app.request('GET', '/api/auth/me', { token: u.token });
      assert.equal(r.body.user.has_transaction_pin, false);
      const c = await app.request('GET', '/api/customer/me', { token: u.token });
      assert.equal(c.body.user.has_transaction_pin, false);
    });

    it('/customer/me matches /auth/me for the account fields', async () => {
      const u = await app.makeUser({ balance: 10 });
      const a = await app.request('GET', '/api/auth/me', { token: u.token });
      const c = await app.request('GET', '/api/customer/me', { token: u.token });
      assert.deepEqual(c.body.account, a.body.account);
      assert.equal(c.body.user.has_transaction_pin, true);
    });

    it('an admin has no account', async () => {
      const r = await app.request('GET', '/api/auth/me', { token: admin.token });
      assert.equal(r.status, 200);
      assert.equal(r.body.account, null);
    });
  });

  describe('lookup-account', () => {
    it('returns the recipient full name (not a masked one) and currency', async () => {
      const me = await app.makeUser();
      const to = await app.makeUser({ name: 'Chidera Nwosu' });
      const byNumber = await app.request('GET', `/api/customer/lookup-account/${to.accountNumber}`, { token: me.token });
      assert.equal(byNumber.status, 200);
      assert.deepEqual(byNumber.body, { success: true, name: 'Chidera Nwosu', currency: 'USD' });
      const byEmail = await app.request('GET', `/api/customer/lookup-account/${encodeURIComponent(to.email)}`, { token: me.token });
      assert.equal(byEmail.body.name, 'Chidera Nwosu');
    });

    it('404s for unknown and for inactive accounts', async () => {
      const me = await app.makeUser();
      const inactive = await app.makeUser({ active: false });
      for (const id of ['0000000000', inactive.accountNumber, encodeURIComponent(inactive.email), 'nobody@nowhere.test']) {
        const r = await app.request('GET', `/api/customer/lookup-account/${id}`, { token: me.token });
        assert.equal(r.status, 404, id);
        assert.equal(r.body.message, 'Account not found.');
      }
    });
  });

  describe('transfer', () => {
    it('moves the money, writes both ledger entries and returns the new balance', async () => {
      const from = await app.makeUser({ balance: 500 });
      const to = await app.makeUser({ balance: 25, name: 'Recipient One' });
      const r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(to, 120.5, { description: 'rent' }) });
      assert.equal(r.status, 200);
      assert.equal(r.body.success, true);
      assert.equal(r.body.balance, 379.5);
      assert.equal(r.body.recipient_name, 'Recipient One');
      assert.equal(r.body.transaction.type, 'debit');
      assert.equal(r.body.transaction.amount, 120.5);
      assert.equal(r.body.transaction.balance_after, 379.5);
      assert.equal(r.body.transaction.description, `Transfer to ${to.accountNumber} — rent`);
      assert.equal(await app.balanceOf(from.accountId), 379.5);
      assert.equal(await app.balanceOf(to.accountId), 145.5);
      const credit = await app.db.collection('transactions').findOne({ account_id: to.accountId, type: 'credit' });
      assert.equal(credit.balance_after, 145.5);
      assert.equal(credit.description, `Transfer from ${from.accountNumber} — rent`);
    });

    it('accepts an email as the recipient and defaults the description', async () => {
      const from = await app.makeUser({ balance: 50 });
      const to = await app.makeUser();
      const r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: { recipient_id: to.email, amount: 5, transaction_pin: '1234' } });
      assert.equal(r.status, 200);
      assert.equal(r.body.transaction.description, `Transfer to ${to.accountNumber} — Transfer`);
    });

    it('treats a numeric string amount as a number', async () => {
      const from = await app.makeUser({ balance: 100 });
      const to = await app.makeUser();
      const r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(to, '10') });
      assert.equal(r.status, 200);
      assert.equal(await app.balanceOf(from.accountId), 90);
      assert.equal(await app.balanceOf(to.accountId), 10);
    });

    it('rejects invalid input without touching any balance', async () => {
      const from = await app.makeUser({ balance: 100 });
      const to = await app.makeUser({ balance: 7 });
      for (const body of [
        transferBody(to, 'abc'),
        transferBody(to, 0),
        transferBody(to, -5),
        transferBody(to, null),
        { amount: 5, transaction_pin: '1234' },
      ]) {
        const r = await app.request('POST', '/api/customer/transfer', { token: from.token, body });
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.equal(r.body.message, 'Valid recipient and amount are required.');
      }
      assert.equal(await app.balanceOf(from.accountId), 100);
      assert.equal(await app.balanceOf(to.accountId), 7);
    });

    it('cannot be tricked with an operator object in place of the recipient id', async () => {
      const from = await app.makeUser({ balance: 100 });
      const to = await app.makeUser({ balance: 7 });
      for (const recipient_id of [{ $ne: '' }, { $gt: '' }, ['a', 'b'], 12345]) {
        const r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: { recipient_id, amount: 5, transaction_pin: '1234' } });
        assert.ok([400, 404].includes(r.status), `${JSON.stringify(recipient_id)} -> ${r.status}`);
      }
      assert.equal(await app.balanceOf(from.accountId), 100);
      assert.equal(await app.balanceOf(to.accountId), 7);
    });

    it('keeps its error responses: insufficient funds, PIN, own account, unknown/inactive recipient, unverified sender', async () => {
      const from = await app.makeUser({ balance: 5 });
      const to = await app.makeUser();

      let r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(to, 10) });
      assert.equal(r.status, 400);
      assert.equal(r.body.message, 'Insufficient balance.');

      r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: { recipient_id: to.accountNumber, amount: 1 } });
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'PIN_REQUIRED');

      r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(to, 1, { transaction_pin: '9999' }) });
      assert.equal(r.status, 403);
      assert.equal(r.body.code, 'INVALID_PIN');

      r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(from, 1) });
      assert.equal(r.status, 400);
      assert.equal(r.body.message, 'Cannot transfer to your own account.');

      r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: { recipient_id: '0000000000', amount: 1, transaction_pin: '1234' } });
      assert.equal(r.status, 404);
      assert.equal(r.body.message, 'Recipient account not found.');

      r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: { recipient_id: 'ghost@nowhere.test', amount: 1, transaction_pin: '1234' } });
      assert.equal(r.status, 404);
      assert.equal(r.body.message, 'Recipient not found.');

      const inactive = await app.makeUser({ active: false });
      r = await app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(inactive, 1) });
      assert.equal(r.status, 400);
      assert.equal(r.body.message, 'Recipient account is not active.');

      const unverified = await app.makeUser({ balance: 100, verified: false });
      r = await app.request('POST', '/api/customer/transfer', { token: unverified.token, body: transferBody(to, 1) });
      assert.equal(r.status, 403);
      assert.equal(r.body.code, 'ACCOUNT_RESTRICTED');
      assert.equal(r.body.reason, 'unverified');

      assert.equal(await app.balanceOf(from.accountId), 5, 'no failed attempt may move money');
    });

    it('never spends more than the balance when requests overlap', async () => {
      const from = await app.makeUser({ balance: 100 });
      const to = await app.makeUser({ balance: 0 });
      const results = await Promise.all(
        Array.from({ length: 20 }, () => app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(to, 10) }))
      );
      const ok = results.filter((r) => r.status === 200);
      assert.equal(ok.length, 10, 'exactly 10 x $10 fit in $100');
      for (const r of results.filter((x) => x.status !== 200)) {
        assert.equal(r.status, 400);
        assert.equal(r.body.message, 'Insufficient balance.');
      }
      assert.equal(await app.balanceOf(from.accountId), 0);
      assert.equal(await app.balanceOf(to.accountId), 100);
      assert.equal(await app.countTxns(from.accountId, 'debit'), 10);
      assert.equal(await app.countTxns(to.accountId, 'credit'), 10);
    });

    it('loses no updates when overlapping transfers all fit', async () => {
      const from = await app.makeUser({ balance: 1000 });
      const to = await app.makeUser({ balance: 0 });
      const results = await Promise.all(
        Array.from({ length: 20 }, () => app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(to, 10) }))
      );
      assert.ok(results.every((r) => r.status === 200));
      assert.equal(await app.balanceOf(from.accountId), 800);
      assert.equal(await app.balanceOf(to.accountId), 200);
      assert.equal(await app.countTxns(from.accountId, 'debit'), 20);
      assert.equal(await app.countTxns(to.accountId, 'credit'), 20);
    });

    it('credits every incoming transfer when many senders pay one account at once', async () => {
      const to = await app.makeUser({ balance: 0 });
      const senders = await Promise.all(Array.from({ length: 5 }, () => app.makeUser({ balance: 100 })));
      const calls = senders.flatMap((s) => Array.from({ length: 4 }, () => app.request('POST', '/api/customer/transfer', { token: s.token, body: transferBody(to, 10) })));
      const results = await Promise.all(calls);
      assert.ok(results.every((r) => r.status === 200));
      assert.equal(await app.balanceOf(to.accountId), 200);
      for (const s of senders) assert.equal(await app.balanceOf(s.accountId), 60);
    });

    it('records balance_after values that match the account history even under overlap', async () => {
      const from = await app.makeUser({ balance: 100 });
      const to = await app.makeUser({ balance: 0 });
      await Promise.all(Array.from({ length: 10 }, () => app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(to, 10) })));
      const debits = await app.db.collection('transactions').find({ account_id: from.accountId, type: 'debit' }).toArray();
      const afters = debits.map((d) => d.balance_after).sort((a, b) => b - a);
      assert.deepEqual(afters, [90, 80, 70, 60, 50, 40, 30, 20, 10, 0]);
    });
  });

  describe('withdraw', () => {
    const bank = (amount, extra = {}) => ({
      amount, method: 'bank', bank_name: 'Test Bank', account_number: '123456789', routing_number: '123456789', transaction_pin: '1234', ...extra,
    });

    it('debits the account, records the ledger entry and the payout request', async () => {
      const u = await app.makeUser({ balance: 100 });
      const r = await app.request('POST', '/api/customer/withdraw', { token: u.token, body: bank(30) });
      assert.equal(r.status, 200);
      assert.equal(r.body.balance, 70);
      assert.equal(r.body.fee, 0);
      assert.equal(r.body.total_debited, 30);
      assert.equal(r.body.transaction.description, 'Withdrawal to Test Bank account ending 6789');
      assert.equal(await app.balanceOf(u.accountId), 70);
      assert.equal(await app.db.collection('withdrawals').countDocuments({ account_id: u.accountId }), 1);
    });

    it('charges the 1.5% fee on card withdrawals', async () => {
      const u = await app.makeUser({ balance: 200 });
      const r = await app.request('POST', '/api/customer/withdraw', {
        token: u.token,
        body: { amount: 100, method: 'card', card_number: '4242424242424242', card_expiry: '12/30', card_name: 'Test User', transaction_pin: '1234' },
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.fee, 1.5);
      assert.equal(r.body.total_debited, 101.5);
      assert.equal(r.body.balance, 98.5);
    });

    it('treats a numeric string amount as a number (not string concatenation)', async () => {
      const u = await app.makeUser({ balance: 100 });
      const r = await app.request('POST', '/api/customer/withdraw', { token: u.token, body: bank('30') });
      assert.equal(r.status, 200);
      assert.equal(r.body.total_debited, 30);
      assert.equal(await app.balanceOf(u.accountId), 70);
    });

    it('rejects an overdraft and a wrong PIN without moving money', async () => {
      const u = await app.makeUser({ balance: 10 });
      let r = await app.request('POST', '/api/customer/withdraw', { token: u.token, body: bank(50) });
      assert.equal(r.status, 400);
      assert.equal(r.body.message, 'Insufficient balance.');
      r = await app.request('POST', '/api/customer/withdraw', { token: u.token, body: bank(5, { transaction_pin: '0000' }) });
      assert.equal(r.status, 403);
      assert.equal(r.body.code, 'INVALID_PIN');
      assert.equal(await app.balanceOf(u.accountId), 10);
    });

    it('never overdraws when withdrawals overlap', async () => {
      const u = await app.makeUser({ balance: 100 });
      const results = await Promise.all(Array.from({ length: 10 }, () => app.request('POST', '/api/customer/withdraw', { token: u.token, body: bank(20) })));
      assert.equal(results.filter((r) => r.status === 200).length, 5);
      assert.equal(await app.balanceOf(u.accountId), 0);
      assert.equal(await app.countTxns(u.accountId, 'debit'), 5);
      assert.equal(await app.db.collection('withdrawals').countDocuments({ account_id: u.accountId }), 5);
    });
  });

  describe('transactions list', () => {
    let u;
    let other;

    before(async () => {
      u = await app.makeUser({ balance: 1000 });
      other = await app.makeUser({ balance: 1 });
      const base = Date.now();
      const rows = [];
      for (let i = 0; i < 27; i++) {
        rows.push({
          account_id: u.accountId, type: i % 3 === 0 ? 'credit' : 'debit', amount: 10 + i, balance_after: 1000,
          description: i === 5 ? 'Store (A+)' : i === 6 ? 'a.b' : i === 7 ? 'aXb' : i === 8 ? 'Coffee Shop' : `Item ${i}`,
          created_at: new Date(base - i * 3600_000), created_by: null,
        });
      }
      rows.push({ account_id: u.accountId, type: 'adjustment', amount: 1, balance_after: 1000, description: 'Admin Adjustment', created_at: new Date(base), created_by: null });
      rows.push({ account_id: other.accountId, type: 'credit', amount: 999, balance_after: 1, description: 'Someone else', created_at: new Date(base), created_by: null });
      await app.db.collection('transactions').insertMany(rows);
    });

    it('paginates newest-first and hides admin adjustments', async () => {
      const r = await app.request('GET', '/api/customer/transactions', { token: u.token });
      assert.equal(r.status, 200);
      assert.equal(r.body.pagination.total, 27);
      assert.equal(r.body.pagination.pages, 2);
      assert.equal(r.body.transactions.length, 20);
      const times = r.body.transactions.map((t) => new Date(t.created_at).getTime());
      assert.deepEqual(times, [...times].sort((a, b) => b - a));
      assert.ok(r.body.transactions.every((t) => t.type !== 'adjustment'));
      const page2 = await app.request('GET', '/api/customer/transactions?page=2', { token: u.token });
      assert.equal(page2.body.transactions.length, 7);
    });

    it('never returns another account’s transactions', async () => {
      const r = await app.request('GET', '/api/customer/transactions?limit=100', { token: other.token });
      assert.equal(r.body.pagination.total, 1);
      assert.equal(r.body.transactions[0].description, 'Someone else');
    });

    it('clamps and sanitises paging parameters', async () => {
      const big = await app.request('GET', '/api/customer/transactions?limit=100000', { token: u.token });
      assert.equal(big.body.pagination.limit, 100);
      for (const q of ['limit=abc', 'limit=0', 'limit=-3']) {
        const r = await app.request('GET', `/api/customer/transactions?${q}`, { token: u.token });
        assert.equal(r.status, 200, q);
        assert.ok(r.body.pagination.limit >= 1 && r.body.pagination.limit <= 100, q);
      }
      for (const q of ['page=abc', 'page=-5', 'page=0']) {
        const r = await app.request('GET', `/api/customer/transactions?${q}`, { token: u.token });
        assert.equal(r.status, 200, q);
        assert.equal(r.body.pagination.page, 1, q);
      }
    });

    it('filters by type', async () => {
      const r = await app.request('GET', '/api/customer/transactions?type=credit&limit=100', { token: u.token });
      assert.equal(r.body.pagination.total, 9);
      assert.ok(r.body.transactions.every((t) => t.type === 'credit'));
    });

    it('searches case-insensitively, matching the text literally (not as a regex)', async () => {
      const ci = await app.request('GET', '/api/customer/transactions?search=coffee', { token: u.token });
      assert.equal(ci.body.pagination.total, 1);

      const parens = await app.request('GET', `/api/customer/transactions?search=${encodeURIComponent('Store (A+)')}`, { token: u.token });
      assert.equal(parens.status, 200);
      assert.equal(parens.body.pagination.total, 1);

      const dot = await app.request('GET', '/api/customer/transactions?search=a.b', { token: u.token });
      assert.deepEqual(dot.body.transactions.map((t) => t.description), ['a.b'], '"." must not match any character');

      const wildcard = await app.request('GET', `/api/customer/transactions?search=${encodeURIComponent('.*')}`, { token: u.token });
      assert.equal(wildcard.body.pagination.total, 0, '".*" is text, not "match everything"');

      const malformed = await app.request('GET', `/api/customer/transactions?search=${encodeURIComponent('([')}`, { token: u.token });
      assert.equal(malformed.status, 200, 'a malformed pattern must not cause a server error');
    });

    it('filters by date range and rejects invalid dates', async () => {
      const recent = new Date(Date.now() - 5 * 3600_000).toISOString();
      const r = await app.request('GET', `/api/customer/transactions?limit=100&start_date=${encodeURIComponent(recent)}`, { token: u.token });
      assert.equal(r.status, 200);
      assert.ok(r.body.pagination.total > 0 && r.body.pagination.total < 27);
      const bad = await app.request('GET', '/api/customer/transactions?start_date=not-a-date', { token: u.token });
      assert.equal(bad.status, 400);
    });
  });

  describe('cached lookups are invalidated by the actions that change them', () => {
    it('deactivating a user locks them out on the very next request, and reactivating restores access', async () => {
      const u = await app.makeUser({ balance: 10 });
      assert.equal((await app.request('GET', '/api/customer/me', { token: u.token })).status, 200); // primes the cache

      const off = await app.request('PATCH', `/api/admin/users/${u.userId}/deactivate`, { token: admin.token });
      assert.equal(off.status, 200);
      assert.equal(off.body.is_active, false);
      const blocked = await app.request('GET', '/api/customer/me', { token: u.token });
      assert.equal(blocked.status, 401);
      assert.equal(blocked.body.message, 'Account has been deactivated.');

      await app.request('PATCH', `/api/admin/users/${u.userId}/deactivate`, { token: admin.token });
      assert.equal((await app.request('GET', '/api/customer/me', { token: u.token })).status, 200);
    });

    it('deleting a user invalidates their session immediately', async () => {
      const u = await app.makeUser({ balance: 10 });
      assert.equal((await app.request('GET', '/api/customer/me', { token: u.token })).status, 200);
      const del = await app.request('DELETE', `/api/admin/users/${u.userId}`, { token: admin.token });
      assert.equal(del.status, 200);
      const r = await app.request('GET', '/api/customer/me', { token: u.token });
      assert.equal(r.status, 401);
      assert.equal(r.body.message, 'User no longer exists.');
    });

    it('verifying a user is reflected straight away', async () => {
      const u = await app.makeUser({ balance: 10, verified: false });
      assert.equal((await app.request('GET', '/api/auth/me', { token: u.token })).body.user.is_verified, false);
      const v = await app.request('PATCH', `/api/admin/users/${u.userId}/verify`, { token: admin.token });
      assert.equal(v.body.is_verified, true);
      assert.equal((await app.request('GET', '/api/auth/me', { token: u.token })).body.user.is_verified, true);
    });

    it('a profile update shows up immediately', async () => {
      const u = await app.makeUser({ balance: 10, name: 'Old Name' });
      assert.equal((await app.request('GET', '/api/auth/me', { token: u.token })).body.user.full_name, 'Old Name');
      const p = await app.request('PATCH', '/api/customer/profile', { token: u.token, body: { full_name: 'New Name' } });
      assert.equal(p.status, 200);
      assert.equal((await app.request('GET', '/api/auth/me', { token: u.token })).body.user.full_name, 'New Name');
    });

    it('maintenance mode blocks transfers and withdrawals the moment an admin enables it', async () => {
      const from = await app.makeUser({ balance: 100 });
      const to = await app.makeUser();
      assert.equal((await app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(to, 1) })).status, 200);

      const on = await app.request('PATCH', '/api/admin/maintenance', { token: admin.token, body: { enabled: true, message: 'Down for upgrade' } });
      assert.equal(on.status, 200);

      const t = await app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(to, 1) });
      assert.equal(t.status, 403);
      assert.equal(t.body.reason, 'maintenance');
      assert.equal(t.body.message, 'Down for upgrade');
      const w = await app.request('POST', '/api/customer/withdraw', {
        token: from.token,
        body: { amount: 1, method: 'bank', bank_name: 'B', account_number: '123456789', routing_number: '123456789', transaction_pin: '1234' },
      });
      assert.equal(w.status, 403);
      const me = await app.request('GET', '/api/auth/me', { token: from.token });
      assert.equal(me.body.maintenance_mode, true);
      assert.equal(me.body.maintenance_message, 'Down for upgrade');

      await app.request('PATCH', '/api/admin/maintenance', { token: admin.token, body: { enabled: false } });
      assert.equal((await app.request('POST', '/api/customer/transfer', { token: from.token, body: transferBody(to, 1) })).status, 200);
      assert.equal((await app.request('GET', '/api/auth/me', { token: from.token })).body.maintenance_mode, false);
    });
  });

  describe('admin endpoints', () => {
    it('requires an admin', async () => {
      const u = await app.makeUser();
      assert.equal((await app.request('GET', '/api/admin/users', { token: u.token })).status, 403);
      assert.equal((await app.request('GET', '/api/admin/analytics', { token: u.token })).status, 403);
    });

    it('analytics counts customers, verified and active users, and sums balances', async () => {
      const r = await app.request('GET', '/api/admin/analytics', { token: admin.token });
      assert.equal(r.status, 200);
      const [customers, verified, active, balances] = await Promise.all([
        app.db.collection('users').countDocuments({ role: 'customer' }),
        app.db.collection('users').countDocuments({ role: 'customer', is_verified: true }),
        app.db.collection('users').countDocuments({ role: 'customer', is_active: true }),
        app.db.collection('accounts').aggregate([{ $group: { _id: null, t: { $sum: '$balance' } } }]).toArray(),
      ]);
      assert.equal(r.body.analytics.total_users, customers);
      assert.equal(r.body.analytics.verified_users, verified);
      assert.equal(r.body.analytics.active_users, active);
      assert.equal(r.body.analytics.total_balance, balances[0].t);
      assert.ok(r.body.analytics.recent_transactions.length <= 10);
      assert.ok(Array.isArray(r.body.analytics.recent_audit_logs));
    });

    it('user list: literal search, bounded page size, defaults', async () => {
      await app.makeUser({ name: 'Zed (Test)+Star' });
      const lit = await app.request('GET', `/api/admin/users?search=${encodeURIComponent('Zed (Test)+Star')}`, { token: admin.token });
      assert.equal(lit.status, 200);
      assert.equal(lit.body.users.length, 1);
      assert.ok('account' in lit.body.users[0]);

      const bad = await app.request('GET', `/api/admin/users?search=${encodeURIComponent('([')}`, { token: admin.token });
      assert.equal(bad.status, 200);

      const huge = await app.request('GET', '/api/admin/users?limit=99999', { token: admin.token });
      assert.equal(huge.body.pagination.limit, 200);
      const two = await app.request('GET', '/api/admin/users?limit=200', { token: admin.token });
      assert.equal(two.body.pagination.limit, 200, 'the admin history page asks for 200');
      const dflt = await app.request('GET', '/api/admin/users?page=abc&limit=abc', { token: admin.token });
      assert.equal(dflt.body.pagination.page, 1);
      assert.equal(dflt.body.pagination.limit, 20);
    });

    it('admin credit/debit changes the balance atomically and records history', async () => {
      const u = await app.makeUser({ balance: 100 });
      const credit = await app.request('POST', `/api/admin/users/${u.userId}/transactions`, { token: admin.token, body: { type: 'credit', amount: 50, description: 'bonus' } });
      assert.equal(credit.status, 201);
      assert.equal(credit.body.account.balance, 150);
      assert.equal(credit.body.transaction.balance_after, 150);

      const debit = await app.request('POST', `/api/admin/users/${u.userId}/transactions`, { token: admin.token, body: { type: 'debit', amount: '20' } });
      assert.equal(debit.status, 201);
      assert.equal(debit.body.account.balance, 130, 'a string amount is added numerically, never concatenated');

      const over = await app.request('POST', `/api/admin/users/${u.userId}/transactions`, { token: admin.token, body: { type: 'debit', amount: 5000 } });
      assert.equal(over.status, 400);
      assert.equal(over.body.message, 'Insufficient balance for this debit.');
      assert.equal(await app.balanceOf(u.accountId), 130);
    });

    it('admin debits cannot overdraw even when they overlap', async () => {
      const u = await app.makeUser({ balance: 100 });
      const results = await Promise.all(
        Array.from({ length: 10 }, () => app.request('POST', `/api/admin/users/${u.userId}/transactions`, { token: admin.token, body: { type: 'debit', amount: 30 } }))
      );
      assert.equal(results.filter((r) => r.status === 201).length, 3);
      assert.equal(await app.balanceOf(u.accountId), 10);
    });
  });

  describe('chat', () => {
    const seedChat = async (customer, messages = 5, status = 'ai') => {
      const _id = new app.ObjectId();
      await app.db.collection('chats').insertOne({
        _id, customer_id: new app.ObjectId(customer.userId), customer_name: 'Chat Customer', status, admin_id: null,
        messages: Array.from({ length: messages }, (_, i) => ({ sender: i % 2 ? 'ai' : 'customer', text: `m${i}`, created_at: new Date(Date.now() - (messages - i) * 1000) })),
        created_at: new Date(), updated_at: new Date(), expires_at: new Date(Date.now() + 86400000),
      });
      return String(_id);
    };

    it('the customer poll returns the full history and only to its owner', async () => {
      const c = await app.makeUser();
      const other = await app.makeUser();
      const id = await seedChat(c, 5);
      const r = await app.request('GET', `/api/chat/${id}`, { token: c.token });
      assert.equal(r.status, 200);
      assert.equal(r.body.chat.messages.length, 5);
      assert.equal(r.body.chat.messages[4].text, 'm4');
      assert.equal(r.body.chat.status, 'ai');
      assert.equal((await app.request('GET', `/api/chat/${id}`, { token: other.token })).status, 404);
    });

    it('the admin list sends only the last message of each open chat, and skips closed chats', async () => {
      const c = await app.makeUser();
      const open = await seedChat(c, 6, 'ai');
      const closed = await seedChat(c, 3, 'closed');
      const r = await app.request('GET', '/api/admin/chats', { token: admin.token });
      assert.equal(r.status, 200);
      const row = r.body.chats.find((x) => x._id === open);
      assert.ok(row, 'open chat listed');
      assert.equal(row.lastMessage.text, 'm5');
      assert.equal('messages' in row, false, 'full history must not be shipped on every poll');
      assert.equal(r.body.chats.some((x) => x._id === closed), false);
    });

    it('start creates a chat once and resumes it afterwards', async () => {
      const c = await app.makeUser();
      const a = await app.request('POST', '/api/chat/start', { token: c.token });
      const b = await app.request('POST', '/api/chat/start', { token: c.token });
      assert.equal(a.status, 200);
      assert.equal(a.body.chat._id, b.body.chat._id);
      assert.equal(a.body.chat.messages.length, 1);
    });

    it('answers a customer message immediately and appends the AI reply afterwards', async () => {
      groqMode = 'ok';
      const c = await app.makeUser();
      const id = await seedChat(c, 1);
      const started = Date.now();
      const post = await app.request('POST', `/api/chat/${id}/message`, { token: c.token, body: { text: 'hello?' } });
      assert.equal(post.status, 200);
      assert.deepEqual(post.body, { success: true });
      assert.ok(Date.now() - started < 600, 'must not wait for the AI');
      const chat = await waitFor(async () => {
        const r = await app.request('GET', `/api/chat/${id}`, { token: c.token });
        return r.body.chat.messages.length >= 3 ? r.body.chat : null;
      });
      assert.equal(chat.messages[1].sender, 'customer');
      assert.equal(chat.messages[1].text, 'hello?');
      assert.equal(chat.messages[2].sender, 'ai');
      assert.equal(chat.messages[2].text, 'Hello from the stub model');
    });

    it('falls back to the canned reply when the AI provider errors', async () => {
      groqMode = 'error';
      const c = await app.makeUser();
      const id = await seedChat(c, 1);
      await app.request('POST', `/api/chat/${id}/message`, { token: c.token, body: { text: 'help' } });
      const chat = await waitFor(async () => {
        const r = await app.request('GET', `/api/chat/${id}`, { token: c.token });
        return r.body.chat.messages.length >= 3 ? r.body.chat : null;
      });
      assert.match(chat.messages[2].text, /support team will review it/);
    });

    it('falls back (instead of hanging forever) when the AI provider never answers', async () => {
      groqMode = 'hang';
      const c = await app.makeUser();
      const id = await seedChat(c, 1);
      await app.request('POST', `/api/chat/${id}/message`, { token: c.token, body: { text: 'anyone there?' } });
      const chat = await waitFor(async () => {
        const r = await app.request('GET', `/api/chat/${id}`, { token: c.token });
        return r.body.chat.messages.length >= 3 ? r.body.chat : null;
      }, { timeout: 8000 });
      assert.match(chat.messages[2].text, /support team will review it/);
    });

    it('does not append an AI reply to a chat an admin took over in the meantime', async () => {
      groqMode = 'hang';
      const c = await app.makeUser();
      const id = await seedChat(c, 1);
      await app.request('POST', `/api/chat/${id}/message`, { token: c.token, body: { text: 'need a human' } });
      const take = await app.request('POST', `/api/admin/chats/${id}/takeover`, { token: admin.token });
      assert.equal(take.status, 200);
      await sleep(1600); // longer than GROQ_TIMEOUT_MS: the fallback would have been written by now
      const r = await app.request('GET', `/api/chat/${id}`, { token: c.token });
      const texts = r.body.chat.messages.map((m) => m.text);
      assert.equal(r.body.chat.status, 'admin');
      assert.equal(texts.some((t) => /support team will review it/.test(t)), false);
      assert.equal(texts[texts.length - 1], 'You are now connected with a live support agent. How can we assist you?');
    });
  });

  // The auth routes are rate limited to 10 requests/minute per IP, so this block
  // deliberately uses only 8 of them. Keep that in mind before adding more.
  describe('login flow', () => {
    it('login -> OTP -> PIN issues a working session token', async () => {
      const u = await app.makeUser({ balance: 10, password: 'Correct-Horse-1' });

      const login = await app.request('POST', '/api/auth/login', { body: { email: u.email, password: 'Correct-Horse-1' } });
      assert.equal(login.status, 200);
      assert.equal(login.body.otp_required, true);
      assert.equal(typeof login.body.otp_token, 'string');

      const stored = await app.db.collection('users').findOne({ _id: new app.ObjectId(u.userId) });
      assert.match(stored.otp_code, /^\d{6}$/);

      const otp = await app.request('POST', '/api/auth/verify-otp', { body: { otp_token: login.body.otp_token, otp: stored.otp_code } });
      assert.equal(otp.status, 200);
      assert.equal(otp.body.pin_required, true);

      const pin = await app.request('POST', '/api/auth/verify-pin', { body: { pin_token: otp.body.pin_token, pin: '1234' } });
      assert.equal(pin.status, 200);
      assert.equal(typeof pin.body.token, 'string');
      assert.equal('password' in pin.body.user, false);

      const me = await app.request('GET', '/api/auth/me', { token: pin.body.token });
      assert.equal(me.status, 200);
      assert.equal(me.body.user._id, u.userId);
    });

    it('rejects a wrong password and counts the attempt', async () => {
      const u = await app.makeUser({ password: 'Correct-Horse-1' });
      const r = await app.request('POST', '/api/auth/login', { body: { email: u.email, password: 'wrong-password' } });
      assert.equal(r.status, 401);
      assert.equal(r.body.message, 'Invalid email or password.');
      const stored = await app.db.collection('users').findOne({ _id: new app.ObjectId(u.userId) });
      assert.equal(stored.login_attempts, 1);
    });

    it('locks the account after repeated failures, even for the right password', async () => {
      const u = await app.makeUser({ password: 'Correct-Horse-1' });
      await app.db.collection('users').updateOne({ _id: new app.ObjectId(u.userId) }, { $set: { login_attempts: 4 } });
      const fifth = await app.request('POST', '/api/auth/login', { body: { email: u.email, password: 'nope' } });
      assert.equal(fifth.status, 401);
      const locked = await app.request('POST', '/api/auth/login', { body: { email: u.email, password: 'Correct-Horse-1' } });
      assert.equal(locked.status, 423);
      assert.match(locked.body.message, /temporarily locked/);
    });

    it('admin login returns a token only for admins with the right password', async () => {
      const a = await app.makeUser({ role: 'admin', pin: null, password: 'Admin-Pass-9' });
      const bad = await app.request('POST', '/api/auth/admin/login', { body: { email: a.email, password: 'nope' } });
      assert.equal(bad.status, 401);
      const ok = await app.request('POST', '/api/auth/admin/login', { body: { email: a.email, password: 'Admin-Pass-9' } });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.user.role, 'admin');
      assert.equal(typeof ok.body.token, 'string');
    });
  });


  describe('platform behaviour', () => {
    it('health reports ok while the database is connected', async () => {
      const r = await app.request('GET', '/api/health');
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { status: 'ok' });
    });

    it('caps request bodies instead of buffering 15 MB before authenticating', async () => {
      const big = JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(300 * 1024) });
      const r = await app.request('POST', '/api/auth/login', { body: big });
      assert.equal(r.status, 413);
    });

    it('compresses large JSON responses for clients that accept gzip, and only for them', async () => {
      const u = await app.makeUser({ balance: 1 });
      const rows = Array.from({ length: 100 }, (_, i) => ({
        account_id: u.accountId, type: 'debit', amount: 5, balance_after: 1, description: `Compressible description number ${i}`, created_at: new Date(Date.now() - i * 1000), created_by: null,
      }));
      await app.db.collection('transactions').insertMany(rows);
      const gz = await app.request('GET', '/api/customer/transactions?limit=100', { token: u.token, headers: { 'accept-encoding': 'gzip' } });
      assert.equal(gz.headers.get('content-encoding'), 'gzip');
      assert.equal(gz.body.transactions.length, 100);
      const plain = await app.request('GET', '/api/customer/transactions?limit=100', { token: u.token, headers: { 'accept-encoding': 'identity' } });
      assert.equal(plain.headers.get('content-encoding'), null);
    });
  });
});
