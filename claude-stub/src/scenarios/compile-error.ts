import { Request, Response } from 'express';
import { StubConfig } from '../types';
import { writeSSEEvent, sleep, setSSEHeaders, generateMessageId } from '../sse/formatter';

export async function handleCompileError(
  _req: Request,
  res: Response,
  config: StubConfig,
): Promise<void> {
  const messageId = generateMessageId();
  const delay = config.latency;

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
      usage: { input_tokens: 512, output_tokens: 0 },
    },
  });

  await sleep(delay);

  // Tool use block 1: write_file with buggy code
  writeSSEEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id: 'tool_use_1', name: 'write_file' },
  });

  await sleep(delay);

  writeSSEEvent(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'input_json_delta',
      partial_json: JSON.stringify({
        path: '/app/src/MainPage.tsx',
        content: 'const badVar: number = "oops"; // TS2322 error\nexport default function MainPage() { return <div>{badVar}</div>; }',
      }),
    },
  });

  await sleep(delay);

  writeSSEEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  });

  await sleep(delay);

  // Tool use block 2: run_command tsc (fails)
  writeSSEEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 'tool_use_2', name: 'run_command' },
  });

  await sleep(delay);

  writeSSEEvent(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 1,
    delta: {
      type: 'input_json_delta',
      partial_json: JSON.stringify({
        command: 'tsc --noEmit',
        output:
          "src/MainPage.tsx(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      }),
    },
  });

  await sleep(delay);

  writeSSEEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 1,
  });

  await sleep(delay);

  // Tool use block 3: write_file with fixed code
  writeSSEEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'tool_use', id: 'tool_use_3', name: 'write_file' },
  });

  await sleep(delay);

  writeSSEEvent(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 2,
    delta: {
      type: 'input_json_delta',
      partial_json: JSON.stringify({
        path: '/app/src/MainPage.tsx',
        content:
          'const goodVar: number = 42; // fixed\nexport default function MainPage() { return <div>{goodVar}</div>; }',
      }),
    },
  });

  await sleep(delay);

  writeSSEEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 2,
  });

  await sleep(delay);

  // Tool use block 4: run_command tsc (succeeds)
  writeSSEEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index: 3,
    content_block: { type: 'tool_use', id: 'tool_use_4', name: 'run_command' },
  });

  await sleep(delay);

  writeSSEEvent(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 3,
    delta: {
      type: 'input_json_delta',
      partial_json: JSON.stringify({
        command: 'tsc --noEmit',
        output: '',
      }),
    },
  });

  await sleep(delay);

  writeSSEEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 3,
  });

  await sleep(delay);

  // message_delta
  writeSSEEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1024 },
  });

  await sleep(delay);

  // message_stop
  writeSSEEvent(res, 'message_stop', {
    type: 'message_stop',
  });

  res.end();
}
