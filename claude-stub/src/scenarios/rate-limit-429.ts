import { Request, Response } from 'express';
import { StubConfig } from '../types';

export function handleRateLimit429(_req: Request, res: Response, _config: StubConfig): void {
  res.setHeader('Retry-After', '60');
  res.status(429).json({
    type: 'error',
    error: {
      type: 'rate_limit_error',
      message: 'Rate limit exceeded. Please retry after 60 seconds.',
    },
  });
}
