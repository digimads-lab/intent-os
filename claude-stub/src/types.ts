export interface StubConfig {
  scenario: string;
  latency: number;
  errorRate: number;
  requestTimeout: number;
}

export interface StubState {
  config: StubConfig;
}

export const DEFAULT_CONFIG: StubConfig = {
  scenario: 'normal',
  latency: 200,
  errorRate: 0.0,
  requestTimeout: 30000,
};

export interface ScenarioHandler {
  name: string;
  handle(req: import('express').Request, res: import('express').Response, config: StubConfig): void;
}
