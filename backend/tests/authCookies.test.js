import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { startReplSet, stopReplSet, clearDatabase } from './helpers/replset.js';
import { User } from '../src/models/User.js';
import { env } from '../src/config/env.js';

// (User is imported for the expired-cookie test which signs a token for a real user.)

/**
 * Cookie-based authentication + CSRF tests. Uses supertest's agent to persist
 * cookies across requests, exercising the real browser-like flow. A replica set
 * is used because some assertions create bank accounts (a financial write that
 * requires multi-document transactions).
 */
describe('Cookie-based auth + CSRF', () => {
  let replset;
  let app;

  const creds = { name: 'Cookie User', email: 'cookie@example.com', password: 'StrongPassword123!' };

  beforeAll(async () => {
    replset = await startReplSet();
    app = createApp();
  });
  afterEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await stopReplSet(replset);
  });

  it('login sets an HttpOnly auth cookie and a readable CSRF cookie', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: creds.password });
    expect(res.status).toBe(200);

    const setCookies = res.headers['set-cookie'];
    const authCookie = setCookies.find((c) => c.startsWith(`${env.authCookieName}=`));
    const csrfCookie = setCookies.find((c) => c.startsWith(`${env.csrfCookieName}=`));

    expect(authCookie).toBeTruthy();
    expect(authCookie).toMatch(/HttpOnly/i); // not readable by JS
    expect(authCookie).toMatch(/SameSite/i);

    expect(csrfCookie).toBeTruthy();
    expect(csrfCookie).not.toMatch(/HttpOnly/i); // SPA must read it
  });

  it('register establishes a session (sets cookies) and returns the user', async () => {
    const res = await request(app).post('/api/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(creds.email);
    const authCookie = (res.headers['set-cookie'] || []).find((c) =>
      c.startsWith(`${env.authCookieName}=`)
    );
    expect(authCookie).toMatch(/HttpOnly/i);
  });

  it('authenticates /me via the cookie alone (no Authorization header)', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(creds);
    // agent retains cookies; no bearer header sent.
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(creds.email);
  });

  it('rejects /me with an invalid auth cookie (401)', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${env.authCookieName}=not.a.valid.jwt`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid or expired token/i);
  });

  it('rejects /me with an expired auth cookie (401)', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const user = await User.findOne({ email: creds.email });
    const expired = jwt.sign({}, env.jwtSecret, {
      subject: user._id.toString(),
      expiresIn: -10,
    });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${env.authCookieName}=${expired}`);
    expect(res.status).toBe(401);
  });

  it('logout clears both auth cookies', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/auth/register').send(creds);
    // Logout is a state-changing request on a cookie session, so it carries the
    // CSRF token like any other mutation.
    const res = await agent
      .post('/api/auth/logout')
      .set('X-CSRF-Token', reg.body.data.csrfToken)
      .send({});
    expect(res.status).toBe(200);
    const cleared = res.headers['set-cookie'] || [];
    const authCleared = cleared.find((c) => c.startsWith(`${env.authCookieName}=`));
    expect(authCleared).toBeTruthy();
    // A cleared cookie has an empty value / past expiry.
    expect(authCleared).toMatch(new RegExp(`${env.authCookieName}=;`));

    // After logout the session no longer authenticates.
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  describe('CSRF protection (double-submit cookie)', () => {
    it('rejects a cookie-session state-changing request with no CSRF header (403)', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send(creds);
      // Create a bank account WITHOUT the X-CSRF-Token header — must be blocked.
      const res = await agent.post('/api/bank-accounts').send({
        bankName: 'HDFC',
        accountName: 'Salary',
        openingBalance: 1000,
      });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/csrf/i);
    });

    it('rejects a mismatched CSRF header (403)', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send(creds);
      const res = await agent
        .post('/api/bank-accounts')
        .set('X-CSRF-Token', 'wrong-value')
        .send({ bankName: 'HDFC', accountName: 'Salary', openingBalance: 1000 });
      expect(res.status).toBe(403);
    });

    it('accepts a state-changing request when the CSRF header matches the cookie', async () => {
      const agent = request.agent(app);
      const reg = await agent.post('/api/auth/register').send(creds);
      const csrf = reg.body.data.csrfToken;
      expect(csrf).toBeTruthy();
      const res = await agent
        .post('/api/bank-accounts')
        .set('X-CSRF-Token', csrf)
        .send({ bankName: 'HDFC', accountName: 'Salary', openingBalance: 1000 });
      expect(res.status).toBe(201);
      expect(res.body.data.account.currentBalance).toBe(1000);
    });

    it('does not require CSRF for GET (safe) requests', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send(creds);
      const res = await agent.get('/api/bank-accounts'); // no CSRF header
      expect(res.status).toBe(200);
    });

    it('exempts pure bearer-token clients from CSRF (no auth cookie present)', async () => {
      // Register to get a bearer token, then call with ONLY the Authorization
      // header (fresh request, no cookies) — CSRF must not block it.
      const reg = await request(app).post('/api/auth/register').send(creds);
      const token = reg.body.data.token;
      const res = await request(app)
        .post('/api/bank-accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({ bankName: 'HDFC', accountName: 'Salary', openingBalance: 1000 });
      expect(res.status).toBe(201);
    });
  });

  describe('JWT algorithm pinning (regression)', () => {
    it('rejects a token with alg:none', async () => {
      await request(app).post('/api/auth/register').send(creds);
      const user = await User.findOne({ email: creds.email });
      // Craft an unsigned alg:none token.
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(
        JSON.stringify({ sub: user._id.toString(), iat: Math.floor(Date.now() / 1000) })
      ).toString('base64url');
      const noneToken = `${header}.${body}.`;
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `${env.authCookieName}=${noneToken}`);
      expect(res.status).toBe(401);
    });

    it('accepts a correctly HS256-signed token (sanity)', async () => {
      await request(app).post('/api/auth/register').send(creds);
      const user = await User.findOne({ email: creds.email });
      const good = jwt.sign({}, env.jwtSecret, {
        algorithm: 'HS256',
        subject: user._id.toString(),
        expiresIn: '1h',
      });
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `${env.authCookieName}=${good}`);
      expect(res.status).toBe(200);
    });
  });

  describe('signed CSRF — cookie injection resistance (regression)', () => {
    it('rejects a forged/unsigned CSRF token even when cookie and header match', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send(creds);
      // Simulate an attacker-injected csrf_token cookie whose value they also
      // put in the header. It matches, but it is NOT server-signed.
      const forged = 'attacker-chosen-value';
      const res = await agent
        .post('/api/bank-accounts')
        .set('Cookie', `${env.csrfCookieName}=${forged}`)
        .set('X-CSRF-Token', forged)
        .send({ bankName: 'HDFC', accountName: 'Salary', openingBalance: 1000 });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/csrf/i);
    });

    it('rejects a token with a valid-looking nonce but wrong signature', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send(creds);
      const bad = `${'a'.repeat(64)}.${'b'.repeat(64)}`;
      const res = await agent
        .post('/api/bank-accounts')
        .set('Cookie', `${env.csrfCookieName}=${bad}`)
        .set('X-CSRF-Token', bad)
        .send({ bankName: 'HDFC', accountName: 'Salary', openingBalance: 1000 });
      expect(res.status).toBe(403);
    });

    it('rejects an empty CSRF token', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send(creds);
      const res = await agent
        .post('/api/bank-accounts')
        .set('X-CSRF-Token', '')
        .send({ bankName: 'HDFC', accountName: 'Salary', openingBalance: 1000 });
      expect(res.status).toBe(403);
    });

    it('still accepts the genuine server-issued signed CSRF token', async () => {
      const agent = request.agent(app);
      const reg = await agent.post('/api/auth/register').send(creds);
      const res = await agent
        .post('/api/bank-accounts')
        .set('X-CSRF-Token', reg.body.data.csrfToken)
        .send({ bankName: 'HDFC', accountName: 'Salary', openingBalance: 1000 });
      expect(res.status).toBe(201);
    });
  });

  describe('auth entry points are CSRF-exempt (regression for login/register lockout)', () => {
    it('registers with NO CSRF header and no cookies (first-time user)', async () => {
      const res = await request(app).post('/api/auth/register').send(creds);
      expect(res.status).toBe(201);
    });

    it('registers/logs in even when a STALE auth cookie is present but no CSRF header', async () => {
      // Simulate a leftover/expired access_token cookie from a previous session
      // with no (or mismatched) CSRF token — this was the failing scenario.
      const staleCookie = `${env.authCookieName}=stale.jwt.value`;

      const reg = await request(app)
        .post('/api/auth/register')
        .set('Cookie', staleCookie)
        .send(creds);
      expect(reg.status).toBe(201);

      const login = await request(app)
        .post('/api/auth/login')
        .set('Cookie', staleCookie)
        .send({ email: creds.email, password: creds.password });
      expect(login.status).toBe(200);
      expect(login.body.data.csrfToken).toBeTruthy();
    });

    it('still protects non-auth state-changing endpoints (CSRF not globally disabled)', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send(creds);
      // No CSRF header on a protected financial write -> still blocked.
      const res = await agent
        .post('/api/bank-accounts')
        .send({ bankName: 'HDFC', accountName: 'Salary', openingBalance: 1000 });
      expect(res.status).toBe(403);
    });

    it('logout remains CSRF-protected (not exempt)', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send(creds);
      // Logout without the CSRF header is rejected (active session holds a token).
      const res = await agent.post('/api/auth/logout').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('token source precedence (regression)', () => {
    it('an invalid auth cookie does NOT fall back to a valid bearer token', async () => {
      // A valid bearer token exists, but the request also carries a broken auth
      // cookie. The cookie takes precedence and its failure must reject the
      // request — no silent downgrade to the bearer header.
      const reg = await request(app).post('/api/auth/register').send(creds);
      const validBearer = reg.body.data.token;
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `${env.authCookieName}=not.a.valid.jwt`)
        .set('Authorization', `Bearer ${validBearer}`);
      expect(res.status).toBe(401);
    });

    it('identity comes from the token, not a body-supplied userId', async () => {
      const agent = request.agent(app);
      const reg = await agent.post('/api/auth/register').send(creds);
      const me = await agent.get('/api/auth/me');
      const realId = me.body.data.user.id;
      // Attempt to override identity via the body on a protected write.
      const res = await agent
        .post('/api/bank-accounts')
        .set('X-CSRF-Token', reg.body.data.csrfToken)
        .send({
          userId: '507f1f77bcf86cd799439011',
          bankName: 'HDFC',
          accountName: 'Mine',
          openingBalance: 100,
        });
      expect(res.status).toBe(201);
      // The account is owned by the authenticated user, not the injected id.
      const list = await agent.get('/api/bank-accounts');
      expect(list.body.data.accounts).toHaveLength(1);
      // Confirm it belongs to the real user by fetching it back under their session.
      expect(realId).toBeTruthy();
    });
  });

  describe('cross-user isolation under cookie auth', () => {
    it('one user cannot read another user\'s account via their own cookie', async () => {
      // User A creates an account.
      const agentA = request.agent(app);
      const regA = await agentA.post('/api/auth/register').send(creds);
      const createdA = await agentA
        .post('/api/bank-accounts')
        .set('X-CSRF-Token', regA.body.data.csrfToken)
        .send({ bankName: 'HDFC', accountName: 'A', openingBalance: 5000 });
      const acctAId = createdA.body.data.account.id;

      // User B logs in with a separate cookie jar.
      const agentB = request.agent(app);
      await agentB
        .post('/api/auth/register')
        .send({ name: 'B', email: 'b@example.com', password: 'StrongPassword123!' });

      const res = await agentB.get(`/api/bank-accounts/${acctAId}`);
      expect(res.status).toBe(404); // not revealed to another user
    });
  });
});
