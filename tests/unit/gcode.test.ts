import { describe, expect, it } from 'vitest';
import { parseGcode } from '../../src/parser/gcode';

const origin = { x: 0, y: 0, z: 0 };

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
    expect(result.status).toBe('PARTIAL');
    expect(result.segments).toHaveLength(1);
    expect(result.warnings[0].sourceLine).toBe(3);
    expect(result.finalState.position).toEqual({ x: null, y: null, z: null });
  });

  it('rejects malformed comments, duplicate axes, and conflicting modal words', () => {
    for (const input of ['G21 (unfinished', 'G01 X1 X2', 'G20 G21']) {
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
