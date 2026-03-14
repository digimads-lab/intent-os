import { Router, Request, Response } from 'express';
import { globalState } from '../state';
import { runScenario } from '../scenarios';

const router = Router();

router.post('/v1/messages', async (req: Request, res: Response): Promise<void> => {
  const config = globalState.config;
  const scenario = config.scenario;

  try {
    await runScenario(scenario, req, res, config);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: `Stub internal error: ${String(err)}`,
        },
      });
    }
  }
});

export default router;
