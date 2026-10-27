import { afterEach, describe, expect, it, vi } from 'vitest';

describe('gcode worker transferables', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('transfers each arc vertex buffer with the parse response', async () => {
    const postMessage = vi.fn();
    const workerScope = { postMessage, onmessage: undefined as unknown };
    vi.stubGlobal('self', workerScope);
    await import('../../src/workers/gcode.worker');

    const handler = workerScope.onmessage as (event: { data: { type: string; text: string; options: { initialPosition: { x: number; y: number; z: number } } } }) => void;
    handler({
      data: {
        type: 'parse',
        text: 'G21 G90 G17 G03 X0 Y1 I-1 J0',
        options: { initialPosition: { x: 1, y: 0, z: 0 } },
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [response, transfers] = postMessage.mock.calls[0];
    const vertices = response.result.segments[0].vertices as Float64Array;
    expect(vertices).toBeInstanceOf(Float64Array);
    expect(Array.from(transfers)).toEqual([vertices.buffer]);
  });
});
