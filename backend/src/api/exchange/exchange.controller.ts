import { Request, Response } from 'express';
import ExchangesRepository from '../../repositories/ExchangesRepository';
import { handleError } from '../../utils/api';

/**
 * GET /api/v1/exchange/:slug
 */
export const getExchangeBySlug = async (req: Request, res: Response): Promise<void> => {
  try {
    const slug = req.params.slug.toLowerCase();

    const allExchanges = await ExchangesRepository.$getExchanges();
    const match = allExchanges.find(ex =>
      ex.name.toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '') === slug
    );

    if (!match) {
      handleError(req, res, 404, 'Exchange not found');
      return;
    }

    res.header('Pragma', 'public');
    res.header('Cache-control', 'public');
    res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
    res.json(match);
  } catch (e) {
    handleError(req, res, 500, 'Failed to fetch exchange info');
  }
};


/**
 * GET /api/v1/exchanges
 */
export const getAllExchanges = async (req: Request, res: Response): Promise<void> => {
  try {
    const allExchanges = await ExchangesRepository.$getExchanges();

    res.header('Pragma', 'public');
    res.header('Cache-control', 'public');
    res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
    res.json(allExchanges);
  } catch (e) {
    handleError(req, res, 500, 'Failed to fetch exchanges list');
  }
};
