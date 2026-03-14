import { Request, Response } from 'express';
import { StubConfig } from '../types';
import { handleNormal } from './normal';
import { handleRateLimit429 } from './rate-limit-429';
import { handleNetworkError } from './network-error';
import { handleCompileError } from './compile-error';

const VALID_SCENARIOS = ['normal', 'rate-limit-429', 'network-error', 'compile-error'];

export function isValidScenario(name: string): boolean {
  return VALID_SCENARIOS.includes(name);
}

export function getValidScenarios(): string[] {
  return [...VALID_SCENARIOS];
}

export async function runScenario(
  scenarioName: string,
  req: Request,
  res: Response,
  config: StubConfig,
): Promise<void> {
  switch (scenarioName) {
    case 'normal':
      await handleNormal(req, res, config);
      break;
    case 'rate-limit-429':
      handleRateLimit429(req, res, config);
      break;
    case 'network-error':
      handleNetworkError(req, res, config);
      break;
    case 'compile-error':
      await handleCompileError(req, res, config);
      break;
    default:
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: `Unknown scenario: ${scenarioName}`,
        },
      });
  }
}
