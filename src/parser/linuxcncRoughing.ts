/**
 * Geometry-only G71.1 expansion derived from LinuxCNC 2.9.4 interp_g7x.cc.
 * LinuxCNC is distributed under GPL-2.0; see demo/COPYING and
 * https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/rs274ngc/interp_g7x.cc.
 * G71.2 remains fail-closed pending trace parity.
 */
export const LINUXCNC_G71_COMPAT_VERSION = '2.9.4';
export type RoughPoint = { x: number; z: number };
export type RoughMotion = 'G00' | 'G01' | 'G02' | 'G03';
export type RoughProfileSegment = {
  motion: RoughMotion;
  end: RoughPoint;
  /** Arc center in the active XZ coordinate system; required for G02/G03. */
  center?: RoughPoint;
  /** LinuxCNC A/C corner finish attached to this move's endpoint. */
  corner?: { kind: 'fillet' | 'chamfer'; amount: number };
  sourceLine: number;
  sourceBlockId?: string;
  rawCode: string;
};
export type RoughCycleInput = {
  cycle: 'G71.1' | 'G71.2';
  /** Current X/Z point before the cycle block. */
  position: RoughPoint;
  /** Optional resolved X/Z cycle start; omitted axes keep their current value. */
  X?: number;
  Z?: number;
  /** Profile contour in source order, with endpoints resolved in G90 and active units. */
  profile: RoughProfileSegment[];
  units: 'mm' | 'inch';
  /** D: stock allowance from the contour (default 0); I: cut increment (default 1); R: retract (default .5). */
  D?: number;
  I?: number;
  R?: number;
  sourceLine: number;
  sourceBlockId?: string;
  rawCode: string;
};
export type RoughMove = {
  motion: RoughMotion;
  start: RoughPoint;
  end: RoughPoint;
  center?: RoughPoint;
  /** Identifies generated roughing/retract motion while keeping its source contour attribution. */
  kind: 'cycle-position' | 'rough-cut' | 'pocket-retract' | 'profile-follow' | 'pocket-approach';
  cycle: 'G71.1' | 'G71.2';
  cycleSourceLine: number;
  cycleSourceBlockId?: string;
  cycleRawCode: string;
  profileSourceLine?: number;
  profileSourceBlockId?: string;
  profileRawCode?: string;
};
export type RoughingResult =
  | { ok: true; moves: RoughMove[]; finalPosition: RoughPoint; cutLevels: number[] }
  | { ok: false; moves: []; error: { code: string; message: string; sourceLine: number } };

export const G71_MAX_PROFILE_SEGMENTS = 10_000;
export const G71_MAX_CUT_LEVELS = 2_000;
export const G71_MAX_MOVES = 100_000;
const TOL = 1e-6;
const ZTOL = 1e-3;
/** Treat gaps up to one nanometer as floating-point rounding; larger gaps fail closed. */
export const G71_JUNCTION_ROUNDING_TOLERANCE_MM = 1e-6;

// Internal coordinates match LinuxCNC's complex number: real=Z, imaginary=X.
type P = { z: number; x: number };
type Arc = { kind: 'arc'; a: P; b: P; c: P; ccw: boolean; finish: number; meta: RoughProfileSegment };
type Line = { kind: 'line'; a: P; b: P; finish: number; meta: RoughProfileSegment };
type Seg = Arc | Line;
type Sink = (motion: RoughMotion, end: P, kind: RoughMove['kind'], meta?: RoughProfileSegment, center?: P) => void;
const add = (a: P, b: P): P => ({ z: a.z + b.z, x: a.x + b.x });
const sub = (a: P, b: P): P => ({ z: a.z - b.z, x: a.x - b.x });
const mul = (a: P, n: number): P => ({ z: a.z * n, x: a.x * n });
const norm = (a: P) => a.z * a.z + a.x * a.x;
const length = (a: P) => Math.hypot(a.z, a.x);
const dot = (a: P, b: P) => a.z * b.z + a.x * b.x;
const cross = (a: P, b: P) => a.z * b.x - a.x * b.z;
const near = (a: P, b: P, eps = TOL) => length(sub(a, b)) <= eps;
const finite = (p: RoughPoint) => Number.isFinite(p.x) && Number.isFinite(p.z);
const toP = (p: RoughPoint): P => ({ z: p.z, x: p.x });

function pointLineIntersection(a: P, b: P, c: P, d: P): P | null {
  const ab = sub(b, a), cd = sub(d, c), den = cross(ab, cd);
  if (Math.abs(den) <= TOL) return null;
  return add(a, mul(ab, cross(sub(c, a), cd) / den));
}

function intersectionsAtX(s: Seg, x: number): number[] {
  if (s.kind === 'line') {
    if (Math.min(s.a.x, s.b.x) > x || Math.max(s.a.x, s.b.x) < x) return [];
    if (s.a.x === s.b.x) return [s.a.z, s.b.z];
    return [s.a.z + (x - s.a.x) / (s.b.x - s.a.x) * (s.b.z - s.a.z)];
  }
  const r = length(sub(s.a, s.c)), dx = x - s.c.x;
  if (Math.abs(dx) > r) return [];
  const dz = Math.sqrt((r - dx) * (r + dx));
  return [s.c.z + dz, s.c.z - dz].filter((z) => {
    const q = { z, x };
    // Allow only floating-point roundoff when deciding whether an exact
    // circle intersection lies on this arc. Geometric tolerances here can
    // admit a nearby point outside the commanded arc and silently reshape it.
    const eps = 64 * Number.EPSILON * r * r;
    return s.ccw ? cross(sub(s.a, s.c), sub(q, s.c)) >= -eps && cross(sub(s.b, s.c), sub(q, s.c)) <= eps
      : cross(sub(s.a, s.c), sub(q, s.c)) <= eps && cross(sub(s.b, s.c), sub(q, s.c)) >= -eps;
  });
}

function offset(s: Seg, distance: number): void {
  if (s.kind === 'line') {
    const v = sub(s.a, s.b), n = length(v);
    if (n <= TOL) throw new Error('Cannot offset a zero-length line.');
    const d = { z: -v.x / n * distance, x: v.z / n * distance };
    s.a = add(s.a, d); s.b = add(s.b, d);
  } else {
    const radius = length(sub(s.a, s.c));
    if (radius <= TOL) throw new Error('Cannot offset a zero-radius arc.');
    const factor = (radius + (s.ccw ? 1 : -1) * distance) / radius;
    if (!(factor > 0)) throw new Error('Offset collapses an arc.');
    s.a = add(mul(sub(s.a, s.c), factor), s.c);
    s.b = add(mul(sub(s.b, s.c), factor), s.c);
  }
}

function radius(s: Seg): number {
  return s.kind === 'line' ? length(sub(s.a, s.b)) : Math.min(length(sub(s.a, s.b)), length(sub(s.a, s.c)));
}
function monotonic(s: Seg): boolean {
  if (s.kind === 'line') return s.b.z - s.a.z <= ZTOL;
  if (s.finish !== 0) return true;
  const entry = s.a.x - s.c.x, exit = s.b.x - s.c.x, dz = s.b.z - s.a.z;
  return s.ccw ? entry >= -ZTOL && exit >= -ZTOL && dz <= -ZTOL : entry <= ZTOL && exit <= ZTOL && dz <= -ZTOL;
}

function trimAdjacent(prev: Seg, next: Seg, machineScale = 1): void {
  if (prev.kind === 'line' && next.kind === 'line') {
    const p = pointLineIntersection(prev.a, prev.b, next.a, next.b);
    if (!p) throw new Error('Cannot intersect parallel offset lines.');
    prev.b = p; next.a = p; return;
  }
  if (prev.kind === 'arc' && next.kind === 'arc') {
    const ra = length(sub(prev.a, prev.c)), rb = length(sub(next.a, next.c)), dc = sub(next.c, prev.c), d = length(dc);
    if (!(d > TOL)) throw new Error('Coincident offset arcs are unsupported.');
    const circlesGap = Math.max(0, d - ra - rb, Math.abs(ra - rb) - d) / machineScale;
    if (circlesGap > G71_JUNCTION_ROUNDING_TOLERANCE_MM) {
      throw new Error(`Offset junction gap ${circlesGap.toFixed(6)} mm exceeds the ${G71_JUNCTION_ROUNDING_TOLERANCE_MM} mm rounding tolerance between profile lines ${prev.meta.sourceLine}/${next.meta.sourceLine}.`);
    }
    const cosB = (d * d + ra * ra - rb * rb) / (2 * ra * d);
    if (Math.abs(cosB) > 1) {
      throw new Error(`Offset arcs on profile lines ${prev.meta.sourceLine}/${next.meta.sourceLine} have no exact intersection (gap ${circlesGap.toFixed(6)} mm); refusing to substitute a radial point.`);
    }
    const h = Math.sqrt(Math.max(0, 1 - cosB * cosB));
    const u = { z: dc.z / d * cosB - dc.x / d * h, x: dc.x / d * cosB + dc.z / d * h };
    const p = add(prev.c, mul(u, ra)); prev.b = p; next.a = p; return;
  }
  const arc = prev.kind === 'arc' ? prev : next as Arc;
  const line = prev.kind === 'line' ? prev : next as Line;
  const lineIsPrev = prev.kind === 'line';
  // Find line-circle intersections and select the one nearest the original junction.
  // LinuxCNC 2.9.4's line/arc intersection uses the arc endpoint radius.
  const d = sub(line.b, line.a), f = sub(line.a, arc.c), aa = dot(d, d), bb = 2 * dot(f, d), cc = dot(f, f) - norm(sub(arc.b, arc.c));
  const disc = bb * bb - 4 * aa * cc;
  if (!(aa > TOL)) throw new Error('Cannot intersect a zero-length line and arc.');
  if (disc < 0) {
    const t = -dot(f, d) / aa;
    const lineDistance = length(sub(add(line.a, mul(d, t)), arc.c));
    const gapMm = Math.abs(lineDistance - length(sub(arc.b, arc.c))) / machineScale;
    throw new Error(`Offset line/arc junction on profile lines ${prev.meta.sourceLine}/${next.meta.sourceLine} has no exact intersection (gap ${gapMm.toFixed(6)} mm); refusing to project to a tangent point.`);
  }
  const root = Math.sqrt(disc);
  const candidates = [(-bb + root) / (2 * aa), (-bb - root) / (2 * aa)].map((t) => add(line.a, mul(d, t)));
  // LinuxCNC's arc/line intersection selects the root closest to the arc's
  // start point, independent of whether the arc comes before or after line.
  const junction = arc.a;
  const p = candidates.sort((a, b) => length(sub(a, junction)) - length(sub(b, junction)))[0];
  if (lineIsPrev) { line.b = p; arc.a = p; } else { arc.b = p; line.a = p; }
}

function applyCornerFillets(path: Seg[], machineScale: number): Seg[] {
  for (let i = 1; i < path.length - 1; i += 1) {
    const corner = path[i];
    if (!corner.finish) continue;
    const d = corner.finish;
    if (d < 0) throw new Error(`Negative A/C corner finish at source line ${corner.meta.sourceLine}.`);
    // Corner marker carries the source move endpoint. Offset adjacent contours,
    // intersect them, then place the tangent arc or chamfer between them.
    const prev = structuredClone(path[i - 1]), next = structuredClone(path[i + 1]);
    let amount = d;
    offset(prev, amount); offset(next, amount);
    if (prev.b.z - next.a.z > 1e-2) { amount = -amount; offset(prev, 2 * amount); offset(next, 2 * amount); }
    trimAdjacent(prev, next, machineScale);
    const center = mul(add(prev.b, next.a), 0.5);
    offset(prev, -amount); offset(next, -amount);
    path[i - 1].b = prev.b; path[i + 1].a = next.a;
    if (corner.kind === 'arc') {
      corner.a = prev.b; corner.b = next.a; corner.c = center; corner.ccw = (corner.a.x - center.x) > 0 || (corner.b.x - center.x) > 0; corner.finish = 0;
    } else {
      corner.a = prev.b; corner.b = next.a; corner.finish = 0;
    }
  }
  const tooSmall = path.find((s) => radius(s) < 1e-3 && !(s.finish === 0 && near(s.a, s.b, 0)));
  if (tooSmall) throw new Error(`Corner finish creates a segment below the 0.001 mm geometry limit at source line ${tooSmall.meta.sourceLine}; refusing to discard it.`);
  return path.filter((s) => !(s.finish === 0 && near(s.a, s.b, 0)));
}

function profilePath(input: RoughCycleInput, cycleStart: P, scale: number): Seg[] {
  const p: Seg[] = [];
  let start = cycleStart;
  for (const item of input.profile) {
    const end = mul(toP(item.end), scale);
    if (near(start, end)) {
      if (!near(start, end, 0)) throw new Error(`Non-zero profile segment at source line ${item.sourceLine} is smaller than the geometric tolerance.`);
      if (item.motion === 'G02' || item.motion === 'G03') throw new Error(`Full-circle profile arc at source line ${item.sourceLine} is unsupported.`);
      if (item.corner) p.push({ kind: item.corner.kind === 'fillet' ? 'arc' : 'line', a: end, b: end, ...(item.corner.kind === 'fillet' ? { c: end, ccw: false } : {}), finish: item.corner.amount * scale, meta: item } as Seg);
      continue;
    }
    if (item.motion === 'G02' || item.motion === 'G03') {
      if (!item.center || !finite(item.center)) throw new Error(`Arc at source line ${item.sourceLine} has no finite center.`);
      const arc: Arc = { kind: 'arc', a: start, b: end, c: mul(toP(item.center), scale), ccw: item.motion === 'G03', finish: 0, meta: item };
      const ra = length(sub(start, arc.c)), rb = length(sub(end, arc.c));
      // LinuxCNC accepts endpoint-rounding drift in ordinary G-code decimals;
      // the third bundled G71 demo has a ~0.00025 mm radius discrepancy.
      if (!(ra > TOL) || Math.abs(ra - rb) > Math.max(5e-4 * scale, ra * 1e-4)) throw new Error(`Invalid arc geometry at source line ${item.sourceLine}.`);
      p.push(arc);
    } else p.push({ kind: 'line', a: start, b: end, finish: 0, meta: item });
    if (item.corner) p.push({ kind: item.corner.kind === 'fillet' ? 'arc' : 'line', a: end, b: end, ...(item.corner.kind === 'fillet' ? { c: end, ccw: false } : {}), finish: item.corner.amount * scale, meta: item } as Seg);
    start = end;
  }
  return p;
}

/** Expand one already-resolved G71.1/G71.2 cycle and O-subroutine contour. */
export function expandLinuxCncG71(input: RoughCycleInput): RoughingResult {
  const fail = (code: string, message: string, sourceLine = input.sourceLine): RoughingResult => ({ ok: false, moves: [], error: { code, message, sourceLine } });
  const scale = input.units === 'inch' ? 25.4 : 1;
  const d = input.D ?? 0, step = input.I ?? 1, retract = input.R ?? 0.5;
  if (!Number.isInteger(input.sourceLine) || input.sourceLine < 1 || !input.rawCode.trim() || !finite(input.position)) return fail('INVALID_SOURCE_OR_POSITION', 'Cycle source and current X/Z position must be present and finite.');
  if (input.cycle === 'G71.2') return fail('UNSUPPORTED_G71_2', 'LinuxCNC 2.9.4 G71.2 pocket expansion is not yet verified for this geometry.');
  if (!input.profile.length || input.profile.length > G71_MAX_PROFILE_SEGMENTS) return fail('PROFILE_LIMIT', `Profile must contain 1 to ${G71_MAX_PROFILE_SEGMENTS} segments.`);
  if (![d, step, retract, input.X ?? input.position.x, input.Z ?? input.position.z].every(Number.isFinite) || d < 0 || step <= 0 || retract < 0) return fail('INVALID_CYCLE_WORDS', 'G71 D and R must be non-negative and I must be positive.');
  if (input.profile.some((s) => !finite(s.end) || !Number.isInteger(s.sourceLine) || s.sourceLine < 1 || !s.rawCode.trim() || (s.corner && (!Number.isFinite(s.corner.amount) || s.corner.amount < 0)))) return fail('INVALID_PROFILE', 'Profile moves, source mappings, and corner dimensions must be valid.');
  const initial = toP(input.position), target = { x: input.X ?? input.position.x, z: input.Z ?? input.position.z };
  const cycleStart = { z: target.z * scale, x: target.x * scale };
  const origin = { z: initial.z * scale, x: initial.x * scale };
  const moves: RoughMove[] = [];
  let unitScale = 1;
  let machinePosition = origin;
  let activeMeta: RoughProfileSegment | undefined;
  const emit: Sink = (motion, end, kind, meta = activeMeta, center) => {
    if (moves.length >= G71_MAX_MOVES) throw new Error(`G71 expanded path exceeds ${G71_MAX_MOVES} moves.`);
    // Preserve every non-zero commanded move, including sub-tolerance cycle
    // positioning changes. A full-circle arc can also have identical ends.
    if (!center && machinePosition.x === end.x && machinePosition.z === end.z) return;
    const mapped = (p: P): RoughPoint => ({ x: p.x / (scale * unitScale), z: p.z / (scale * unitScale) });
    moves.push({ motion, kind, start: mapped(machinePosition), end: mapped(end), ...(center ? { center: mapped(center) } : {}), cycle: input.cycle, cycleSourceLine: input.sourceLine, cycleSourceBlockId: input.sourceBlockId, cycleRawCode: input.rawCode, ...(meta ? { profileSourceLine: meta.sourceLine, profileSourceBlockId: meta.sourceBlockId, profileRawCode: meta.rawCode } : {}) });
    // Segment traversal mutates its `location` object after emitting a move;
    // keep the emitted machine position as an immutable coordinate snapshot.
    machinePosition = { ...end };
  };
  try {
    if (origin.x !== cycleStart.x || origin.z !== cycleStart.z) emit('G00', cycleStart, 'cycle-position', undefined);
    let path = profilePath(input, cycleStart, scale);
    if (path.length < 2) return fail('PROFILE_TOO_SHORT', 'G71 profile must contain at least two non-zero segments.');
    // LinuxCNC normalizes the contour to keep its geometric tolerance scale invariant.
    const extent = Math.max(...path.flatMap((s) => [Math.abs(s.a.z), Math.abs(s.a.x), Math.abs(s.b.z), Math.abs(s.b.x)]));
    if (!(extent > 0) || !Number.isFinite(extent)) return fail('INVALID_PROFILE', 'Profile has no finite extent.');
    const exponent = Math.floor(Math.log2(extent)) + 1;
    const unit = 2 ** (6 - exponent);
    unitScale = unit;
    path = path.map((s) => {
      const clone = structuredClone(s);
      clone.a = mul(clone.a, unit); clone.b = mul(clone.b, unit); clone.finish *= unit;
      if (clone.kind === 'arc') clone.c = mul(clone.c, unit);
      return clone;
    });
    const normOrigin = mul(cycleStart, unit);
    // Emitted cycle-position moves above use input coordinates; all roughing
    // geometry below is normalized for stable tolerances.
    machinePosition = normOrigin;
    const dNorm = d * scale * unit, iNorm = step * scale * unit, rNorm = retract * scale * unit;
    // This dedicated G71 implementation uses the canonical LinuxCNC contour direction;
    // reversing or auto-rotating contours is rejected rather than guessed.
    if (path[0].b.z - path.at(-1)!.b.z <= TOL) return fail('UNSUPPORTED_PROFILE_DIRECTION', 'G71 requires the contour to advance monotonically toward decreasing Z.');
    path[0].a = normOrigin;
    path = applyCornerFillets(path, scale * unit);
    if (path.length < 2 || path.some((s) => !monotonic(s))) return fail('NON_MONOTONIC_PROFILE', 'G71 profile is non-monotonic in Z after applying corner finishes.', path.find((s) => !monotonic(s))?.meta.sourceLine ?? input.sourceLine);
    path = offsetContour(path, dNorm, scale * unit);
    const anchor = path[0];
    // Stock allowance D offsets the contour away from material; G71.1/2 in
    // LinuxCNC then applies any caller-provided profile shifts before roughing.
    path[0].a = normOrigin;
    if (Math.abs(path.at(-1)!.b.x - normOrigin.x) > TOL && path.at(-1)!.b.x < normOrigin.x - TOL) {
      const last = path.at(-1)!;
      path.push({ kind: 'line', a: last.b, b: { z: last.b.z, x: normOrigin.x }, finish: 0, meta: last.meta });
    }
    const delta = iNorm, escape = rNorm;
    if (!(delta >= 2 * TOL) || !Number.isFinite(delta)) return fail('INVALID_CYCLE_WORDS', 'G71 I is below the minimum representable cut increment.');
    // G71.1 runs the first axial roughing sequence and follows the profile at its
    // end without removing pockets; G71.2 omits that sequence and recurses into pockets.
    const cycleNumber = input.cycle === 'G71.1' ? 1 : 2;
    emit('G00', anchor.a, 'cycle-position', anchor.meta);
    const location = { ...anchor.a };
    const levels: number[] = [];
    runPockets(path, cycleNumber, location, delta, escape, emit, levels);
    if (!moves.length) return fail('EMPTY_ROUGH_PATH', 'G71 generated no preview motions.');
    return { ok: true, moves, finalPosition: { x: machinePosition.x / scale / unitScale, z: machinePosition.z / scale / unitScale }, cutLevels: levels.map((x) => x / unit / scale) };
  } catch (error) {
    return fail('UNRESOLVED_GEOMETRY', error instanceof Error ? error.message : 'LinuxCNC G71 geometry could not be resolved.');
  }
}

function offsetContour(path: Seg[], distance: number, machineScale: number): Seg[] {
  // Return untouched contour for D0; offsetting is iterative and keeps exact
  // straight/circular primitives, with intersections preserving tangency.
  if (distance === 0) return path;
  if (Math.abs(distance) <= TOL) throw new Error(`G71 stock allowance is below the geometric tolerance (${G71_JUNCTION_ROUNDING_TOLERANCE_MM} mm).`);
  const anchor = path[0];
  // Match g7x::add_distance's orientation-dependent allowance sign. With
  // LinuxCNC coordinates represented as z + i*x, imag(v1/v2) < 0 iff
  // cross(v1, v2) > 0.
  const first = sub(anchor.b, anchor.a);
  const span = sub(path.at(-1)!.a, anchor.a);
  const signedDistance = cross(first, span) > 0 ? -distance : distance;
  path.shift();
  let remaining = Math.abs(signedDistance);
  const sign = Math.sign(signedDistance);
  while (remaining > 0) {
    const step = Math.min(remaining, ...path.map((s) => radius(s) / 2));
    if (!(step > 0)) throw new Error('G71 D offset collapses the contour.');
    const amount = sign * step;
    const nextRemaining = remaining - step;
    if (nextRemaining === remaining) throw new Error('G71 D offset is below the representable geometry resolution.');
    remaining = nextRemaining;
    for (const s of path) offset(s, amount);
    for (let i = 0; i < path.length - 1; i += 1) {
      if (path[i].b.z - path[i + 1].a.z > 1e-2) {
        const prev = structuredClone(path[i]), next = structuredClone(path[i + 1]);
        offset(prev, -amount); offset(next, -amount);
        const center = mul(add(prev.b, next.a), 0.5);
        path.splice(i + 1, 0, { kind: 'arc', a: path[i].b, b: path[i + 1].a, c: center, ccw: signedDistance > 0, finish: 0, meta: path[i].meta });
        i += 1;
      }
    }
    for (let i = 0; i < path.length - 1; i += 1) {
      try { trimAdjacent(path[i], path[i + 1], machineScale); } catch (error) {
        throw new Error(`Offset junction at profile lines ${path[i].meta.sourceLine}/${path[i + 1].meta.sourceLine}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const segment = path[i];
      if (!monotonic(segment)) {
        const center = segment.kind === 'arc' ? `, center ${JSON.stringify(segment.c)}` : '';
        throw new Error(`G71 offset makes profile segment at source line ${segment.meta.sourceLine} non-monotonic; refusing to discard or reorder it (start ${JSON.stringify(segment.a)}, end ${JSON.stringify(segment.b)}${center}).`);
      }
      if (radius(path[i]) < 1e-3) throw new Error(`G71 offset collapses profile segment at source line ${path[i].meta.sourceLine}; refusing to discard it.`);
    }
  }
  for (let i = 0; i < path.length - 1; i += 1) {
    const gapMm = length(sub(path[i].b, path[i + 1].a)) / machineScale;
    if (gapMm > G71_JUNCTION_ROUNDING_TOLERANCE_MM) {
      throw new Error(`Offset junction gap ${gapMm.toFixed(6)} mm exceeds the ${G71_JUNCTION_ROUNDING_TOLERANCE_MM} mm rounding tolerance between profile lines ${path[i].meta.sourceLine}/${path[i + 1].meta.sourceLine}.`);
    }
  }
  anchor.b = path[0].a;
  path.unshift(anchor);
  return path;
}

function runPockets(path: Seg[], cycle: number, location: P, delta: number, retract: number, emit: Sink, levels: number[], pocketStarts: P[] = [{ ...location }], startIndex = 0): void {
  const top = pocketStarts.at(-1)!.x;
  let x = top, steps = 0, p = startIndex;
  if (cycle === 2) {
    for (; p < path.length; p += 1) if (dive(path[p], location, -1e9, emit, p === 0)) break;
    cycle = 3;
  }
  while (p < path.length) {
    while (x - TOL > location.x) { steps += 1; x = top - steps * delta; if (steps > G71_MAX_CUT_LEVELS) throw new Error(`G71 exceeds ${G71_MAX_CUT_LEVELS} cut levels.`); }
    if (dive(path[p], location, x, emit, p === 0)) {
      if (cycle === 1) {
        for (; p < path.length; p += 1) climbOnly(path[p], location, emit);
      } else {
        for (; p < path.length; p += 1) if (climb(path[p], location, emit)) {
          if (cycle === 3) {
            if (location.x > pocketStarts.at(-1)!.x + TOL && pocketStarts.length > 1) pocketStarts.pop();
            if (pocketStarts.length === 1) pocketStarts.push({ ...location });
          }
          runPockets(path, cycle, location, delta, retract, emit, levels, pocketStarts, p);
          return;
        }
      }
      return;
    }
    if (p === path.length - 1) return;
    if (Math.abs(location.x - x) > TOL || near(path[p].b, location)) { p += 1; continue; }
    let found = false;
    for (let ip = p; ip < path.length; ip += 1) {
      const is = intersectionsAtX(path[ip], location.x);
      if (!is.length) continue;
      const destination = ip !== p ? is[0] : is[is.length - 1];
      const distance = Math.abs(destination - location.z);
      if (destination - TOL > location.z) continue;
      if (distance < TOL) {
        if (ip === p) continue;
        if (near(location, path[ip].a)) { p = ip; found = true; break; }
        steps += 1; x = top - steps * delta; found = true; break;
      }
      const contact = { z: destination, x: location.x };
      emit('G01', contact, 'rough-cut', path[p].meta);
      levels.push(x);
      const esc = Math.min(1, distance / 2 / Math.max(retract, TOL));
      const diagonal = { z: retract * esc, x: retract * esc };
      emit('G00', add(contact, diagonal), 'pocket-retract', path[p].meta);
      // LinuxCNC retracts by subtracting the conjugate complex escape: Z
      // retreats while X moves farther away from the stock.
      emit('G00', sub(location, { z: diagonal.z, x: -diagonal.x }), 'pocket-retract', path[p].meta);
      emit(p === 0 ? 'G00' : 'G01', location, 'pocket-approach', path[p].meta);
      steps += 1; x = top - steps * delta; found = true; break;
    }
    if (!found) p += 1;
  }
}

function dive(s: Seg, location: P, x: number, emit: Sink, fast: boolean): boolean {
  if (s.kind === 'line') {
    if (s.a.x <= s.b.x + TOL) return true;
    if (x > s.a.x + TOL) return true;
    if (x < s.b.x) { emit(fast ? 'G00' : 'G01', s.b, 'rough-cut', s.meta); location.z = s.b.z; location.x = s.b.x; return false; }
    const is = intersectionsAtX(s, x);
    if (!is.length) throw new Error('G71 cannot intersect the profile at a cut level.');
    const ep = { z: is[0], x };
    emit(fast ? 'G00' : 'G01', ep, 'rough-cut', s.meta); location.z = ep.z; location.x = ep.x; return false;
  }
  if (near(location, s.b) || location.z - s.b.z <= TOL) { location.z = s.b.z; location.x = s.b.x; return false; }
  const arcRadius = length(sub(s.a, s.c));
  const radialMiss = Math.abs(x - s.c.x) - arcRadius;
  if (radialMiss > 0 && radialMiss <= TOL) {
    throw new Error(`G71 cut level has no exact arc intersection at source line ${s.meta.sourceLine} (radial gap ${radialMiss.toExponential(3)} normalized units).`);
  }
  const is = intersectionsAtX(s, x);
  if (s.ccw) {
    if (location.z - TOL > s.c.z) return true;
    if (!is.length || is.at(-1)! > s.c.z) { emit('G03', s.b, 'rough-cut', s.meta, s.c); Object.assign(location, s.b); }
    else { const ep = { z: is.at(-1)!, x }; emit('G03', ep, 'rough-cut', s.meta, s.c); Object.assign(location, ep); }
    return false;
  }
  if (location.z <= s.c.z + TOL) return true;
  if (!is.length) { emit('G02', s.b, 'rough-cut', s.meta, s.c); Object.assign(location, s.b); }
  else if (is[0] < s.c.z) return false;
  else { const ep = { z: is[0], x }; emit('G02', ep, 'rough-cut', s.meta, s.c); Object.assign(location, ep); }
  return false;
}

function climb(s: Seg, location: P, emit: Sink): boolean {
  if (s.kind === 'line') {
    if (s.b.x + TOL < s.a.x) return true;
    if (!near(location, s.a, 1e-3)) throw new Error('G71 contour climb is discontinuous.');
    emit('G01', s.b, 'profile-follow', s.meta); Object.assign(location, s.b); return false;
  }
  if (!s.ccw) {
    if (location.z > s.c.z + TOL) return true;
    if (!near(location, s.b, 1e-3)) emit('G02', s.b, 'profile-follow', s.meta, s.c);
    Object.assign(location, s.b); return false;
  }
  if (location.z < s.c.z - TOL) return true;
  const end = s.b.z < s.c.z ? { z: s.c.z, x: s.c.x + length(sub(s.a, s.c)) } : s.b;
  if (!near(location, end, 1e-3)) emit('G03', end, 'profile-follow', s.meta, s.c);
  Object.assign(location, end); return true;
}

function climbOnly(s: Seg, location: P, emit: Sink): void {
  const is = intersectionsAtX(s, location.x);
  if (!is.length) return;
  if (s.kind === 'line') {
    if (s.b.x + TOL < s.a.x) return;
    location.z = is[0]; emit('G01', location, 'profile-follow', s.meta); emit('G01', s.b, 'profile-follow', s.meta); Object.assign(location, s.b); return;
  }
  if (!s.ccw) {
    if (is.at(-1)! > s.c.z + TOL) return;
    location.z = is.at(-1)!; emit('G01', location, 'profile-follow', s.meta); if (!near(location, s.b, 1e-3)) emit('G02', s.b, 'profile-follow', s.meta, s.c); Object.assign(location, s.b); return;
  }
  if (is[0] < s.c.z - TOL) return;
  location.z = is[0]; emit('G01', location, 'profile-follow', s.meta);
  const end = s.b.z < s.c.z ? { z: s.c.z, x: s.c.x + length(sub(s.a, s.c)) } : s.b;
  if (!near(location, end, 1e-3)) emit('G03', end, 'profile-follow', s.meta, s.c); Object.assign(location, end);
}
