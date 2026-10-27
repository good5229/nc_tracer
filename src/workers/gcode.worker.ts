import { parseGcode, type MotionSegment, type ParserOptions } from '../parser/gcode';

export type GcodeWorkerRequest = { type: 'parse'; text: string; options?: ParserOptions };
export type GcodeWorkerResponse = { type: 'result'; result: ReturnType<typeof parseGcode>; positions: Float32Array };

const finitePoint = (point: MotionSegment['start']) =>
  [point.x, point.y, point.z].every((value) => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(Math.fround(value)));

/** Packs each segment's start then end as xyz, failing if parser output violates its finite-coordinate invariant. */
export function packSegmentPositions(segments: MotionSegment[]): Float32Array {
  const positions = new Float32Array(segments.length * 6);
  segments.forEach((segment, index) => {
    if (!finitePoint(segment.start) || !finitePoint(segment.end)) {
      throw new RangeError(`Cannot pack invalid coordinates for segment ${index}`);
    }
    const { start, end } = segment;
    const offset = index * 6;
    positions[offset] = start.x!;
    positions[offset + 1] = start.y!;
    positions[offset + 2] = start.z!;
    positions[offset + 3] = end.x!;
    positions[offset + 4] = end.y!;
    positions[offset + 5] = end.z!;
  });
  return positions;
}

self.onmessage = (event: MessageEvent<GcodeWorkerRequest>) => {
  if (event.data?.type !== 'parse' || typeof event.data.text !== 'string') return;
  const result = parseGcode(event.data.text, event.data.options);
  const response: GcodeWorkerResponse = { type: 'result', result, positions: packSegmentPositions(result.segments) };
  const transfers = [response.positions.buffer, ...response.result.segments.flatMap((segment) =>
    segment.vertices ? [segment.vertices.buffer] : [],
  )];
  self.postMessage(response, transfers);
};
