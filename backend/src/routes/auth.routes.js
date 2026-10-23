import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, me, logout } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';

const router = Router();

/**
 * Stricter rate limit for credential endpoints to slow brute-force attempts.
 * Disabled in the test environment so the suite can exercise many logins.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.nodeEnv === 'test',
  message: { success: false, message: 'Too many attempts, please try again later' },
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/me', requireAuth, me);
router.post('/logout', logout);

export default router;
