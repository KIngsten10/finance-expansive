import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  summary,
  transactions,
  list,
  create,
  getOne,
  update,
  purchase,
  sale,
  income,
  fee,
  valuation,
  reverse,
} from '../controllers/investment.controller.js';

const router = Router();

router.use(requireAuth);

// Static routes before parameterized ":id".
router.get('/summary', summary);
router.get('/transactions', transactions);
router.post('/transactions/:txnId/reverse', reverse);

router.get('/', list);
router.post('/', create);

router.get('/:id', getOne);
router.patch('/:id', update);
router.post('/:id/purchase', purchase);
router.post('/:id/sale', sale);
router.post('/:id/income', income);
router.post('/:id/fee', fee);
router.post('/:id/valuation', valuation);

export default router;
