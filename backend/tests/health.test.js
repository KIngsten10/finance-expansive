import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';

/**
 * Integration test for the health endpoint. Boots an in-memory MongoDB so the
 * test is hermetic and requires no external services.
 */
describe('GET /api/health', () => {
  let mongod;
  let app;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectDatabase(mongod.getUri());
    app = createApp();
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongod?.stop();
  });

  it('returns a healthy status envelope', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.database.state).toBe('connected');
  });

  it('returns a 404 envelope for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not found/i);
  });
});
