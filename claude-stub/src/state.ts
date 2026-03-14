import { StubConfig, DEFAULT_CONFIG } from './types';

class GlobalState {
  private _config: StubConfig = { ...DEFAULT_CONFIG };

  get config(): StubConfig {
    return { ...this._config };
  }

  updateConfig(partial: Partial<StubConfig>): void {
    this._config = { ...this._config, ...partial };
  }

  get currentScenario(): string {
    return this._config.scenario;
  }

  setScenario(scenario: string): void {
    this._config.scenario = scenario;
  }
}

export const globalState = new GlobalState();
