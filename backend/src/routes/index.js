import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import accountRoutes from './account.routes.js';
import expenseRoutes from './expense.routes.js';
import transactionRoutes from './transaction.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import loanRoutes from './loan.routes.js';
import investmentRoutes from './investment.routes.js';

/** Root API router. */
const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/bank-accounts', accountRoutes);
router.use('/expenses', expenseRoutes);
router.use('/transactions', transactionRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/loans', loanRoutes);
router.use('/investments', investmentRoutes);

export default router;
