import { Router, Request, Response } from 'express';
import { globalState } from '../state';
import { isValidScenario } from '../scenarios';

const router = Router();

router.post('/stub/scenario', (req: Request, res: Response): void => {
  const { scenario } = req.body as { scenario?: string };

  if (!scenario) {
    res.status(400).json({
      success: false,
      error: '缺少必填字段：scenario',
    });
    return;
  }

  if (!isValidScenario(scenario)) {
    res.status(400).json({
      success: false,
      error: `无效的场景名称：${scenario}`,
    });
    return;
  }

  globalState.setScenario(scenario);

  res.json({
    success: true,
    message: `已切换到场景：${scenario}`,
    scenario,
  });
});

export default router;
