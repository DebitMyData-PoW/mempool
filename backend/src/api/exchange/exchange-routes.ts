import { Router } from 'express';
import { getExchangeBySlug, getAllExchanges } from './exchange.controller';

const router = Router();

router.get('/', getAllExchanges);     // GET /api/v1/exchanges
router.get('/:slug', getExchangeBySlug); // GET /api/v1/exchange/NonKYC

export default router;
