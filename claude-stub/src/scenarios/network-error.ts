import { Request, Response } from 'express';
import { StubConfig } from '../types';
import { setSSEHeaders, writeSSEEvent } from '../sse/formatter';

export function handleNetworkError(_req: Request, res: Response, _config: StubConfig): void {
  setSSEHeaders(res);

  // Write one event to establish the connection, then destroy the socket
  writeSSEEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_network_error',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-opus-4-6',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  // Immediately destroy the socket to simulate network disconnect
  res.socket?.destroy();
}
