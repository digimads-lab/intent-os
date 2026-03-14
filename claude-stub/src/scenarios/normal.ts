import { Request, Response } from 'express';
import { StubConfig } from '../types';
import { writeSSEEvent, sleep, setSSEHeaders, generateMessageId } from '../sse/formatter';

const PLAN_RESULT = {
  pages: [
    {
      name: 'DataCleaningPage',
      description: '数据清洗主页面',
      components: [
        {
          type: 'FileUpload',
          id: 'fileInput',
          label: '选择 CSV 文件',
          accept: '.csv',
        },
        {
          type: 'Table',
          id: 'dataTable',
          columns: ['column1', 'column2', 'column3'],
          dataBinding: 'cleanedData',
        },
        {
          type: 'Button',
          id: 'cleanBtn',
          label: '开始清洗',
          action: 'callSkill:dataCleaningSkill.clean',
        },
      ],
    },
  ],
  skillBindings: [
    {
      skillId: 'dataCleaningSkill',
      methods: ['clean', 'export'],
      permissions: ['fs:read', 'fs:write'],
    },
  ],
  interactions: [
    {
      trigger: 'fileInput.onChange',
      action: 'parseCSV',
      updateState: 'rawData',
    },
    {
      trigger: 'cleanBtn.click',
      action: 'callSkill:dataCleaningSkill.clean',
      params: { data: 'rawData' },
      updateState: 'cleanedData',
    },
  ],
};

const PLANNING_DELTAS = [
  '分析用户意图...',
  '识别核心功能需求...',
  '设计应用布局...',
  '规划组件结构...',
  '确定技术依赖...',
  '生成交互逻辑...',
  '验证设计方案...',
  JSON.stringify(PLAN_RESULT),
];

export async function handleNormal(req: Request, res: Response, config: StubConfig): Promise<void> {
  const messageId = generateMessageId();
  const delay = config.latency;

  // Apply error rate
  if (config.errorRate > 0 && Math.random() < config.errorRate) {
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Random error injected by stub error rate configuration.',
      },
    });
    return;
  }

  setSSEHeaders(res);

  // message_start
  writeSSEEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-opus-4-6',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1024, output_tokens: 0 },
    },
  });

  await sleep(delay);

  // content_block_start
  writeSSEEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });

  await sleep(delay);

  // content_block_deltas
  for (const text of PLANNING_DELTAS) {
    writeSSEEvent(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    });
    await sleep(delay);
  }

  // content_block_stop
  writeSSEEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  });

  await sleep(delay);

  // message_delta
  writeSSEEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 2048 },
  });

  await sleep(delay);

  // message_stop
  writeSSEEvent(res, 'message_stop', {
    type: 'message_stop',
  });

  res.end();
}
