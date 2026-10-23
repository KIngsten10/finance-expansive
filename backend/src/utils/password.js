import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

/** Hash a plaintext password. Never log the input. */
export async function hashPassword(plain) {
  return bcrypt.hash(plain, env.bcryptSaltRounds);
}

/** Compare a plaintext password against a stored hash. */
export async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}
