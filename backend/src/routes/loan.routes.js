import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  calculateEmi,
  summary,
  upcomingPayments,
  list,
  create,
  getOne,
  update,
  adjustment,
  close,
  schedule,
  createPayment,
  listPayments,
  getPayment,
  reversePayment,
} from '../controllers/loan.controller.js';

const router = Router();

router.use(requireAuth);

// Static routes MUST precede the parameterized "/:id" routes.
router.post('/calculate-emi', calculateEmi);
router.get('/summary', summary);
router.get('/upcoming-payments', upcomingPayments);

router.get('/', list);
router.post('/', create);

router.get('/:id', getOne);
router.patch('/:id', update);
router.post('/:id/adjustment', adjustment);
router.post('/:id/close', close);
router.get('/:id/schedule', schedule);

router.post('/:id/payments', createPayment);
router.get('/:id/payments', listPayments);
router.get('/:id/payments/:paymentId', getPayment);
router.post('/:id/payments/:paymentId/reverse', reversePayment);

export default router;
