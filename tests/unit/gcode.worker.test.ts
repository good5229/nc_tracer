import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGcode } from '../../src/parser/gcode';
import type { MotionSegment } from '../../src/parser/gcode';

describe('gcode worker transferables', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('transfers aligned line positions and arc vertices with the parse response', async () => {
    const postMessage = vi.fn();
    const workerScope = { postMessage, onmessage: undefined as unknown };
    vi.stubGlobal('self', workerScope);
    const { packSegmentPositions } = await import('../../src/workers/gcode.worker');

    const handler = workerScope.onmessage as (event: { data: { type: string; text: string; options: { initialPosition: { x: number; y: number; z: number } } } }) => void;
    handler({
      data: {
        type: 'parse',
        text: 'G21 G90 G01 X1 Y0 Z0\nG17 G03 X0 Y1 I-1 J0',
        options: { initialPosition: { x: 0, y: 0, z: 0 } },
      },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [response, transfers] = postMessage.mock.calls[0];
    const [line, arc] = response.result.segments;
    expect(response.positions).toBeInstanceOf(Float32Array);
    expect(Array.from(response.positions)).toEqual([
      0, 0, 0, 1, 0, 0,
      1, 0, 0, 0, 1, 0,
    ]);
    expect(packSegmentPositions(response.result.segments)).toEqual(response.positions);
    expect(arc.vertices).toBeInstanceOf(Float64Array);
    expect(Array.from(transfers)).toEqual([response.positions.buffer, arc.vertices.buffer]);
    expect(line.vertices).toBeUndefined();
  });

  it('returns and transfers an empty position buffer when there are no segments', async () => {
    const postMessage = vi.fn();
    const workerScope = { postMessage, onmessage: undefined as unknown };
    vi.stubGlobal('self', workerScope);
    await import('../../src/workers/gcode.worker');
    const handler = workerScope.onmessage as (event: { data: { type: string; text: string } }) => void;
    handler({ data: { type: 'parse', text: '' } });

    const [response, transfers] = postMessage.mock.calls[0];
    expect(response.result.segments).toHaveLength(0);
    expect(response.positions).toBeInstanceOf(Float32Array);
    expect(response.positions).toHaveLength(0);
    expect(Array.from(transfers)).toEqual([response.positions.buffer]);
  });

  it('packs 100,000 ordered source segments into one finite transferable buffer', async () => {
    const postMessage = vi.fn();
    const workerScope = { postMessage, onmessage: undefined as unknown };
    vi.stubGlobal('self', workerScope);
    await import('../../src/workers/gcode.worker');
    const handler = workerScope.onmessage as (event: { data: { type: string; text: string; options: { initialPosition: { x: number; y: number; z: number } } } }) => void;
    const text = Array.from({ length: 100_000 }, (_, index) => `G21 G90 G01 X${index + 1} Y0 Z0`).join('\n');
    handler({ data: { type: 'parse', text, options: { initialPosition: { x: 0, y: 0, z: 0 } } } });

    const [response, transfers] = postMessage.mock.calls[0];
    expect(response.result.segments).toHaveLength(100_000);
    expect(response.positions).toBeInstanceOf(Float32Array);
    expect(response.positions).toHaveLength(600_000);
    expect(response.positions[0]).toBe(0);
    expect(response.positions[3]).toBe(1);
    expect(response.positions[response.positions.length - 6]).toBe(99_999);
    expect(response.positions[response.positions.length - 3]).toBe(100_000);
    expect(Array.from(response.positions).every(Number.isFinite)).toBe(true);
    expect(Array.from(transfers)).toEqual([response.positions.buffer]);
  });

  it('throws when parser output contains invalid coordinates instead of inventing a path', async () => {
    const postMessage = vi.fn();
    const workerScope = { postMessage, onmessage: undefined as unknown };
    vi.stubGlobal('self', workerScope);
    const { packSegmentPositions } = await import('../../src/workers/gcode.worker');
    const base = parseGcode('G21 G90 G01 X1 Y2 Z3', { initialPosition: { x: 0, y: 0, z: 0 } }).segments[0];
    const malformed = { ...base, end: { x: Infinity, y: null, z: 3 } } as MotionSegment;
    expect(() => packSegmentPositions([malformed])).toThrow(RangeError);
  });
});
