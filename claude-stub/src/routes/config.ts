import { Router, Request, Response } from 'express';
import { globalState } from '../state';
import { isValidScenario } from '../scenarios';

const router = Router();

router.post('/stub/config', (req: Request, res: Response): void => {
  const { scenario, latency, errorRate, requestTimeout } = req.body as {
    scenario?: string;
    latency?: number;
    errorRate?: number;
    requestTimeout?: number;
  };

  if (scenario !== undefined && !isValidScenario(scenario)) {
    res.status(400).json({
      success: false,
      error: `无效的场景名称：${scenario}`,
    });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (scenario !== undefined) updates.scenario = scenario;
  if (latency !== undefined) updates.latency = latency;
  if (errorRate !== undefined) updates.errorRate = errorRate;
  if (requestTimeout !== undefined) updates.requestTimeout = requestTimeout;

  globalState.updateConfig(updates as Parameters<typeof globalState.updateConfig>[0]);

  res.json({
    success: true,
    message: '配置已更新',
    config: globalState.config,
  });
});

export default router;
