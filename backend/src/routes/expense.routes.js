import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  create,
  list,
  getOne,
  correct,
  remove,
  reverse,
} from '../controllers/expense.controller.js';

const router = Router();

router.use(requireAuth);

router.post('/', create);
router.get('/', list);
router.get('/:id', getOne);
router.patch('/:id', correct);
router.delete('/:id', remove);
router.post('/:id/reverse', reverse);

export default router;
