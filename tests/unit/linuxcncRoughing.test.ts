import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findLinuxCncSubroutine } from '../../src/parser/linuxcncMacro';
import { resolveLinuxCncProfile } from '../../src/parser/linuxcncProfile';
import { expandLinuxCncG71, type RoughCycleInput } from '../../src/parser/linuxcncRoughing';

const line = (sourceLine: number, x: number, z: number, rawCode = `G1 X${x} Z${z}`): RoughCycleInput['profile'][number] => ({ motion: 'G01', end: { x, z }, sourceLine, rawCode });
const base: RoughCycleInput = {
  cycle: 'G71.1', position: { x: 10, z: 1 }, units: 'mm', D: 0, I: 2, R: 0.3,
  sourceLine: 30, sourceBlockId: 'cycle-30', rawCode: 'G71.1 Q100 X10 Z1 I2 R0.3',
  profile: [line(4, 4, 1), line(5, 4, -10), line(6, 10, -10)],
};

describe('expandLinuxCncG71', () => {
  it('expands a straight OD profile into rough passes and final profile-follow moves', () => {
    const result = expandLinuxCncG71(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moves.length).toBeGreaterThan(4);
    expect(result.moves.some((move) => move.kind === 'rough-cut')).toBe(true);
    expect(result.moves.at(-1)).toMatchObject({ motion: 'G01', end: { x: 10, z: -10 }, kind: 'profile-follow' });
    expect(result.finalPosition).toEqual(result.moves.at(-1)?.end);
    expect(result.moves.every((move) => move.cycleSourceLine === 30)).toBe(true);
  });

  it('keeps circular contour arcs and their source mappings', () => {
    const profile = [
      line(10, 4, 1),
      { motion: 'G03' as const, end: { x: 6, z: -1 }, center: { x: 4, z: -1 }, sourceLine: 11, rawCode: 'G3 X6 Z-1 I0 K-2' },
      line(12, 6, -10),
      line(13, 10, -10),
    ];
    const result = expandLinuxCncG71({ ...base, cycle: 'G71.1', position: { x: 10, z: 1 }, X: 10, Z: 1, profile });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moves.some((move) => move.motion === 'G02' || move.motion === 'G03')).toBe(true);
    expect(result.moves.some((move) => move.profileSourceLine === 11 && move.profileRawCode?.includes('G3'))).toBe(true);
  });

  it('fails closed for G71.2 with unverified allowance', () => {
    const result = expandLinuxCncG71({ ...base, cycle: 'G71.2', D: 0.1 });
    expect(result).toMatchObject({ ok: false, moves: [], error: { code: 'UNSUPPORTED_G71_2' } });
  });

  it('fails closed on the bundled demo junction gap and on unverified G71.2 pockets', () => {
    const source = readFileSync(new URL('../../demo/lathe_g70_71_demo.ngc', import.meta.url), 'utf8');
    const routine = findLinuxCncSubroutine(source, 100);
    expect(routine).not.toBeNull();
    if (!routine) return;
    const resolved = resolveLinuxCncProfile(routine, { x: 15, z: 3.041 });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const result = expandLinuxCncG71({ cycle: 'G71.1', position: { x: 15, z: 3.041 }, X: 15, Z: 3.041, profile: resolved.profile, units: 'mm', D: 1, I: 1, R: 0.3, sourceLine: 30, rawCode: 'G71.1 Q100 X15 Z3.041 D1 I1 R0.3' });
    expect(resolved.profile.some((segment) => segment.corner?.kind === 'fillet' && segment.rawCode.includes('A0.2'))).toBe(true);
    expect(result).toMatchObject({ ok: false, moves: [], error: { code: 'UNRESOLVED_GEOMETRY', sourceLine: 30 } });
    if (!result.ok) {
      expect(result.error.message).toContain('no exact intersection (gap 0.000008 mm)');
      expect(result.error.message).toContain('profile lines 6/7');
    }
    const pocketResult = expandLinuxCncG71({ cycle: 'G71.2', position: { x: 15, z: 3.041 }, X: 15, Z: 3.041, profile: resolved.profile, units: 'mm', D: 0.51, I: 0.5, R: 0.3, sourceLine: 33, rawCode: 'G71.2 Q100 X15 Z3.041 D0.51 I0.5 R0.3' });
    expect(pocketResult).toMatchObject({ ok: false, moves: [], error: { code: 'UNSUPPORTED_G71_2', sourceLine: 33 } });
  });

  it('converts inch coordinates and cycle distances to millimeters', () => {
    const result = expandLinuxCncG71({ ...base, units: 'inch', position: { x: 1, z: 0.1 }, X: 1, Z: 0.1, I: 0.1, profile: [line(4, 0.4, 0.1), line(5, 0.4, -1), line(6, 1, -1)] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moves.every((move) => [move.start.x, move.start.z, move.end.x, move.end.z].every(Number.isFinite))).toBe(true);
    expect(Math.max(...result.moves.map((move) => Math.abs(move.end.x)))).toBeGreaterThanOrEqual(1);
  });

  it('preserves non-zero cycle positioning below the geometry tolerance', () => {
    const result = expandLinuxCncG71({
      ...base,
      X: 10.0000005,
      profile: [line(4, 4, 1), line(5, 4, -10), line(6, 10.0000005, -10)],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moves[0]).toMatchObject({
      motion: 'G00', kind: 'cycle-position', start: { x: 10, z: 1 }, end: { x: 10.0000005, z: 1 },
    });
  });

  it('intersects a nearly constant-X line at its exact interpolated Z', () => {
    const level = 5.00000025;
    const result = expandLinuxCncG71({
      ...base,
      I: (10 - level) / 2,
      profile: [line(4, 5, 0), line(5, 5.0000005, -10), line(6, 10, -10)],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const intersection = result.moves.find((move) => move.kind === 'rough-cut' && Math.abs(move.end.x - level) < 1e-12 && Math.abs(move.end.z + 5) < 1e-6);
    expect(intersection).toBeDefined();
    expect(intersection?.end.z).toBeCloseTo(-5, 6);
  });

  it('rejects tiny positive D and I instead of silently dropping or raising them', () => {
    const tinyAllowance = expandLinuxCncG71({ ...base, D: 1e-7 });
    expect(tinyAllowance).toMatchObject({ ok: false, moves: [], error: { code: 'UNRESOLVED_GEOMETRY' } });
    if (!tinyAllowance.ok) expect(tinyAllowance.error.message).toContain('stock allowance is below the geometric tolerance');

    const tinyIncrement = expandLinuxCncG71({
      ...base,
      position: { x: 1, z: 1 }, X: 1, Z: 1, D: 0, I: 1e-7, R: 0,
      profile: [line(4, 0.9992, 1), line(5, 0.9992, -10), line(6, 1, -10)],
    });
    expect(tinyIncrement).toMatchObject({ ok: false, moves: [], error: { code: 'INVALID_CYCLE_WORDS' } });

    const tinySegment = expandLinuxCncG71({ ...base, profile: [line(4, 10, 1 - 1e-7), line(5, 4, -10), line(6, 10, -10)] });
    expect(tinySegment).toMatchObject({ ok: false, moves: [], error: { code: 'UNRESOLVED_GEOMETRY' } });
    if (!tinySegment.ok) expect(tinySegment.error.message).toContain('Non-zero profile segment at source line 4');
  });

  it('rejects disjoint offset arcs instead of substituting a radial junction point', () => {
    const sqrt7 = Math.sqrt(7) * 10;
    const rightCenterX = 60 + sqrt7;
    const leftCenterX = 60 - sqrt7;
    const profile: RoughCycleInput['profile'] = [
      line(3, rightCenterX, -20),
      { motion: 'G02', end: { x: 60, z: -30 }, center: { x: rightCenterX, z: -60 }, sourceLine: 4, rawCode: 'G2 X60 Z-30' },
      { motion: 'G03', end: { x: leftCenterX, z: -100 }, center: { x: leftCenterX, z: -60 }, sourceLine: 5, rawCode: 'G3 X33.54 Z-100' },
      line(6, 120, -100),
    ];
    const result = expandLinuxCncG71({ ...base, position: { x: 80, z: 10 }, X: 80, Z: 10, D: 27, I: 5, profile });
    expect(result).toMatchObject({ ok: false, moves: [], error: { code: 'UNRESOLVED_GEOMETRY' } });
    if (!result.ok) expect(result.error.message).toContain('Offset arcs on profile lines 4/5 have no exact intersection');
  });

  it('rejects an arc cut level just outside its radius without borrowing an x-minus-tolerance intersection', () => {
    const profile: RoughCycleInput['profile'] = [
      { motion: 'G02', end: { x: 9.7, z: 1 }, center: { x: 9.8, z: 1 }, sourceLine: 3, rawCode: 'G2 X9.7 Z1 I0 K-0.1' },
      line(4, 10, -10),
    ];
    const result = expandLinuxCncG71({ ...base, position: { x: 9.8, z: 1.1 }, X: 9.8, Z: 1.1, D: 0, I: 0.1000001, R: 0, profile });
    expect(result).toMatchObject({ ok: false, moves: [], error: { code: 'UNRESOLVED_GEOMETRY' } });
    if (!result.ok) expect(result.error.message).toContain('no exact arc intersection');
  });

  it('rejects non-monotonic profiles, invalid cycles, and unresolvable/unsafe geometry with no partial path', () => {
    const invalid = expandLinuxCncG71({ ...base, profile: [line(4, 4, 1), line(5, 4, -5), line(6, 5, -4)] });
    expect(invalid).toMatchObject({ ok: false, moves: [], error: { code: 'NON_MONOTONIC_PROFILE' } });
    const badArc = expandLinuxCncG71({ ...base, profile: [{ motion: 'G02', end: { x: 4, z: -1 }, center: { x: 99, z: 99 }, sourceLine: 4, rawCode: 'G2 X4 Z-1' }, line(5, 4, -10)] });
    expect(badArc).toMatchObject({ ok: false, moves: [], error: { code: 'UNRESOLVED_GEOMETRY', sourceLine: 30 } });
    expect(expandLinuxCncG71({ ...base, I: 0 })).toMatchObject({ ok: false, moves: [], error: { code: 'INVALID_CYCLE_WORDS' } });
    expect(expandLinuxCncG71({ ...base, profile: [] })).toMatchObject({ ok: false, moves: [], error: { code: 'PROFILE_LIMIT' } });
  });

  it('retains cycle and contour source references on generated moves', () => {
    const result = expandLinuxCncG71({ ...base, sourceBlockId: 'rough-cycle', profile: [{ ...line(41, 4, 1), sourceBlockId: 'contour-move' }, line(42, 4, -10), line(43, 10, -10)] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moves.some((move) => move.cycleSourceBlockId === 'rough-cycle' && move.profileSourceBlockId === 'contour-move')).toBe(true);
  });
});
