import express, { Express } from 'express';
import messagesRouter from './routes/messages';
import configRouter from './routes/config';
import scenarioRouter from './routes/scenario';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  // Routes
  app.use(messagesRouter);
  app.use(configRouter);
  app.use(scenarioRouter);

  // Health check
  app.get('/stub/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}
