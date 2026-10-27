import { describe, expect, it } from 'vitest';
import { parseGcode } from '../../src/parser/gcode';
import type { Vector3 } from '../../src/parser/gcode';

const origin = { x: 0, y: 0, z: 0 };
const vertexAt = (vertices: Float64Array, index: number): Vector3 => ({
  x: vertices[index * 3], y: vertices[index * 3 + 1], z: vertices[index * 3 + 2],
});

describe('parseGcode', () => {
  it('keeps startup modes and coordinates unknown until the program declares them', () => {
    const result = parseGcode('G21 G90 G00 X0 Y0 Z0\nG01 X10 Y20');
    expect(result.status).toBe('PARTIAL');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ sourceLine: 2, motion: 'G01', start: origin, end: { x: 10, y: 20, z: 0 } });
    expect(result.segments[0].rawCode).toBe('G01 X10 Y20');
  });

  it('interprets absolute moves and preserves omitted axes', () => {
    const result = parseGcode('G21 G90 G00 X0 Y0 Z0\nG01 X10 Y20\nY25', { initialPosition: origin });
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].end).toEqual({ x: 10, y: 20, z: 0 });
    expect(result.segments[1]).toMatchObject({ sourceLine: 3, start: { x: 10, y: 20, z: 0 }, end: { x: 10, y: 25, z: 0 } });
  });

  it('accumulates incremental moves from a known position', () => {
    const result = parseGcode('G21 G91 G01 X5 Y-2\nX2', { initialPosition: origin });
    expect(result.segments.map((segment) => segment.end)).toEqual([
      { x: 5, y: -2, z: 0 }, { x: 7, y: -2, z: 0 },
    ]);
  });

  it('converts inch coordinates to millimeters', () => {
    const result = parseGcode('G20 G90 G00 X0 Y0 Z0\nG01 X1', { initialPosition: origin });
    expect(result.segments[0].end.x).toBe(25.4);
  });

  it('converts modal feed to millimeters per minute and preserves S/T metadata', () => {
    const result = parseGcode('%\nG20 G90 G00 X0 Y0 Z0 F2 S1200 T3\nG01 X1', { initialPosition: origin });
    expect(result.status).toBe('SUPPORTED');
    expect(result.finalState).toMatchObject({ feed: 50.8, spindle: 1200, tool: 3 });
    expect(result.segments[0]).toMatchObject({ feed: 50.8, spindle: 1200, tool: 3, end: { x: 25.4, y: 0, z: 0 } });
  });

  it('rejects coordinate and feed overflow before producing a non-finite result', () => {
    const largeFinite = `9${'0'.repeat(306)}`;
    for (const input of [`G20 G90 G01 X${largeFinite}`, `G20 G90 G01 F${largeFinite} X1`]) {
      const result = parseGcode(input, { initialPosition: origin });
      expect(result.status).toBe('INVALID');
      expect(result.segments).toHaveLength(0);
      expect(result.finalState.position).toEqual({ x: null, y: null, z: null });
      expect(result.finalState).toMatchObject({ unit: null, distanceMode: null, motionMode: null, feed: null });
      expect(result.warnings[0].code).toBe('CALCULATION_OVERFLOW');
    }
  });

  it('rejects initial or computed positions that Three.js Float32 buffers cannot represent', () => {
    const invalidInitial = parseGcode('', { initialPosition: { x: 3.5e38, y: 0, z: 0 } });
    expect(invalidInitial.status).toBe('INVALID');
    expect(invalidInitial.finalState.position).toEqual({ x: null, y: null, z: null });

    const float32Overflow = `35${'0'.repeat(37)}`;
    const overflow = parseGcode(`G21 G90 G01 X${float32Overflow}`, { initialPosition: origin });
    expect(overflow.status).toBe('INVALID');
    expect(overflow.segments).toHaveLength(0);
    expect(overflow.warnings[0].code).toBe('CALCULATION_OVERFLOW');
  });

  it('does not draw a line from an unknown start, then recovers after an absolute full position', () => {
    const result = parseGcode('G21 G90 G01 X5\nX10 Y20 Z30\nX11', { initialPosition: { x: null, y: null, z: null } });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ sourceLine: 3, start: { x: 10, y: 20, z: 30 }, end: { x: 11, y: 20, z: 30 } });
    expect(result.status).toBe('PARTIAL');
  });

  it('retains source lines and repeated N block identifiers', () => {
    const result = parseGcode('N7 G21 G90 G00 X0 Y0 Z0\nN7 G01 X1 Y2 Z3', { initialPosition: origin });
    expect(result.segments[0]).toMatchObject({ sourceLine: 2, nBlock: '7', rawCode: 'N7 G01 X1 Y2 Z3' });
  });

  it('ignores parenthesis and semicolon comments while retaining exact source text', () => {
    const result = parseGcode('G21 (metric) G90 G00 X0 Y0 Z0 ; start\nG01 X1 Y2 Z3 (cut)', { initialPosition: origin });
    expect(result.segments[0].rawCode).toBe('G01 X1 Y2 Z3 (cut)');
  });

  it('stops at unsupported commands and preserves only earlier verified segments', () => {
    const result = parseGcode('G21 G90 G00 X0 Y0 Z0\nG01 X1 Y1 Z1\nG02 X2 Y2 I1 J0\nG01 X3 Y3 Z3', { initialPosition: origin });
    // Arc words without an explicit plane are outside the verified profile.
    expect(result.status).toBe('PARTIAL');
    expect(result.segments).toHaveLength(1);
    expect(result.warnings[0].sourceLine).toBe(3);
    expect(result.finalState.position).toEqual({ x: null, y: null, z: null });
  });

  it('tessellates a G17 quarter circle with independent midpoint and length expectations', () => {
    const result = parseGcode('G21 G90 G17 G03 X0 Y1 I-1 J0', { initialPosition: { x: 1, y: 0, z: 0 } });
    const arc = result.segments[0];
    expect(result.status).toBe('SUPPORTED');
    expect(result.segments).toHaveLength(1);
    expect(arc).toMatchObject({ motion: 'G03', start: { x: 1, y: 0, z: 0 }, end: { x: 0, y: 1, z: 0 }, rawCode: 'G21 G90 G17 G03 X0 Y1 I-1 J0' });
    expect(arc.vertices).toBeInstanceOf(Float64Array);
    expect(arc.vertices!.length % 3).toBe(0);
    const middle = vertexAt(arc.vertices!, Math.floor((arc.vertices!.length / 3 - 1) / 2));
    expect(middle.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(middle.y).toBeCloseTo(Math.SQRT1_2, 5);
    const pointCount = arc.vertices!.length / 3;
    let polylineLength = 0;
    for (let index = 1; index < pointCount; index += 1) {
      const point = vertexAt(arc.vertices!, index), previous = vertexAt(arc.vertices!, index - 1);
      polylineLength += Math.hypot(point.x! - previous.x!, point.y! - previous.y!, point.z! - previous.z!);
    }
    expect(polylineLength).toBeCloseTo(Math.PI / 2, 3);

    const clockwise = parseGcode('G21 G90 G17 G02 X-1 I-1 J0', { initialPosition: { x: 1, y: 0, z: 0 } }).segments[0];
    const cwMid = vertexAt(clockwise.vertices!, Math.floor((clockwise.vertices!.length / 3 - 1) / 2));
    expect(cwMid.x).toBeCloseTo(0, 5);
    expect(cwMid.y).toBeCloseTo(-1, 5);
  });

  it('uses right-handed G18/G19 plane coordinates for direction', () => {
    const g18 = parseGcode('G21 G90 G18 G03 X-1 I-1 K0', { initialPosition: { x: 1, y: 0, z: 0 } }).segments[0];
    const g19 = parseGcode('G21 G90 G19 G03 Y-1 J-1 K0', { initialPosition: { x: 0, y: 1, z: 0 } }).segments[0];
    const mid18 = vertexAt(g18.vertices!, Math.floor((g18.vertices!.length / 3 - 1) / 2));
    const mid19 = vertexAt(g19.vertices!, Math.floor((g19.vertices!.length / 3 - 1) / 2));
    expect(mid18.z).toBeCloseTo(-1, 5);
    expect(mid19.z).toBeCloseTo(1, 5);
  });

  it('supports full circles from IJK, but rejects full circles from R', () => {
    const full = parseGcode('G21 G90 G17 G03 I-1 J0', { initialPosition: { x: 1, y: 0, z: 0 } });
    expect(full.status).toBe('SUPPORTED');
    expect(full.segments).toHaveLength(1);
    expect(full.segments[0].vertices).toHaveLength(73 * 3);
    expect(vertexAt(full.segments[0].vertices!, 36).x).toBeCloseTo(-1, 5);
    expect(vertexAt(full.segments[0].vertices!, 36).y).toBeCloseTo(0, 5);
    const radius = parseGcode('G21 G90 G17 G03 R1', { initialPosition: { x: 1, y: 0, z: 0 } });
    expect(radius.status).toBe('INVALID');
    expect(radius.warnings[0].code).toBe('INVALID_ARC_GEOMETRY');
  });

  it('supports signed R minor/major arcs and keeps modal arc motion', () => {
    const minor = parseGcode('G21 G90 G17 G03 X0 Y1 R1\nX-1 Y0 R1', { initialPosition: { x: 1, y: 0, z: 0 } });
    const major = parseGcode('G21 G90 G17 G03 X0 Y1 R-1', { initialPosition: { x: 1, y: 0, z: 0 } });
    expect(minor.segments).toHaveLength(2);
    expect(minor.segments[1].motion).toBe('G03');
    const minorMid = vertexAt(minor.segments[0].vertices!, Math.floor((minor.segments[0].vertices!.length / 3 - 1) / 2));
    const majorMid = vertexAt(major.segments[0].vertices!, Math.floor((major.segments[0].vertices!.length / 3 - 1) / 2));
    expect(minorMid.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(majorMid.x).toBeCloseTo(1 + Math.SQRT1_2, 5);
    expect(majorMid.y).toBeCloseTo(1 + Math.SQRT1_2, 5);
  });

  it('keeps large-radius chord sagitta within 0.01 mm and stops when the vertex cap would be exceeded', () => {
    const large = parseGcode('G21 G90 G17 G03 X0 Y1000 I-1000 J0', { initialPosition: { x: 1000, y: 0, z: 0 } }).segments[0];
    let maxSagitta = 0;
    for (let i = 1; i < large.vertices!.length / 3; i += 1) {
      const a = vertexAt(large.vertices!, i - 1), b = vertexAt(large.vertices!, i);
      const midX = (a.x! + b.x!) / 2, midY = (a.y! + b.y!) / 2;
      maxSagitta = Math.max(maxSagitta, 1000 - Math.hypot(midX, midY));
    }
    expect(maxSagitta).toBeLessThanOrEqual(0.01 + 1e-9);

    const enormous = parseGcode('G21 G90 G17 G03 X0 Y1000000000000 I-1000000000000 J0', {
      initialPosition: { x: 1_000_000_000_000, y: 0, z: 0 },
    });
    expect(enormous.status).toBe('INVALID');
    expect(enormous.segments).toHaveLength(0);
    expect(enormous.warnings[0].code).toBe('ARC_TESSELLATION_LIMIT');
  });

  it('rejects missing plane, center mismatch, mixed R/IJK, and out-of-plane center words', () => {
    const inputs = [
      'G21 G90 G03 X0 Y1 I-1 J0',
      'G21 G90 G17 G03 X0 Y1 I-1 J-1',
      'G21 G90 G17 G03 X0 Y1 R1 I-1',
      'G21 G90 G17 G03 X0 Y1 I-1 J0 K2',
    ];
    for (const input of inputs) expect(parseGcode(input, { initialPosition: { x: 1, y: 0, z: 0 } }).status).not.toBe('SUPPORTED');
  });

  it('requires known arc start and keeps arc subdivision within one source motion', () => {
    const unknownStart = parseGcode('G21 G90 G17 G03 X0 Y1 I-1 J0');
    expect(unknownStart.status).toBe('UNSUPPORTED');
    expect(unknownStart.segments).toHaveLength(0);
    const result = parseGcode('N4 G21 G90 G17 G03 X0 Y1 I-1 J0', { initialPosition: { x: 1, y: 0, z: 0 } });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ sourceLine: 1, nBlock: '4', rawCode: 'N4 G21 G90 G17 G03 X0 Y1 I-1 J0', unit: 'mm', distanceMode: 'absolute', plane: 'XY' });
    expect(result.segments[0].vertices!.length).toBeGreaterThan(6);
  });

  it('rejects malformed comments, duplicate axes, and conflicting modal words', () => {
    for (const input of ['G21 (unfinished', 'G01 X1 X2', 'G20 G21', 'G02 G03 G17']) {
      expect(parseGcode(input).status).toBe('INVALID');
    }
  });

  it('diagnoses code after M2/M30 but ignores blank, comment, and percent rows', () => {
    const result = parseGcode('G21 G90 G00 X0 Y0 Z0\nM30\n\n(footer comment)\n%\nG01 X10 Y0 Z0\nG01 X20 Y0 Z0', {
      initialPosition: origin,
    });
    expect(result.status).toBe('PARTIAL');
    expect(result.segments).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ sourceLine: 6, code: 'CODE_AFTER_PROGRAM_END' });
    expect(result.finalState.position).toEqual(origin);
  });

  it('accepts M02 and does not warn when only comments and blank rows follow', () => {
    const result = parseGcode('G21 G90 G00 X0 Y0 Z0\nM02\n; end\n(footer)\n%\n', { initialPosition: origin });
    expect(result.status).toBe('SUPPORTED');
    expect(result.warnings).toHaveLength(0);
  });

  it('marks an unknown modal move as partial and does not invent a position', () => {
    const result = parseGcode('X10 Y20 Z30');
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.segments).toHaveLength(0);
    expect(result.finalState.position).toEqual({ x: null, y: null, z: null });
  });

  it('stops on an unresolvable move instead of bridging to later coordinates', () => {
    const result = parseGcode('G01 X5\nG21 G90\nX10 Y20 Z30', {
      initialPosition: origin,
      initialMotionMode: 'G01',
    });
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.segments).toHaveLength(0);
    expect(result.warnings[0]).toMatchObject({ sourceLine: 1, code: 'UNKNOWN_MODAL_STATE' });
    expect(result.finalState.position).toEqual({ x: null, y: null, z: null });
  });
});
