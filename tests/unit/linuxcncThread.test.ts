import { describe, expect, it } from 'vitest';
import { expandLinuxCncG76, G76_MAX_PASSES, type LinuxCncG76Input } from '../../src/parser/linuxcncThread';

const base: LinuxCncG76Input = {
  sourceLine: 18,
  sourceBlockId: 'block-18',
  rawCode: 'G76 P2 Z-10 I-0.5 J0.1 K0.3',
  units: 'mm',
  start: { x: 10, y: 0, z: 0 },
  endZ: -10,
  P: 2,
  I: -0.5,
  J: 0.1,
  K: 0.3,
};

describe('expandLinuxCncG76', () => {
  it('expands degression depths into clear, approach, spindle-synchronized cut, retract and final return', () => {
    const result = expandLinuxCncG76(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passDepths).toEqual([0.6, 0.7, 0.8]);
    expect(result.moves).toHaveLength(13);
    expect(result.moves.slice(0, 4).map((move) => [move.kind, move.motion, move.spindleSynchronized])).toEqual([
      ['clearance', 'G00', false], ['approach', 'G00', false], ['thread-cut', 'G01', true], ['retract', 'G00', false],
    ]);
    expect(result.moves[2]).toMatchObject({ start: { x: 9.4, y: 0, z: 0 }, end: { x: 9.4, y: 0, z: -10 } });
    expect(result.moves.at(-1)).toMatchObject({ kind: 'cycle-return', end: { x: 10, y: 0, z: -10 } });
    expect(result.moves.every((move) => move.sourceLine === 18 && move.sourceBlockId === 'block-18' && move.rawCode === base.rawCode)).toBe(true);
    expect(result.finalPosition).toEqual({ x: 10, y: 0, z: -10 });
  });

  it('supports inch program units and LinuxCNC diameter-mode I/J/K scaling', () => {
    const result = expandLinuxCncG76({
      ...base,
      units: 'inch',
      start: { x: 1, y: 2, z: 0 },
      endZ: -1,
      P: 0.05,
      I: -0.075,
      J: 0.008,
      K: 0.045,
      diameterMode: true,
      H: 1,
      rawCode: 'G76 P.05 Z-1 I-.075 J.008 K.045',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalPosition).toEqual({ x: 25.4, y: 50.8, z: -25.4 });
    expect(result.passDepths.at(-1)).toBeCloseTo(0.06 * 25.4);
    expect(result.moves.filter((move) => move.kind === 'thread-cut')).toHaveLength(result.passDepths.length);
  });

  it('emits entry and exit tapers and honors spring passes and spindle selection', () => {
    const result = expandLinuxCncG76({ ...base, E: 1, L: 3, Q: 29.5, H: 2, spindle: 1, D: -120 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spindle).toBe(1);
    expect(result.spindleIndexOffsetDegrees).toBe(120);
    expect(result.passDepths.slice(-3)).toEqual([0.8, 0.8, 0.8]);
    expect(result.moves.filter((move) => move.kind === 'entry-taper')).toHaveLength(result.passDepths.length);
    expect(result.moves.filter((move) => move.kind === 'exit-taper')).toHaveLength(result.passDepths.length);
    expect(result.moves.find((move) => move.kind === 'approach')?.spindleSynchronized).toBe(true);
    expect(result.moves.find((move) => move.kind === 'entry-taper')?.spindleSynchronized).toBe(true);
    expect(result.moves.find((move) => move.kind === 'exit-taper')?.spindleSynchronized).toBe(true);
  });

  it('models internal threads by moving X in the positive radial direction', () => {
    const result = expandLinuxCncG76({ ...base, I: 0.5, rawCode: 'G76 P2 Z-10 I.5 J.1 K.3' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moves[1].end.x).toBe(10.6);
    expect(result.moves[2].end.x).toBe(10.6);
    expect(result.moves[3].end.x).toBe(9.8);
  });

  it.each([
    [{ P: 0 }, 'INVALID_PITCH'],
    [{ I: 0 }, 'INVALID_THREAD_PEAK'],
    [{ J: 0 }, 'INVALID_INITIAL_DEPTH'],
    [{ K: 0.1 }, 'INVALID_FULL_DEPTH'],
    [{ R: 0.9 }, 'INVALID_DEGRESSION'],
    [{ H: 1.5 }, 'INVALID_SPRING_PASSES'],
    [{ L: 4 }, 'INVALID_TAPER_FLAGS'],
    [{ E: 5.1 }, 'TAPER_EXCEEDS_DRIVE'],
    [{ Q: 90 }, 'UNSAFE_COMPOUND_ANGLE'],
    [{ H: G76_MAX_PASSES }, 'PASS_LIMIT'],
  ] as const)('rejects invalid or unbounded values without partial moves (%o)', (patch, code) => {
    const result = expandLinuxCncG76({ ...base, ...patch });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
    expect(result.moves).toEqual([]);
  });

  it('rejects non-finite/oversized coordinates and missing source mapping', () => {
    expect(expandLinuxCncG76({ ...base, start: { ...base.start, x: Infinity } })).toMatchObject({ ok: false, error: { code: 'NON_FINITE_INPUT' }, moves: [] });
    expect(expandLinuxCncG76({ ...base, start: { ...base.start, x: 1_000_001 } })).toMatchObject({ ok: false, error: { code: 'COORDINATE_LIMIT' }, moves: [] });
    expect(expandLinuxCncG76({ ...base, rawCode: '   ' })).toMatchObject({ ok: false, error: { code: 'MISSING_SOURCE' }, moves: [] });
    expect(expandLinuxCncG76({ ...base, endZ: 0 })).toMatchObject({ ok: false, error: { code: 'ZERO_DRIVE_LENGTH' }, moves: [] });
  });
});
