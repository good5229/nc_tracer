/**
 * Geometry-only expansion for the LinuxCNC lathe G76 threading cycle.
 *
 * Inputs are resolved coordinates/word values in the active program unit. The
 * caller must resolve G90/G91, select G18, and reject non-ZX/rotary motion.
 * Returned positions are millimeters. This is a preview path; spindle phase,
 * acceleration, machine limits, workholding, and actual cutting are not modeled.
 * Geometry follows LinuxCNC docs/src/gcode/g-code.adoc (G76) and
 * src/emc/rs274ngc/interp_convert.cc (threading_pass/convert_threading_cycle).
 */
export type ThreadUnit = 'mm' | 'inch';
export type ThreadPosition = { x: number; y: number; z: number };
export type ThreadMoveKind = 'clearance' | 'approach' | 'entry-taper' | 'thread-cut' | 'exit-taper' | 'retract' | 'cycle-return';
export type ThreadMove = {
  motion: 'G00' | 'G01';
  kind: ThreadMoveKind;
  start: ThreadPosition;
  end: ThreadPosition;
  /** True for feed moves issued while LinuxCNC spindle synchronization is active. */
  spindleSynchronized: boolean;
  /** Axial coordinate at the spindle index for this pass, in millimeters. */
  phaseOriginZ: number;
  /** Ideal spindle revolutions since the index for this pass. */
  phaseTurnsStart: number;
  phaseTurnsEnd: number;
  /** The source G76 block is retained on every generated move. */
  sourceLine: number;
  sourceBlockId?: string;
  rawCode: string;
};

export type LinuxCncG76Input = {
  sourceLine: number;
  sourceBlockId?: string;
  rawCode: string;
  units: ThreadUnit;
  /** Current tool point before the G76 block, in program units. */
  start: ThreadPosition;
  /** Resolved endpoint Z, in program units; resolve G90/G91 in the caller. */
  endZ: number;
  /** Required G76 words. P is distance/revolution; I/J/K/Z are lengths. */
  P: number;
  I: number;
  J: number;
  K: number;
  /** LinuxCNC G7 diameter mode halves I/J/K internally. */
  diameterMode?: boolean;
  /** Optional LinuxCNC words: defaults R1, Q0, H0, E0, L0, $0, D0. */
  R?: number;
  Q?: number;
  H?: number;
  E?: number;
  L?: number;
  spindle?: number;
  D?: number;
};

export type LinuxCncG76Result =
  | { ok: true; moves: ThreadMove[]; finalPosition: ThreadPosition; spindle: number; spindleIndexOffsetDegrees: number; /** Cut depths from the drive line, in millimeters. */ passDepths: number[] }
  | { ok: false; moves: []; error: { code: string; message: string } };

/** Hard bounds prevent pathological degression values from allocating unbounded preview geometry. */
export const G76_MAX_PASSES = 1000;
export const G76_MAX_MOVES = 10_000;
const MAX_ABS_MM = 1_000_000;
const EPSILON = 1e-10;

/** Expand one LinuxCNC G76 block into its straight preview moves. */
export function expandLinuxCncG76(input: LinuxCncG76Input): LinuxCncG76Result {
  const fail = (code: string, message: string): LinuxCncG76Result => ({ ok: false, moves: [], error: { code, message } });
  const scale = input.units === 'inch' ? 25.4 : 1;
  const optional = { R: input.R ?? 1, Q: input.Q ?? 0, H: input.H ?? 0, E: input.E ?? 0, L: input.L ?? 0, spindle: input.spindle ?? 0, D: input.D ?? 0 };
  const values = [input.sourceLine, input.start.x, input.start.y, input.start.z, input.endZ, input.P, input.I, input.J, input.K,
    optional.R, optional.Q, optional.H, optional.E, optional.L, optional.spindle, optional.D];
  if (!values.every(Number.isFinite) || !Number.isInteger(input.sourceLine) || input.sourceLine < 1) {
    return fail('NON_FINITE_INPUT', 'G76 coordinates and words must be finite and sourceLine must be a positive integer.');
  }
  if (!input.rawCode.trim()) return fail('MISSING_SOURCE', 'rawCode is required to retain the originating G76 block.');
  if (input.P <= 0) return fail('INVALID_PITCH', 'G76 P must be a positive distance per spindle revolution.');
  if (input.I === 0) return fail('INVALID_THREAD_PEAK', 'G76 I must not be zero.');
  if (input.J <= 0) return fail('INVALID_INITIAL_DEPTH', 'G76 J must be greater than zero.');
  if (input.K <= input.J) return fail('INVALID_FULL_DEPTH', 'LinuxCNC requires G76 K to be greater than J.');
  if (optional.R < 1) return fail('INVALID_DEGRESSION', 'G76 R must be at least 1.');
  if (!Number.isInteger(optional.H) || optional.H < 0) return fail('INVALID_SPRING_PASSES', 'G76 H must be a non-negative integer.');
  if (!Number.isInteger(optional.L) || optional.L < 0 || optional.L > 3) return fail('INVALID_TAPER_FLAGS', 'G76 L must be 0, 1, 2, or 3.');
  if (!Number.isInteger(optional.spindle) || optional.spindle < 0) return fail('INVALID_SPINDLE', 'G76 spindle selector must be a non-negative integer.');
  if (optional.E < 0) return fail('INVALID_TAPER_LENGTH', 'G76 E must be non-negative.');
  if (Math.abs(optional.Q) >= 89.9) return fail('UNSAFE_COMPOUND_ANGLE', 'G76 Q must remain below 89.9 degrees to avoid an unbounded compound-slide offset.');
  const driveLength = Math.abs(input.endZ - input.start.z);
  if (driveLength === 0) return fail('ZERO_DRIVE_LENGTH', 'G76 Z endpoint must differ from the starting Z position.');
  if (optional.E > driveLength / 2) return fail('TAPER_EXCEEDS_DRIVE', 'LinuxCNC requires G76 E not to exceed half the drive-line length.');

  const diameterScale = input.diameterMode ? 0.5 : 1;
  const i = input.I * scale * diameterScale;
  const j = input.J * scale * diameterScale;
  const k = input.K * scale * diameterScale;
  const pitch = input.P * scale;
  const start = { x: input.start.x * scale, y: input.start.y * scale, z: input.start.z * scale };
  const endZ = input.endZ * scale;
  const q = optional.Q * Math.PI / 180 * (endZ > start.z ? -1 : 1);
  const taper = optional.E * scale * (endZ > start.z ? -1 : 1);
  const fullDiaDepth = Math.abs(i);
  const startDepth = fullDiaDepth + Math.abs(j);
  const endDepth = Math.abs(k) + fullDiaDepth;
  const increment = Math.abs(j);
  const fullThreadHeight = Math.abs(k);
  const boring = i > 0;
  const targetZ = endZ + fullThreadHeight * Math.tan(q);
  const entry = (optional.L & 1) !== 0;
  const exit = (optional.L & 2) !== 0;
  if (optional.H + 1 > G76_MAX_PASSES) return fail('PASS_LIMIT', `G76 requires more than ${G76_MAX_PASSES} total passes.`);
  const taperPitch = taper !== 0 ? pitch * Math.hypot(taper, fullThreadHeight) / Math.abs(taper) : pitch;
  if (![...Object.values(start), endZ, targetZ, taperPitch].every(Number.isFinite)
    || [...Object.values(start), endZ, targetZ].some((n) => Math.abs(n) > MAX_ABS_MM)) {
    return fail('COORDINATE_LIMIT', `G76 result exceeds the ${MAX_ABS_MM} mm preview-coordinate limit.`);
  }

  const passDepths: number[] = [];
  let pass = 1;
  let depth = startDepth;
  while (depth < endDepth - EPSILON) {
    if (passDepths.length >= G76_MAX_PASSES - optional.H - 1) return fail('PASS_LIMIT', `G76 requires more than ${G76_MAX_PASSES} total passes.`);
    passDepths.push(depth);
    pass += 1;
    depth = fullDiaDepth + increment * Math.pow(pass, 1 / optional.R);
    if (!Number.isFinite(depth)) return fail('PASS_CALCULATION', 'G76 pass-depth calculation overflowed.');
  }
  for (let n = 0; n < optional.H + 1; n += 1) passDepths.push(endDepth);
  const moves: ThreadMove[] = [];
  let current = start;
  let phaseOriginZ=start.z,phaseTurns=0;
  const append = (motion: ThreadMove['motion'], kind: ThreadMoveKind, end: ThreadPosition, spindleSynchronized = false) => {
    if (moves.length >= G76_MAX_MOVES) return false;
    const moveEnd = { x: end.x, y: end.y, z: end.z };
    if (![moveEnd.x, moveEnd.y, moveEnd.z].every(Number.isFinite) || [moveEnd.x, moveEnd.y, moveEnd.z].some((n) => Math.abs(n) > MAX_ABS_MM)) return false;
    const phaseTurnsStart=phaseTurns;
    if(spindleSynchronized){const syncPitch=kind==='thread-cut'?pitch:taperPitch;phaseTurns+=Math.hypot(moveEnd.x-current.x,moveEnd.z-current.z)/syncPitch;}
    if(!Number.isFinite(phaseTurns))return false;
    moves.push({ motion, kind, start: current, end: moveEnd, spindleSynchronized, phaseOriginZ,phaseTurnsStart,phaseTurnsEnd:phaseTurns, sourceLine: input.sourceLine, sourceBlockId: input.sourceBlockId, rawCode: input.rawCode });
    current = moveEnd;
    return true;
  };
  const xAtDepth = (depthValue: number) => start.x + (boring ? 1 : -1) * depthValue;
  for (const cutDepth of passDepths) {
    phaseTurns=0;
    const zoff = (cutDepth - fullDiaDepth) * Math.tan(q);
    const backX = start.x + (boring ? 1 : -1) * (cutDepth - endDepth);
    const backZ = start.z - zoff;
    phaseOriginZ=backZ;
    const cutX = xAtDepth(cutDepth);
    const at = (x: number, z: number): ThreadPosition => ({ x, y: start.y, z });
    if (!append('G00', 'clearance', at(backX, backZ))) return fail('MOVE_LIMIT', 'G76 expanded path exceeded its move or coordinate limit.');
    if (taper !== 0 && entry) {
      if (!append('G01', 'approach', at(xAtDepth(cutDepth - fullThreadHeight), backZ), true)) return fail('MOVE_LIMIT', 'G76 expanded path exceeded its move or coordinate limit.');
      if (!append('G01', 'entry-taper', at(cutX, backZ - taper), true)) return fail('MOVE_LIMIT', 'G76 expanded path exceeded its move or coordinate limit.');
    } else {
      if (!append('G00', 'approach', at(cutX, backZ))) return fail('MOVE_LIMIT', 'G76 expanded path exceeded its move or coordinate limit.');
    }
    if (taper !== 0 && exit) {
      if (!append('G01', 'thread-cut', at(cutX, targetZ - zoff + taper), true)) return fail('MOVE_LIMIT', 'G76 expanded path exceeded its move or coordinate limit.');
      if (!append('G01', 'exit-taper', at(xAtDepth(cutDepth - fullThreadHeight), targetZ - zoff), true)) return fail('MOVE_LIMIT', 'G76 expanded path exceeded its move or coordinate limit.');
    } else if (!append('G01', 'thread-cut', at(cutX, targetZ - zoff), true)) {
      return fail('MOVE_LIMIT', 'G76 expanded path exceeded its move or coordinate limit.');
    }
    if (!append('G00', 'retract', at(backX, targetZ - zoff))) return fail('MOVE_LIMIT', 'G76 expanded path exceeded its move or coordinate limit.');
  }
  if (!append('G00', 'cycle-return', { x: start.x, y: start.y, z: endZ })) return fail('MOVE_LIMIT', 'G76 expanded path exceeded its move or coordinate limit.');
  return { ok: true, moves, finalPosition: { x: start.x, y: start.y, z: endZ }, spindle: optional.spindle, spindleIndexOffsetDegrees: Math.abs(optional.D), passDepths };
}
