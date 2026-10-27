import { parseGcode, type ParserOptions } from '../parser/gcode';

export type GcodeWorkerRequest = { type: 'parse'; text: string; options?: ParserOptions };
export type GcodeWorkerResponse = { type: 'result'; result: ReturnType<typeof parseGcode> };

self.onmessage = (event: MessageEvent<GcodeWorkerRequest>) => {
  if (event.data?.type !== 'parse' || typeof event.data.text !== 'string') return;
  const response: GcodeWorkerResponse = {
    type: 'result',
    result: parseGcode(event.data.text, event.data.options),
  };
  self.postMessage(response);
};
