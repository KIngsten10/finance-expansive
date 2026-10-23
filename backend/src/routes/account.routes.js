import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  list,
  create,
  getOne,
  transactions,
  update,
  deactivate,
} from '../controllers/account.controller.js';

const router = Router();

// All bank-account endpoints require authentication.
router.use(requireAuth);

router.get('/', list);
router.post('/', create);
router.get('/:id', getOne);
router.get('/:id/transactions', transactions);
router.patch('/:id', update);
router.delete('/:id', deactivate);

export default router;
