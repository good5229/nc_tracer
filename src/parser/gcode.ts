import { expandLinuxCncMacros, findLinuxCncSubroutine } from './linuxcncMacro';
import { expandLinuxCncG76 } from './linuxcncThread';
import { expandLinuxCncG70, expandLinuxCncG71 } from './linuxcncRoughing';
import { resolveLinuxCncProfile } from './linuxcncProfile';
import {linuxCncLatheNoseEntry, linuxCncLatheNoseLines, type LatheInputMove, type LatheNosePoint} from './linuxcncLatheNose';

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
  /** Explicit machine-mm tool table; tool length offsets must be zero in this profile. */
  linuxcncLatheToolReference?: { tools: Record<string,{diameter:number;orientation:number;offsetX:number;offsetZ:number}> };
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
  const latheTools=options.controllerProfile==='linuxcnc'?options.linuxcncLatheToolReference:undefined;
  const pointReference = options.controllerProfile === 'linuxcnc' && (options.linuxcncPointToolReference === true || latheTools!==undefined);
  let loadedTool:number|null=null;
  const motionTool=()=>latheTools?loadedTool:state.tool;
  let latheComp:{start:LatheNosePoint;side:'left'|'right';diameter:number;orientation:number;moves:LatheInputMove[];metadata:Map<number,{rawCode:string;feed:number|null;spindle:number|null;tool:number|null;distanceMode:ModalState['distanceMode']}>}|null=null;
  let pendingCompExit:LatheNosePoint|null=null;
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
  if(latheTools && (options.linuxcncPointToolReference || !latheTools.tools || typeof latheTools.tools!=='object')){warn(1,'INVALID_LATHE_REFERENCE','점 공구와 실제 공구표 설정을 함께 사용하거나 공구표를 생략할 수 없습니다.');return {status:'INVALID',segments,warnings,finalState:state};}
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
  const flushLatheComp = (current:NonNullable<typeof latheComp>, cancelLine:number):boolean => {
    if(!current.moves.length)return true;
    const calculated=linuxCncLatheNoseLines(current.start,current.moves,current.diameter,current.side,current.orientation);
    if(!calculated.ok){warn(calculated.sourceLine,calculated.code,'선반 공구 보정 경로를 정확히 해석하지 못해 중단했습니다.');status=segments.length?'PARTIAL':'UNSUPPORTED';return false;}
    const prepared:MotionSegment[]=[];let added=0;
    for(const [i,move] of calculated.moves.entries()){
      const metadata=current.metadata.get(move.sourceLine);
      if(!metadata){warn(cancelLine,'LATHE_COMP_METADATA','공구 보정 원본 행을 확인할 수 없습니다.');status='INVALID';return false;}
      const y=state.position.y, start=toReference({x:move.start.x,y,z:move.start.z}),end=toReference({x:move.end.x,y,z:move.end.z});
      if(!renderablePosition(start)||!renderablePosition(end)){warn(move.sourceLine,'FLOAT32_PRECISION_LOSS','공구 보정 좌표가 표시 정밀도 범위를 벗어났습니다.');status='INVALID';return false;}
      let vertices:Float64Array|undefined;
      if(move.center){
        const su=move.start.z-move.center.z,sv=move.start.x-move.center.x,eu=move.end.z-move.center.z,ev=move.end.x-move.center.x,radius=Math.hypot(su,sv);
        if(!(radius>0)||Math.abs(radius-Math.hypot(eu,ev))>1e-8*Math.max(1,radius)){warn(move.sourceLine,'INVALID_COMP_ARC','공구 보정 원호의 반경을 확인할 수 없습니다.');status='INVALID';return false;}
        const a0=Math.atan2(sv,su),a1=Math.atan2(ev,eu),full=move.start.x===move.end.x&&move.start.z===move.end.z;
        const sweep=move.motion==='G02'?(full?-TAU:-normalizeAngle(a0-a1)):(full?TAU:normalizeAngle(a1-a0));
        const ratio=Math.min(1,ARC_MAX_SAGITTA_MM/radius),step=Math.min(Math.PI/36,2*Math.asin(Math.sqrt(ratio*(2-ratio))/2)),count=Math.max(1,Math.ceil(Math.abs(sweep)/step));
        added+=count+1;if(!Number.isFinite(count)||count>ARC_MAX_SEGMENTS||totalArcVertices+added>ARC_MAX_TOTAL_VERTICES){warn(move.sourceLine,'ARC_VERTEX_BUDGET','공구 보정 원호의 계산 범위를 초과했습니다.');status='INVALID';return false;}
        vertices=new Float64Array((count+1)*3);
        for(let j=0;j<=count;j++){const angle=a0+sweep*j/count,point=toReference({x:j===count?move.end.x:move.center.x+radius*Math.sin(angle),y,z:j===count?move.end.z:move.center.z+radius*Math.cos(angle)});if(!renderablePosition(point)){warn(move.sourceLine,'FLOAT32_PRECISION_LOSS','공구 보정 원호가 표시 정밀도 범위를 벗어났습니다.');status='INVALID';return false;}vertices.set([point.x!,point.y!,point.z!],j*3);}
      }
      prepared.push({id:`line-${move.sourceLine}-comp-${i}`,sourceLine:move.sourceLine,rawCode:metadata.rawCode,motion:move.motion,start,end,...(vertices?{vertices}:{}),unit:state.unit,distanceMode:metadata.distanceMode,plane:'XZ',status:'SUPPORTED',warningIds:[],...(metadata.feed!==null?{feed:metadata.feed}:{}),...(metadata.spindle!==null?{spindle:metadata.spindle}:{}),...(metadata.tool!==null?{tool:metadata.tool}:{})});
    }
    segments.push(...prepared);totalArcVertices+=added;pendingCompExit={...calculated.moves.at(-1)!.end};return true;
  };
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
    const enableLatheComp=!!latheTools && gWords.some(g=>[41,42,41.1,42.1].includes(g));
    if (pathControl || dwell) knownLetters.add('P');
    if (pathControl) knownLetters.add('Q');
    if (thread) for (const letter of ['P','Q','H','E','L','D']) knownLetters.add(letter);
    if (rough) for (const letter of ['Q','D']) knownLetters.add(letter);
    if (finish) for (const letter of ['Q','D','E','P']) knownLetters.add(letter);
    if (enableLatheComp) for(const letter of ['D','L']) knownLetters.add(letter);
    const unsupportedLetter = tokens.find((t) => !knownLetters.has(t.letter));
    if (unsupportedLetter || byLetter.has('M') && mWords.some((m) => !(linuxcnc ? [2, 3, 4, 5, 30, ...(pointReference ? [6] : [])] : [2, 30]).includes(m))) {
      warn(sourceLine, 'UNSUPPORTED_BLOCK', 'Unsupported word or machine command; interpretation stopped here');
      status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
    }

    const supportedG = new Set([0, 1, 2, 3, 17, 18, 19, 20, 21, 90, 91, ...(linuxcnc ? [4, 8, 61, 61.1, 64, 76] : []), ...(pointReference ? [40, 41, 42, 43, 49, 54, 70, 71.1, 71.2, 92, 92.1] : []), ...(latheTools ? [41.1,42.1] : [])]);
    const badG = gWords.find((g) => !supportedG.has(g));
    if (badG !== undefined) {
      warn(sourceLine, 'UNSUPPORTED_GCODE', `G${badG} is outside the supported profile; interpretation stopped here`);
      status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
    }
    const conflicts = [
      [0, 1, 2, 3, 70, 71.1, 71.2, 76], [90, 91], [20, 21], [17, 18, 19], [61, 61.1, 64], [40,41,42,41.1,42.1], [43,49], [92,92.1],
    ].some((group) => group.filter((g) => gWords.includes(g)).length > 1);
    if (conflicts) {
      warn(sourceLine, 'CONFLICTING_MODAL', 'Conflicting modal groups in one block'); status = 'INVALID'; stopped = true; break;
    }
    if (pointReference && ((cutterCompActive && gWords.some(g=>[41,42,41.1,42.1,54,71.1,71.2,92,92.1,...(latheTools?[]:[70])].includes(g))) || ((gWords.includes(41) || gWords.includes(42) || gWords.includes(41.1) || gWords.includes(42.1)) && gWords.some(g=>[54,70,71.1,71.2,92,92.1].includes(g))))) {
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
    if (!latheTools && pointReference && gWords.includes(40)) cutterCompActive = false;
    if (!latheTools && pointReference && (gWords.includes(41) || gWords.includes(42))) cutterCompActive = true;
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
    if(latheTools){
      if(latheComp && (mWords.length || gWords.some(g=>[17,19,20,21,43,49].includes(g)))){warn(sourceLine,'UNSUPPORTED_COMP_STATE_CHANGE','공구 보정 중 기계 또는 평면 변경은 지원하지 않습니다.');Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
      if(mWords.includes(6)){
        if(state.tool===null || !Number.isInteger(state.tool) || state.tool<0 || (state.tool!==0 && !latheTools.tools[String(state.tool)])){warn(sourceLine,'UNKNOWN_LATHE_TOOL','공구표에서 선택한 공구를 찾을 수 없습니다.');Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
        loadedTool=state.tool===0?null:state.tool;
      }
      if(gWords.includes(43)){
        const tool=loadedTool===null?undefined:latheTools.tools[String(loadedTool)];
        if(!tool || tool.offsetX!==0 || tool.offsetZ!==0){warn(sourceLine,'UNSUPPORTED_TOOL_LENGTH','공구 길이 보정은 공구표의 X/Z 오프셋이 명시적으로 0인 경우만 지원합니다.');Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
      }
      if(gWords.includes(40)){
        if(latheComp&&!flushLatheComp(latheComp,sourceLine)){Object.assign(state,blockStartState);stopped=true;break;}
        latheComp=null;cutterCompActive=false;
      }
      if(enableLatheComp){
        const dynamic=gWords.includes(41.1)||gWords.includes(42.1),word=byLetter.get('D')?.[0],toolNumber=word===undefined?loadedTool:word;
        const tool=toolNumber===null||toolNumber===undefined?undefined:latheTools.tools[String(toolNumber)];
        const diameter=dynamic?(word===undefined?NaN:word*scale):tool?.diameter,orientation=dynamic?(byLetter.get('L')?.[0]??0):tool?.orientation;
        if(pendingCompExit || state.plane!=='XZ' || !latheRadiusMode || !state.unit || !renderablePosition(state.position) || mWords.length || (byLetter.get('D')?.length??0)>1 || (byLetter.get('L')?.length??0)>1 || (!dynamic&&byLetter.has('L')) || (!dynamic && (!Number.isInteger(toolNumber) || !tool)) || diameter===undefined || !Number.isFinite(diameter) || diameter<=0 || !Number.isInteger(orientation) || orientation!<0 || orientation!>9){warn(sourceLine,'INVALID_LATHE_TOOL_COMP','공구 반경·방향과 G18/G8 시작 상태를 확인해 주세요.');Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
        latheComp={start:{x:state.position.x!,z:state.position.z!},side:gWords.some(g=>g===41||g===41.1)?'left':'right',diameter,orientation:orientation!,moves:[],metadata:new Map()};cutterCompActive=true;
      }
    }

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
      if(latheTools && (loadedTool===null || pendingCompExit)){warn(sourceLine,'INVALID_LATHE_CYCLE_TOOL','G70/G71 전에 공구를 장착하고 G40 이후 첫 직선 이동을 완료해야 합니다.');status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
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
      if(latheComp){
        // LinuxCNC temporarily disables compensation at each pass anchor,
        // while the previous compensated move remains queued for lookahead.
        if(!finish || latheComp.moves.length){warn(sourceLine,'UNSUPPORTED_COMP_G70','보정 중 G70은 보정 진입 직후에만 지원합니다.');Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
        const anchorMoved=state.position.x!==target.x||state.position.z!==target.z;
        const cycleMoves=anchorMoved?result.moves.slice(1):result.moves;
        if(anchorMoved && (!result.moves.length || result.moves[0].motion!=='G00' || result.moves[0].end.x!==target.x || result.moves[0].end.z!==target.z)){warn(sourceLine,'INVALID_COMP_G70_ANCHOR','G70 시작 위치를 확인할 수 없습니다.');status='INVALID';stopped=true;break;}
        if(!cycleMoves.length || cycleMoves[0].center || cycleMoves[0].motion!=='G00'){warn(sourceLine,'UNSUPPORTED_COMP_G70','G70의 직선 진입 경로를 확인할 수 없습니다.');status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
        const entry=linuxCncLatheNoseEntry(target,cycleMoves[0].end,latheComp.diameter,latheComp.side,latheComp.orientation);
        if(!entry.ok){warn(sourceLine,entry.code,'G70 공구 보정 진입 이동을 확인해 주세요.');status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
        const passes=byLetter.get('P')?.[0]??1;
        const bypassCount=cycleMoves.filter((move,index)=>index>0 && move.motion==='G00' && move.end.x===target.x && move.end.z===target.z).length;
        if(bypassCount!==passes-1){warn(sourceLine,'UNSUPPORTED_COMP_G70','G70 패스 간 시작점 이동을 확인할 수 없습니다.');status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
        if(anchorMoved){const start=toReference(state.position),end=toReference({...state.position,x:target.x,z:target.z});if(!renderablePosition(start)||!renderablePosition(end)){warn(sourceLine,'FLOAT32_PRECISION_LOSS','G70 시작 위치가 표시 정밀도 범위를 벗어났습니다.');status='INVALID';stopped=true;break;}segments.push({id:`line-${sourceLine}-cycle-anchor`,sourceLine,rawCode,motion:'G00',start,end,unit:state.unit,distanceMode:state.distanceMode,plane:'XZ',status:'SUPPORTED',warningIds:[],...(loadedTool!==null?{tool:loadedTool}:{})});}
        latheComp.start={...target};
        for(const [index,move] of cycleMoves.entries())latheComp.moves.push(index>0 && move.motion==='G00' && move.end.x===target.x && move.end.z===target.z?{motion:'G00_BYPASS',end:move.end,sourceLine}:move.center?{motion:move.motion as 'G02'|'G03',end:move.end,center:move.center,sourceLine}:{motion:move.motion as 'G00'|'G01',end:move.end,sourceLine});
        latheComp.metadata.set(sourceLine,{rawCode,feed:state.feed,spindle:state.spindle,tool:loadedTool,distanceMode:state.distanceMode});state.position={...state.position,x:result.finalPosition.x,z:result.finalPosition.z};state.motionMode=null;continue;
      }
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
        prepared.push({id:`line-${sourceLine}-segment-${index}`,sourceLine,rawCode,motion:move.motion,start,end,...(vertices?{vertices}:{}),unit:state.unit,distanceMode:state.distanceMode,plane:state.plane,status:'SUPPORTED',warningIds:[],...(state.feed!==null?{feed:state.feed}:{}),...(motionTool()!==null?{tool:motionTool()!}:{})});
      }
      if(stopped){Object.assign(state,blockStartState);break;}
      segments.push(...prepared);totalArcVertices+=addedVertices;state.position={...state.position,x:result.finalPosition.x,z:result.finalPosition.z};state.motionMode=null;continue;
    }

    if (thread) {
      if(cutterCompActive){warn(sourceLine,'INVALID_THREAD_COMP','LinuxCNC에서는 공구 반경 보정이 켜진 상태로 G76을 실행할 수 없습니다.');Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
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
        if (move.start.x !== move.end.x || move.start.y !== move.end.y || move.start.z !== move.end.z) segments.push({id:`line-${sourceLine}-segment-${index}`, sourceLine, ...(byLetter.has('N') ? {nBlock:String(byLetter.get('N')![0])} : {}), rawCode, motion:move.motion, start:toReference(move.start), end:toReference(move.end), unit:state.unit, distanceMode:state.distanceMode, plane:state.plane, status:'SUPPORTED', warningIds:[], ...(state.feed !== null ? {feed:state.feed} : {}), ...(state.spindle !== null ? {spindle:state.spindle} : {}), ...(motionTool() !== null ? {tool:motionTool()!} : {})});
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
      if(latheComp){
        if(state.plane!=='XZ' || byLetter.has('Y') || !renderablePosition(start) || !renderablePosition(end) || latheComp.moves.length>=10000){warn(sourceLine,'UNSUPPORTED_LATHE_COMP_MOVE','공구 보정 중 XZ 평면의 알려진 이동만 지원합니다.');Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
        const endpoint={x:end.x!,z:end.z!};
        if(!latheComp.moves.length && !arcMotion){const entry=linuxCncLatheNoseEntry(latheComp.start,endpoint,latheComp.diameter,latheComp.side,latheComp.orientation);if(!entry.ok){warn(sourceLine,entry.code,'선반 공구 보정 진입 이동을 확인해 주세요.');Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}}
        if(arcMotion){
          const arc=solveArc(start,end,'XZ',state.motionMode==='G02',byLetter,scale);
          if(!arc){warn(sourceLine,'INVALID_ARC_GEOMETRY','공구 보정 원호의 중심을 확인할 수 없습니다.');Object.assign(state,blockStartState);status='INVALID';stopped=true;break;}
          latheComp.moves.push({motion:state.motionMode as 'G02'|'G03',end:endpoint,center:{z:arc.centerU,x:arc.centerV},sourceLine});
        }else latheComp.moves.push({motion:state.motionMode as 'G00'|'G01',end:endpoint,sourceLine});
        latheComp.metadata.set(sourceLine,{rawCode,feed:state.feed,spindle:state.spindle,tool:loadedTool,distanceMode:state.distanceMode});state.position=end;continue;
      }
      if(pendingCompExit && arcMotion){warn(sourceLine,'G40_EXIT_MUST_BE_STRAIGHT','G40 이후 첫 이동은 직선이어야 합니다.');Object.assign(state,blockStartState);status=segments.length?'PARTIAL':'UNSUPPORTED';stopped=true;break;}
      const exitPoint=pendingCompExit as LatheNosePoint|null;
      const physicalStart=exitPoint?{...start,x:exitPoint.x,z:exitPoint.z}:start;
      const referenceStart = toReference(physicalStart), referenceEnd = toReference(end);
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
        segments.push({ id: `line-${sourceLine}-segment-0`, sourceLine, ...(byLetter.has('N') ? { nBlock: String(byLetter.get('N')![0]) } : {}), rawCode, motion: state.motionMode, start:referenceStart, end:referenceEnd, vertices, unit: state.unit, distanceMode: state.distanceMode, plane: state.plane, status: 'SUPPORTED', warningIds: [], ...(state.feed !== null ? { feed: state.feed } : {}), ...(state.spindle !== null ? { spindle: state.spindle } : {}), ...(motionTool() !== null ? { tool: motionTool()! } : {}) });
        if (mWords.includes(2) || mWords.includes(30)) { programEndIndex = index; stopped = true; }
        continue;
      }
      state.position = end;
      if (renderablePosition(referenceStart) && renderablePosition(referenceEnd)) {
        if (referenceStart.x !== referenceEnd.x || referenceStart.y !== referenceEnd.y || referenceStart.z !== referenceEnd.z) {
          segments.push({ id: `line-${sourceLine}-segment-0`, sourceLine, ...(byLetter.has('N') ? { nBlock: String(byLetter.get('N')![0]) } : {}), rawCode, motion: state.motionMode, start:referenceStart, end:referenceEnd, unit: state.unit, distanceMode: state.distanceMode, plane: state.plane, status: 'SUPPORTED', warningIds: [], ...(state.feed !== null ? { feed: state.feed } : {}), ...(state.spindle !== null ? { spindle: state.spindle } : {}), ...(motionTool() !== null ? { tool: motionTool()! } : {}) });
        }
        pendingCompExit=null;
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
  if(latheComp && !stopped){warn(lines.length,'UNCLOSED_LATHE_COMP','공구 보정이 G40으로 해제되지 않아 경로를 표시하지 않습니다.');status=segments.length?'PARTIAL':'UNSUPPORTED';state.position=unknownPosition();}
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
