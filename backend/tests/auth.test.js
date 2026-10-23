import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { User } from '../src/models/User.js';
import { env } from '../src/config/env.js';

/**
 * Integration tests for the authentication module. Uses an in-memory MongoDB
 * so each run is hermetic and isolated. The users collection is cleared after
 * every test to keep test data independent.
 */
describe('Auth API', () => {
  let mongod;
  let app;

  const validUser = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'StrongPassword123!',
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectDatabase(mongod.getUri());
    app = createApp();
  });

  afterEach(async () => {
    await User.deleteMany({});
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongod?.stop();
  });

  const registerValid = () => request(app).post('/api/auth/register').send(validUser);

  // 1. Successful registration
  it('registers a new user and returns a safe user object', async () => {
    const res = await registerValid();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.user.name).toBe('Test User');
    expect(res.body.data.user.currency).toBe('INR');
    // Never leak secrets.
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('rejects weak passwords and invalid email with field details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'weak' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.details)).toBe(true);
    const fields = res.body.details.map((d) => d.field);
    expect(fields).toContain('name');
    expect(fields).toContain('email');
    expect(fields).toContain('password');
  });

  // 2. Duplicate email registration
  it('rejects duplicate email registration with 409', async () => {
    await registerValid();
    const res = await registerValid();
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it('normalizes email to lowercase', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validUser, email: 'MixedCase@Example.COM' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('mixedcase@example.com');
  });

  // 3. Password hashing
  it('stores a bcrypt hash, never the plaintext password', async () => {
    await registerValid();
    const stored = await User.findOne({ email: validUser.email }).select('+passwordHash');
    expect(stored.passwordHash).toBeDefined();
    expect(stored.passwordHash).not.toBe(validUser.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
  });

  // 4. Successful login
  it('logs in with valid credentials and returns a JWT', async () => {
    await registerValid();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.email).toBe(validUser.email);
    expect(res.body.data.user.passwordHash).toBeUndefined();

    // Token subject must be the user id.
    const decoded = jwt.verify(res.body.data.token, env.jwtSecret);
    const user = await User.findOne({ email: validUser.email });
    expect(decoded.sub).toBe(user._id.toString());
  });

  // 5. Invalid login credentials
  it('rejects wrong password with a generic 401', async () => {
    await registerValid();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: 'WrongPassword123!' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid email or password/i);
  });

  it('uses the same generic error for unknown email (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'StrongPassword123!' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid email or password/i);
  });

  // 6. Missing authentication token
  it('rejects /me without a token (401)', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/authentication required/i);
  });

  // 7. Invalid JWT
  it('rejects /me with a malformed/invalid token (401)', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid or expired token/i);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({}, 'a-different-secret', { subject: '507f1f77bcf86cd799439011' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  // 8. Expired JWT
  it('rejects an expired token (401)', async () => {
    await registerValid();
    const user = await User.findOne({ email: validUser.email });
    const expired = jwt.sign({}, env.jwtSecret, {
      subject: user._id.toString(),
      expiresIn: -10, // already expired
    });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid or expired token/i);
  });

  // 9. Successful authenticated profile request
  it('returns the authenticated profile for a valid token', async () => {
    await registerValid();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    const token = login.body.data.token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(validUser.email);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  // 10. Inactive / deleted user access
  it('rejects login for an inactive account (403)', async () => {
    await registerValid();
    await User.updateOne({ email: validUser.email }, { isActive: false });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/inactive/i);
  });

  it('rejects /me when the user was deactivated after issuing the token', async () => {
    await registerValid();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    const token = login.body.data.token;

    await User.updateOne({ email: validUser.email }, { isActive: false });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects /me when the user was deleted after issuing the token', async () => {
    await registerValid();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    const token = login.body.data.token;

    await User.deleteMany({});
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // 11. Logout behavior
  it('responds 200 to logout (stateless token discard)', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // Mass-assignment guard
  it('ignores attempts to set privileged fields during registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validUser, isActive: false, currency: 'USD', passwordHash: 'injected' });
    expect(res.status).toBe(201);
    // Privileged fields must fall back to server defaults.
    expect(res.body.data.user.isActive).toBe(true);
    expect(res.body.data.user.currency).toBe('INR');
    const stored = await User.findOne({ email: validUser.email }).select('+passwordHash');
    expect(stored.passwordHash).not.toBe('injected');
  });
});
