import { expandLinuxCncMacros, findLinuxCncSubroutine } from './linuxcncMacro';
import { expandLinuxCncG76 } from './linuxcncThread';
import { expandLinuxCncG70, expandLinuxCncG71 } from './linuxcncRoughing';
import { resolveLinuxCncProfile } from './linuxcncProfile';

export type ValidationStatus = 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'INVALID';
export type Vector3 = { x: number | null; y: number | null; z: number | null };
export type Motion = 'G00' | 'G01' | 'G02' | 'G03';
export type ModalState = {
  unit: 'mm' | 'inch' | null;
  distanceMode: 'absolute' | 'incremental' | null;
  motionMode: Motion | null;
  plane: 'XY' | 'XZ' | 'YZ' | null;
  position: Vector3;
  feed: number | null;
  spindle: number | null;
  tool: number | null;
};
export type ParseWarning = { id: string; sourceLine: number; code: string; message: string };
export type MotionSegment = {
  id: string;
  sourceLine: number;
  nBlock?: string;
  rawCode: string;
  motion: Motion;
  start: Vector3;
  end: Vector3;
  status: ValidationStatus;
  warningIds: string[];
  feed?: number;
  spindle?: number;
  tool?: number;
  unit: ModalState['unit'];
  distanceMode: ModalState['distanceMode'];
  plane: ModalState['plane'];
  /** Ordered XYZ tessellation coordinates, including start and end, for a source arc move. */
  vertices?: Float64Array;
};
export type ParseResult = {
  status: ValidationStatus;
  segments: MotionSegment[];
  warnings: ParseWarning[];
  finalState: ModalState;
};
export type ParserOptions = {
  controllerProfile?: 'generic' | 'linuxcnc';
  /** Explicit synthetic reference setup: zero-offset G54, zero-diameter/length tools, stationary M6, G8. */
  linuxcncPointToolReference?: boolean;
  initialPosition?: Vector3;
  initialUnit?: 'mm' | 'inch';
  initialDistanceMode?: 'absolute' | 'incremental';
  initialMotionMode?: 'G00' | 'G01';
};

type PlaneAxes = { u: 'x' | 'y' | 'z'; v: 'x' | 'y' | 'z'; cu: 'I' | 'J' | 'K'; cv: 'I' | 'J' | 'K'; out: 'x' | 'y' | 'z' };
// Right-handed plane coordinates viewed from each plane's positive normal.
const planeAxes: Record<NonNullable<ModalState['plane']>, PlaneAxes> = {
  XY: { u: 'x', v: 'y', cu: 'I', cv: 'J', out: 'z' },
  XZ: { u: 'z', v: 'x', cu: 'K', cv: 'I', out: 'y' },
  YZ: { u: 'y', v: 'z', cu: 'J', cv: 'K', out: 'x' },
};
const TAU = Math.PI * 2;
const ARC_MAX_SAGITTA_MM = 0.01;
const ARC_MAX_SEGMENTS = 100_000;
const ARC_MAX_TOTAL_VERTICES = 1_000_000;
const FLOAT32_MAX_OFFSET_MM = 0.01;
const normalizeAngle = (angle: number) => ((angle % TAU) + TAU) % TAU;

function solveArc(start: Vector3, end: Vector3, plane: NonNullable<ModalState['plane']>, clockwise: boolean,
  byLetter: Map<string, number[]>, scale: number) {
  const axes = planeAxes[plane];
  const su = start[axes.u]!, sv = start[axes.v]!, eu = end[axes.u]!, ev = end[axes.v]!;
  const hasR = byLetter.has('R');
  const hasOffsets = byLetter.has(axes.cu) || byLetter.has(axes.cv);
  const anyCenterWord = ['I', 'J', 'K'].some((word) => byLetter.has(word));
  if (hasR === hasOffsets || (anyCenterWord && ['I', 'J', 'K'].some((word) => byLetter.has(word) && word !== axes.cu && word !== axes.cv))) return null;
  if (hasR) {
    const signedR = byLetter.get('R')![0] * scale;
    const radius = Math.abs(signedR), du = eu - su, dv = ev - sv, chord = Math.hypot(du, dv);
    const tol = Math.max(1e-8, radius * 1e-8);
    // A full circle has no unique center in R notation. A semicircle has a unique midpoint center.
    if (!(radius > 0) || !(chord > tol) || chord > 2 * radius + tol) return null;
    if (Math.abs(chord - 2 * radius) <= 1e-12 * Math.max(radius, 1)) {
      return { centerU:(su+eu)/2, centerV:(sv+ev)/2, sweep:clockwise ? -Math.PI : Math.PI, radius, axes };
    }
    const h = Math.sqrt(Math.max(0, radius * radius - chord * chord / 4));
    const midU = (su + eu) / 2, midV = (sv + ev) / 2;
    const centers = [
      { u: midU - dv / chord * h, v: midV + du / chord * h },
      { u: midU + dv / chord * h, v: midV - du / chord * h },
    ];
    const candidates = centers.map((center) => {
      const a0 = Math.atan2(sv - center.v, su - center.u), a1 = Math.atan2(ev - center.v, eu - center.u);
      return { ...center, sweep: clockwise ? -normalizeAngle(a0 - a1) : normalizeAngle(a1 - a0) };
    });
    const wanted = candidates.filter((candidate) => signedR < 0 ? Math.abs(candidate.sweep) > Math.PI : Math.abs(candidate.sweep) < Math.PI);
    if (wanted.length !== 1) return null;
    return { centerU: wanted[0].u, centerV: wanted[0].v, sweep: wanted[0].sweep, radius, axes };
  }
  if (!byLetter.has(axes.cu) && !byLetter.has(axes.cv)) return null;
  const centerU = su + (byLetter.get(axes.cu)?.[0] ?? 0) * scale;
  const centerV = sv + (byLetter.get(axes.cv)?.[0] ?? 0) * scale;
  const r0 = Math.hypot(su - centerU, sv - centerV), r1 = Math.hypot(eu - centerU, ev - centerV);
  if (!(r0 > 0) || Math.abs(r0 - r1) > Math.max(1e-6, r0 * 1e-6)) return null;
  const a0 = Math.atan2(sv - centerV, su - centerU), a1 = Math.atan2(ev - centerV, eu - centerU);
  const fullCircle = su === eu && sv === ev;
  return { centerU, centerV, radius: r0, sweep: fullCircle ? (clockwise ? -TAU : TAU) : clockwise ? -normalizeAngle(a0 - a1) : normalizeAngle(a1 - a0), axes };
}

const unknownPosition = (): Vector3 => ({ x: null, y: null, z: null });
const finitePosition = (p: Vector3) => [p.x, p.y, p.z].every((v) => v !== null && Number.isFinite(v));
const float32Offset = (p: Vector3) => {
  const deltas = [p.x, p.y, p.z].map((v) =>
    v === null ? 0 : Number.isFinite(v) && Number.isFinite(Math.fround(v)) ? Math.fround(v) - v : Infinity,
  );
  return Math.hypot(...deltas);
};
const renderablePosition = (p: Vector3) => finitePosition(p) && float32Offset(p) <= FLOAT32_MAX_OFFSET_MM;
const precisionLossMessage = (offset: number) =>
  `Float32 conversion changes the 3D position by ${offset} mm, exceeding the ${FLOAT32_MAX_OFFSET_MM} mm Euclidean tolerance`;

function stripComments(line: string): string {
  let out = '';
  let inParen = false;
  for (const char of line) {
    if (char === '(') {
      if (inParen) throw new Error('Nested parenthesis comment');
      inParen = true;
    } else if (char === ')') {
      if (!inParen) throw new Error('Unmatched closing parenthesis');
      inParen = false;
    } else if (char === ';' && !inParen) {
      break;
    } else if (!inParen) {
      out += char;
    }
  }
  if (inParen) throw new Error('Unterminated parenthesis comment');
  return out;
}

function tokenize(line: string): Array<{ letter: string; value: number; raw: string }> {
  const tokens: Array<{ letter: string; value: number; raw: string }> = [];
  let i = 0;
  while (i < line.length) {
    if (/\s/.test(line[i])) { i += 1; continue; }
    const match = /^([A-Za-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/.exec(line.slice(i));
    if (!match) throw new Error(`Unexpected text at column ${i + 1}`);
    const value = Number(match[2]);
    if (!Number.isFinite(value)) throw new Error('Non-finite numeric value');
    tokens.push({ letter: match[1].toUpperCase(), value, raw: match[2] });
    i += match[0].length;
  }
  return tokens;
}

/** Parse a supported LinuxCNC macro expansion in execution order while preserving source rows. */
export function parseGcode(text: string, options: ParserOptions = {}): ParseResult {
  if (options.controllerProfile === 'linuxcnc' && /^\s*o\d+\s+(?:sub|call|while)\b/im.test(text)) {
    const expansion = expandLinuxCncMacros(text);
    if (expansion.status === 'SUPPORTED') {
      const result = parseCore(expansion.lines.map(line => line.text).join('\n'), options, text);
      for (const segment of result.segments) {
        const source = expansion.lines[segment.sourceLine - 1];
        if (source) { segment.sourceLine = source.sourceLine; segment.rawCode = source.sourceText; }
      }
      for (const warning of result.warnings) {
        const source = expansion.lines[warning.sourceLine - 1];
        if (source) warning.sourceLine = source.sourceLine;
      }
      return result;
    }
  }
  return parseCore(text, options);
}

/** Parses the modal G-code subset approved for the viewer. */
function parseCore(text: string, options: ParserOptions, originalSource = text): ParseResult {
  const segments: MotionSegment[] = [];
  const warnings: ParseWarning[] = [];
  const state: ModalState = {
    unit: options.initialUnit ?? null,
    distanceMode: options.initialDistanceMode ?? null,
    motionMode: options.initialMotionMode ?? null,
    plane: null,
    position: options.initialPosition ? { ...options.initialPosition } : unknownPosition(),
    feed: null,
    spindle: null,
    tool: null,
  };
  let status: ValidationStatus = 'SUPPORTED';
  let stopped = false;
  let spindleRunning = false;
  let cutterCompActive = false;
  const pointReference = options.controllerProfile === 'linuxcnc' && options.linuxcncPointToolReference === true;
  let latheRadiusMode = pointReference;
  const localOffset = {x:0,y:0,z:0};
  const toReference = (p:Vector3):Vector3 => ({x:p.x === null ? null : p.x+localOffset.x, y:p.y === null ? null : p.y+localOffset.y, z:p.z === null ? null : p.z+localOffset.z});
  let programEndIndex: number | null = null;
  const warn = (sourceLine: number, code: string, message: string) => {
    const id = `warning-${sourceLine}-${warnings.length}`;
    warnings.push({ id, sourceLine, code, message });
    return id;
  };
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (Object.values(state.position).some((value) => value !== null && (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))))) {
    warn(1, 'INVALID_INITIAL_POSITION', 'Initial coordinates must be finite Float32-representable numbers or null');
    state.position = unknownPosition();
    return { status: 'INVALID', segments, warnings, finalState: state };
  }
  const initialOffset = float32Offset(state.position);
  if (initialOffset > FLOAT32_MAX_OFFSET_MM) {
    warn(1, 'FLOAT32_PRECISION_LOSS', precisionLossMessage(initialOffset));
    state.position = unknownPosition();
    return { status: 'INVALID', segments, warnings, finalState: state };
  }

  let totalArcVertices = 0;
  for (let index = 0; index < lines.length && !stopped; index += 1) {
    const sourceLine = index + 1;
    const rawCode = lines[index];
    if (rawCode.trim() === '%') continue;
    let tokens: ReturnType<typeof tokenize>;
    try {
      const code = stripComments(rawCode);
      if (['#', '[', ']'].some(character => code.includes(character)) || /\bO\s*(?:<[^>]*>|\d+)\s+(?:SUB|ENDSUB|CALL|IF|ELSE|ENDIF|WHILE|ENDWHILE|REPEAT|ENDREPEAT|DO|BREAK|CONTINUE|RETURN)\b/i.test(code) || /\bO\s*</i.test(code) || /\b(?:IF|WHILE|GOTO|ENDWHILE)\b/i.test(code)) {
        warn(sourceLine, 'UNSUPPORTED_MACRO', 'Macro or subroutine syntax is unsupported; interpretation stopped here');
        status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
      }
      tokens = tokenize(code);
    } catch (error) {
      warn(sourceLine, 'LEXICAL_ERROR', error instanceof Error ? error.message : 'Invalid block');
      status = 'INVALID'; stopped = true; break;
    }
    if (tokens.length === 0) continue;

    const byLetter = new Map<string, number[]>();
    for (const token of tokens) byLetter.set(token.letter, [...(byLetter.get(token.letter) ?? []), token.value]);
    const singleton = ['N', 'X', 'Y', 'Z', 'F', 'S', 'T', 'I', 'J', 'K', 'R'];
    if (singleton.some((letter) => (byLetter.get(letter)?.length ?? 0) > 1)) {
      warn(sourceLine, 'DUPLICATE_WORD', 'Duplicate word in block'); status = 'INVALID'; stopped = true; break;
    }
    const gWords = byLetter.get('G') ?? [];
    const mWords = byLetter.get('M') ?? [];
    if (gWords.some((g, i) => gWords.indexOf(g) !== i) || mWords.length > 1) {
      warn(sourceLine, 'DUPLICATE_MODAL_WORD', 'Duplicate G or M word'); status = 'INVALID'; stopped = true; break;
    }
    const linuxcnc = options.controllerProfile === 'linuxcnc';
    const knownLetters = new Set(['N', 'G', 'M', 'X', 'Y', 'Z', 'F', 'S', 'T', 'I', 'J', 'K', 'R']);
    const pathControl = linuxcnc && gWords.includes(64);
    const dwell = linuxcnc && gWords.includes(4);
    const thread = linuxcnc && gWords.includes(76);
    const rough = pointReference && (gWords.includes(71.1) || gWords.includes(71.2));
    const finish = pointReference && gWords.includes(70);
    if (pathControl || dwell) knownLetters.add('P');
    if (pathControl) knownLetters.add('Q');
    if (thread) for (const letter of ['P','Q','H','E','L','D']) knownLetters.add(letter);
    if (rough) for (const letter of ['Q','D']) knownLetters.add(letter);
    if (finish) for (const letter of ['Q','D','E','P']) knownLetters.add(letter);
    const unsupportedLetter = tokens.find((t) => !knownLetters.has(t.letter));
    if (unsupportedLetter || byLetter.has('M') && mWords.some((m) => !(linuxcnc ? [2, 3, 4, 5, 30, ...(pointReference ? [6] : [])] : [2, 30]).includes(m))) {
      warn(sourceLine, 'UNSUPPORTED_BLOCK', 'Unsupported word or machine command; interpretation stopped here');
      status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
    }

    const supportedG = new Set([0, 1, 2, 3, 17, 18, 19, 20, 21, 90, 91, ...(linuxcnc ? [4, 8, 61, 61.1, 64, 76] : []), ...(pointReference ? [40, 41, 42, 43, 49, 54, 70, 71.1, 71.2, 92, 92.1] : [])]);
    const badG = gWords.find((g) => !supportedG.has(g));
    if (badG !== undefined) {
      warn(sourceLine, 'UNSUPPORTED_GCODE', `G${badG} is outside the supported profile; interpretation stopped here`);
      status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
    }
    const conflicts = [
      [0, 1, 2, 3, 70, 71.1, 71.2, 76], [90, 91], [20, 21], [17, 18, 19], [61, 61.1, 64], [40,41,42], [43,49], [92,92.1],
    ].some((group) => group.filter((g) => gWords.includes(g)).length > 1);
    if (conflicts) {
      warn(sourceLine, 'CONFLICTING_MODAL', 'Conflicting modal groups in one block'); status = 'INVALID'; stopped = true; break;
    }
    if (pointReference && ((cutterCompActive && gWords.some(g=>[41,42,54,70,71.1,71.2,92,92.1].includes(g))) || ((gWords.includes(41) || gWords.includes(42)) && gWords.some(g=>[54,70,71.1,71.2,92,92.1].includes(g))))) {
      warn(sourceLine,'INVALID_CUTTER_COMP','Coordinate or G71 changes are not supported while cutter compensation is active');status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;
    }
    if ((pathControl || dwell) && (['P', 'Q'].some(letter => (byLetter.get(letter)?.length ?? 0) > 1 || (byLetter.get(letter)?.[0] ?? 0) < 0) || (dwell && (!byLetter.has('P') || pathControl || ['X','Y','Z','I','J','K','R'].some(letter => byLetter.has(letter)) || gWords.some(g => [0,1,2,3].includes(g)))) || (pathControl && ((byLetter.has('Q') && !byLetter.has('P')) || ((byLetter.has('P') || byLetter.has('Q')) && ['X','Y','Z','I','J','K','R'].some(letter => byLetter.has(letter))))))) {
      warn(sourceLine, 'INVALID_PATH_CONTROL', 'Invalid path control or dwell parameters'); status = 'INVALID'; stopped = true; break;
    }

    const blockStartState: ModalState = { ...state, position: { ...state.position } };
    // Modal words are applied before coordinates in their own block.
    if (gWords.includes(20)) state.unit = 'inch';
    if (gWords.includes(21)) state.unit = 'mm';
    if (gWords.includes(90)) state.distanceMode = 'absolute';
    if (gWords.includes(91)) state.distanceMode = 'incremental';
    if (gWords.includes(0)) state.motionMode = 'G00';
    if (gWords.includes(1)) state.motionMode = 'G01';
    if (gWords.includes(2)) state.motionMode = 'G02';
    if (gWords.includes(3)) state.motionMode = 'G03';
    if (gWords.includes(17)) state.plane = 'XY';
    if (gWords.includes(18)) state.plane = 'XZ';
    if (gWords.includes(19)) state.plane = 'YZ';
    if (gWords.includes(8)) latheRadiusMode = true;
    if (pointReference && gWords.includes(40)) cutterCompActive = false;
    if (pointReference && (gWords.includes(41) || gWords.includes(42))) cutterCompActive = true;
    if (mWords.includes(3) || mWords.includes(4)) spindleRunning = true;
    if (mWords.includes(5)) spindleRunning = false;
    if (mWords.includes(6)) spindleRunning = false;

    const scale = state.unit === 'inch' ? 25.4 : 1;
    if (byLetter.has('F')) {
      if (state.unit === null) {
        state.feed = null;
        warn(sourceLine, 'UNKNOWN_FEED_UNIT', 'Feed is not retained because its unit is unknown');
        status = 'PARTIAL';
      } else {
        const feed = byLetter.get('F')![0] * scale;
        if (!Number.isFinite(feed)) {
          warn(sourceLine, 'CALCULATION_OVERFLOW', 'Feed conversion overflowed');
          Object.assign(state, blockStartState); status = 'INVALID'; stopped = true; break;
        }
        state.feed = feed;
      }
    }
    if (byLetter.has('S')) state.spindle = byLetter.get('S')![0];
    if (byLetter.has('T')) state.tool = byLetter.get('T')![0];

    if (pointReference && (gWords.includes(92) || gWords.includes(92.1))) {
      if (gWords.some(g=>[0,1,2,3,70,71.1,71.2,76].includes(g)) || mWords.length || (gWords.includes(92.1) && ['X','Y','Z'].some(axis=>byLetter.has(axis))) || (gWords.includes(92) && (!state.unit || !['X','Y','Z'].some(axis=>byLetter.has(axis))))) {
        warn(sourceLine,'INVALID_G92','G92 needs known units and at least one axis; G92.1 must not contain axis words'); Object.assign(state,blockStartState); status='INVALID';stopped=true;break;
      }
      for (const axis of ['x','y','z'] as const) {
        const word=byLetter.get(axis.toUpperCase())?.[0];
        const current=state.position[axis];
        if (gWords.includes(92) && word !== undefined) {
          if (current === null) {warn(sourceLine,'UNKNOWN_G92_POSITION','G92 requires a known current coordinate'); Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
          const desired=word*scale, nextOffset=localOffset[axis]+current-desired;
          if (!Number.isFinite(desired) || !Number.isFinite(nextOffset)) {warn(sourceLine,'CALCULATION_OVERFLOW','G92 coordinate or offset is not finite');Object.assign(state,blockStartState);status='INVALID';stopped=true;break;}
          localOffset[axis]=nextOffset; state.position[axis]=desired;
        } else if (gWords.includes(92.1)) {
          if (current !== null) state.position[axis]=current+localOffset[axis];
          localOffset[axis]=0;
        }
      }
      if(stopped)break;
      continue;
    }

    if (finish || rough) {
      const words=finish ? ['Q','X','Z','D','E','P'] : ['Q','X','Z','D','I','R'];
      const q=byLetter.get('Q')?.[0];
      if (state.plane !== 'XZ' || state.unit !== 'mm' || state.distanceMode !== 'absolute' || !latheRadiusMode || !renderablePosition(state.position) || mWords.length || (finish && gWords.length!==1) || q === undefined || !Number.isInteger(q) || q < 1 || words.some(letter=>(byLetter.get(letter)?.length ?? 0)>1) || byLetter.has('Y') || (finish && ['I','J','K','R'].some(letter=>byLetter.has(letter)))) {
        warn(sourceLine,finish?'INVALID_G70_SETUP':'INVALID_G71_SETUP','G70/G71 requires the point-tool reference, G8/G18/G21/G90, a known position and a numbered Q profile');Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;
      }
      const routine=findLinuxCncSubroutine(originalSource,q);
      if(!routine){warn(sourceLine,finish?'UNKNOWN_G70_PROFILE':'UNKNOWN_G71_PROFILE',`Subroutine O${q} is not defined`);Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
      const target={x:byLetter.get('X')?.[0] ?? state.position.x!,z:byLetter.get('Z')?.[0] ?? state.position.z!};
      const profile=resolveLinuxCncProfile(routine,target);
      if(!profile.ok){warn(sourceLine,finish?'UNSUPPORTED_G70_PROFILE':'UNSUPPORTED_G71_PROFILE',`Profile line ${profile.sourceLine}: ${profile.message}`);Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
      const common={position:{x:state.position.x!,z:state.position.z!},X:target.x,Z:target.z,profile:profile.profile,units:'mm' as const,D:byLetter.get('D')?.[0],sourceLine,rawCode};
      const result=finish ? expandLinuxCncG70({...common,E:byLetter.get('E')?.[0],P:byLetter.get('P')?.[0]}) : expandLinuxCncG71({...common,cycle:gWords.includes(71.2)?'G71.2':'G71.1',I:byLetter.get('I')?.[0],R:byLetter.get('R')?.[0]});
      if(!result.ok){warn(sourceLine,result.error.code,`${finish?'G70':'G71'} 경로를 정확히 확인할 수 없어 이 구간을 그리지 않았습니다. ${result.error.message}`);Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
      const prepared:MotionSegment[]=[];let addedVertices=0;
      for(const [index,move] of result.moves.entries()){
        const start=toReference({x:move.start.x,y:state.position.y,z:move.start.z}),end=toReference({x:move.end.x,y:state.position.y,z:move.end.z});
        if(!renderablePosition(start)||!renderablePosition(end)){warn(sourceLine,'FLOAT32_PRECISION_LOSS','G70/G71 coordinates exceed display precision');status='INVALID';stopped=true;break;}
        if(!move.center && move.end.x===move.start.x && move.end.z===move.start.z)continue;
        let vertices:Float64Array | undefined;
        if(move.center){
          const su=move.start.z-move.center.z,sv=move.start.x-move.center.x,eu=move.end.z-move.center.z,ev=move.end.x-move.center.x;
          const radius=Math.hypot(su,sv),endRadius=Math.hypot(eu,ev);
          if(!(radius>0)||Math.abs(radius-endRadius)>.001){warn(sourceLine,finish?'INVALID_G70_ARC':'INVALID_G71_ARC','G70/G71 generated an inconsistent arc');status='INVALID';stopped=true;break;}
          const a0=Math.atan2(sv,su),a1=Math.atan2(ev,eu),sweep=move.motion==='G02'?-normalizeAngle(a0-a1):normalizeAngle(a1-a0);
          if(Math.abs(sweep)<1e-12){warn(sourceLine,finish?'INVALID_G70_ARC':'INVALID_G71_ARC','G70/G71 produced an ambiguous zero-sweep arc');status='INVALID';stopped=true;break;}
          const sagittaRatio=Math.min(1,ARC_MAX_SAGITTA_MM/radius),step=Math.min(Math.PI/36,2*Math.asin(Math.sqrt(sagittaRatio*(2-sagittaRatio))/2));
          const count=Math.max(1,Math.ceil(Math.abs(sweep)/step));addedVertices+=count+1;
          if(count>ARC_MAX_SEGMENTS || totalArcVertices+addedVertices>ARC_MAX_TOTAL_VERTICES){warn(sourceLine,'ARC_VERTEX_BUDGET','G70/G71 arc tessellation exceeds the vertex budget');status='INVALID';stopped=true;break;}
          vertices=new Float64Array((count+1)*3);
          for(let i=0;i<=count;i++){const angle=a0+sweep*i/count;const point=toReference({x:i===count?move.end.x:move.center.x+radius*Math.sin(angle),y:state.position.y,z:i===count?move.end.z:move.center.z+radius*Math.cos(angle)});if(!renderablePosition(point)){warn(sourceLine,'FLOAT32_PRECISION_LOSS','G70/G71 arc exceeds display precision');status='INVALID';stopped=true;break;}vertices.set([point.x!,point.y!,point.z!],i*3);}
          if(stopped)break;
        }
        prepared.push({id:`line-${sourceLine}-segment-${index}`,sourceLine,rawCode,motion:move.motion,start,end,...(vertices?{vertices}:{}),unit:state.unit,distanceMode:state.distanceMode,plane:state.plane,status:'SUPPORTED',warningIds:[],...(state.feed!==null?{feed:state.feed}:{}),...(state.tool!==null?{tool:state.tool}:{})});
      }
      if(stopped){Object.assign(state,blockStartState);break;}
      segments.push(...prepared);totalArcVertices+=addedVertices;state.position={...state.position,x:result.finalPosition.x,z:result.finalPosition.z};state.motionMode=null;continue;
    }

    if (thread) {
      const required = ['P','Z','I','J','K'];
      const words = ['P','Z','I','J','K','R','Q','H','E','L','D'];
      if (!latheRadiusMode || state.plane !== 'XZ' || state.unit === null || state.distanceMode === null || !renderablePosition(state.position) || !spindleRunning || mWords.length > 0 || required.some(letter=>!byLetter.has(letter)) || words.some(letter=>(byLetter.get(letter)?.length ?? 0)>1) || ['X','Y'].some(letter=>byLetter.has(letter))) {
        warn(sourceLine, 'INVALID_THREAD_SETUP', 'G76 requires G8 radius mode, G18, known position/unit/distance, running spindle, and P Z I J K');
        Object.assign(state, blockStartState); status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
      }
      const value = (letter:string) => byLetter.get(letter)?.[0];
      const start = { x:state.position.x! / scale, y:state.position.y! / scale, z:state.position.z! / scale };
      const z = value('Z')!;
      const result = expandLinuxCncG76({sourceLine, rawCode, units:state.unit, start, endZ:state.distanceMode === 'absolute' ? z : start.z + z, P:value('P')!, I:value('I')!, J:value('J')!, K:value('K')!, R:value('R'), Q:value('Q'), H:value('H'), E:value('E'), L:value('L'), D:value('D')});
      if (!result.ok) {
        warn(sourceLine, result.error.code, result.error.message); Object.assign(state, blockStartState); status = 'INVALID'; stopped = true; break;
      }
      if (result.moves.some(move => !renderablePosition(toReference(move.start)) || !renderablePosition(toReference(move.end)))) {
        warn(sourceLine, 'FLOAT32_PRECISION_LOSS', 'G76 coordinates exceed the supported display precision'); Object.assign(state, blockStartState); status = 'INVALID'; stopped = true; break;
      }
      for (const [index, move] of result.moves.entries()) {
        if (move.start.x !== move.end.x || move.start.y !== move.end.y || move.start.z !== move.end.z) segments.push({id:`line-${sourceLine}-segment-${index}`, sourceLine, ...(byLetter.has('N') ? {nBlock:String(byLetter.get('N')![0])} : {}), rawCode, motion:move.motion, start:toReference(move.start), end:toReference(move.end), unit:state.unit, distanceMode:state.distanceMode, plane:state.plane, status:'SUPPORTED', warningIds:[], ...(state.feed !== null ? {feed:state.feed} : {}), ...(state.spindle !== null ? {spindle:state.spindle} : {}), ...(state.tool !== null ? {tool:state.tool} : {})});
      }
      state.position = result.finalPosition;
      state.motionMode = null;
      continue;
    }

    const axes = ['X', 'Y', 'Z'] as const;
    const hasAxis = axes.some((axis) => byLetter.has(axis));
    const hasArcParams = ['I', 'J', 'K', 'R'].some((letter) => byLetter.has(letter));
    const arcMotion = state.motionMode === 'G02' || state.motionMode === 'G03';
    if (hasArcParams && !arcMotion || arcMotion && (hasAxis || hasArcParams) && state.plane === null) {
      warn(sourceLine, hasArcParams && !arcMotion ? 'UNSUPPORTED_ARC' : 'UNKNOWN_ARC_PLANE', hasArcParams && !arcMotion ? 'Arc parameters require G02/G03' : 'G17/G18/G19 must be explicitly selected before an arc');
      status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
    }

    if (hasAxis || arcMotion && hasArcParams) {
      if (state.unit === null || state.distanceMode === null || state.motionMode === null) {
        warn(sourceLine, 'UNKNOWN_MODAL_STATE', 'Unit, distance mode, or motion mode is unknown; position cannot be interpreted');
        status = segments.length ? 'PARTIAL' : 'UNSUPPORTED';
        // Do not let later modal declarations bridge over an untracked move.
        state.position = unknownPosition();
        stopped = true;
        break;
      }
      if (arcMotion && !renderablePosition(state.position)) {
        warn(sourceLine, 'UNKNOWN_ARC_START', 'Arc requires a fully known starting position');
        status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; state.position = unknownPosition(); break;
      }
      const start = { ...state.position };
      const end = { ...state.position };
      let overflow = false;
      for (const axis of axes) {
        const raw = byLetter.get(axis)?.[0];
        if (raw === undefined) continue;
        const value = raw * scale;
        const coordinate = state.distanceMode === 'absolute'
          ? value
          : (start[axis.toLowerCase() as 'x' | 'y' | 'z'] === null ? null : start[axis.toLowerCase() as 'x' | 'y' | 'z']! + value);
        if (coordinate !== null && (!Number.isFinite(coordinate) || !Number.isFinite(Math.fround(coordinate)))) overflow = true;
        end[axis.toLowerCase() as 'x' | 'y' | 'z'] = coordinate;
      }
      if (overflow) {
        warn(sourceLine, 'CALCULATION_OVERFLOW', 'Coordinate conversion or accumulation overflowed the supported Float32 range');
        Object.assign(state, blockStartState);
        status = 'INVALID'; stopped = true; break;
      }
      const referenceStart = toReference(start), referenceEnd = toReference(end);
      const endOffset = float32Offset(referenceEnd);
      if (!arcMotion && endOffset > FLOAT32_MAX_OFFSET_MM) {
        warn(sourceLine, 'FLOAT32_PRECISION_LOSS', precisionLossMessage(endOffset));
        Object.assign(state, blockStartState);
        state.position = unknownPosition();
        status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
      }
      if (arcMotion) {
        const arc = solveArc(start, end, state.plane!, state.motionMode === 'G02', byLetter, scale);
        if (!arc) {
          warn(sourceLine, 'INVALID_ARC_GEOMETRY', 'Arc center/radius is ambiguous or inconsistent with its endpoints');
          Object.assign(state, blockStartState); status = 'INVALID'; stopped = true; break;
        }
        const sagittaRatio = Math.min(1, ARC_MAX_SAGITTA_MM / arc.radius);
        const sagittaStep = 2 * Math.asin(Math.sqrt(sagittaRatio * (2 - sagittaRatio)) / 2);
        const maxStep = Math.min(Math.PI / 36, sagittaStep);
        const count = Math.max(1, Math.ceil(Math.abs(arc.sweep) / maxStep));
        if (!Number.isFinite(count) || count > ARC_MAX_SEGMENTS) {
          warn(sourceLine, 'ARC_TESSELLATION_LIMIT', `Arc requires more than ${ARC_MAX_SEGMENTS} vertices to stay within ${ARC_MAX_SAGITTA_MM} mm sagitta tolerance`);
          Object.assign(state, blockStartState); status = 'INVALID'; stopped = true; break;
        }
        const arcVertexCount = count + 1;
        if (totalArcVertices + arcVertexCount > ARC_MAX_TOTAL_VERTICES) {
          warn(sourceLine, 'ARC_VERTEX_BUDGET', `Arc would exceed the cumulative ${ARC_MAX_TOTAL_VERTICES} vertex budget; parsing stopped to limit memory use`);
          Object.assign(state, blockStartState);
          state.position = unknownPosition();
          status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
        }
        if (endOffset > FLOAT32_MAX_OFFSET_MM) {
          warn(sourceLine, 'FLOAT32_PRECISION_LOSS', precisionLossMessage(endOffset));
          Object.assign(state, blockStartState);
          state.position = unknownPosition();
          status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
        }
        const vertices = new Float64Array((count + 1) * 3);
        for (let i = 0; i <= count; i += 1) {
          const fraction = i / count, angle = Math.atan2(start[arc.axes.v]! - arc.centerV, start[arc.axes.u]! - arc.centerU) + arc.sweep * fraction;
          const point = { ...start };
          point[arc.axes.u] = i === count ? end[arc.axes.u] : arc.centerU + arc.radius * Math.cos(angle);
          point[arc.axes.v] = i === count ? end[arc.axes.v] : arc.centerV + arc.radius * Math.sin(angle);
          point[arc.axes.out] = start[arc.axes.out]! + (end[arc.axes.out]! - start[arc.axes.out]!) * fraction;
          const referencePoint = toReference(point);
          const pointOffset = float32Offset(referencePoint);
          if (!renderablePosition(referencePoint)) {
            if (pointOffset > FLOAT32_MAX_OFFSET_MM && Number.isFinite(pointOffset)) {
              warn(sourceLine, 'FLOAT32_PRECISION_LOSS', precisionLossMessage(pointOffset));
              Object.assign(state, blockStartState);
              state.position = unknownPosition();
              status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
            }
            warn(sourceLine, 'CALCULATION_OVERFLOW', 'Arc tessellation exceeded the supported Float32 range');
            Object.assign(state, blockStartState); status = 'INVALID'; stopped = true; break;
          }
          vertices[i * 3] = referencePoint.x!;
          vertices[i * 3 + 1] = referencePoint.y!;
          vertices[i * 3 + 2] = referencePoint.z!;
        }
        if (stopped) break;
        totalArcVertices += arcVertexCount;
        state.position = end;
        segments.push({ id: `line-${sourceLine}-segment-0`, sourceLine, ...(byLetter.has('N') ? { nBlock: String(byLetter.get('N')![0]) } : {}), rawCode, motion: state.motionMode, start:referenceStart, end:referenceEnd, vertices, unit: state.unit, distanceMode: state.distanceMode, plane: state.plane, status: 'SUPPORTED', warningIds: [], ...(state.feed !== null ? { feed: state.feed } : {}), ...(state.spindle !== null ? { spindle: state.spindle } : {}), ...(state.tool !== null ? { tool: state.tool } : {}) });
        if (mWords.includes(2) || mWords.includes(30)) { programEndIndex = index; stopped = true; }
        continue;
      }
      state.position = end;
      if (renderablePosition(referenceStart) && renderablePosition(referenceEnd)) {
        if (start.x !== end.x || start.y !== end.y || start.z !== end.z) {
          segments.push({ id: `line-${sourceLine}-segment-0`, sourceLine, ...(byLetter.has('N') ? { nBlock: String(byLetter.get('N')![0]) } : {}), rawCode, motion: state.motionMode, start:referenceStart, end:referenceEnd, unit: state.unit, distanceMode: state.distanceMode, plane: state.plane, status: 'SUPPORTED', warningIds: [], ...(state.feed !== null ? { feed: state.feed } : {}), ...(state.spindle !== null ? { spindle: state.spindle } : {}), ...(state.tool !== null ? { tool: state.tool } : {}) });
        }
      } else {
        warn(sourceLine, 'POSITION_UNKNOWN', 'Position is not fully known; no line segment was emitted');
        status = 'PARTIAL';
      }
    }
    if (mWords.includes(2) || mWords.includes(30)) {
      programEndIndex = index;
      stopped = true;
    }
  }
  if (programEndIndex !== null) {
    for (let index = programEndIndex + 1; index < lines.length; index += 1) {
      if (lines[index].trim() === '%') continue;
      let hasCode: boolean;
      try {
        hasCode = stripComments(lines[index]).trim().length > 0;
      } catch {
        // After the program end, malformed or ambiguous text still deserves a diagnostic.
        hasCode = lines[index].trim().length > 0;
      }
      if (!hasCode) continue;
      warn(index + 1, 'CODE_AFTER_PROGRAM_END', 'Code after M2/M30 is ignored');
      status = 'PARTIAL';
      break;
    }
  }
  if (stopped && status !== 'SUPPORTED' && programEndIndex === null) state.position = unknownPosition();
  return { status, segments, warnings, finalState: state };
}
