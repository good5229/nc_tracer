export type ValidationStatus = 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'INVALID';
export type Vector3 = { x: number | null; y: number | null; z: number | null };
export type Motion = 'G00' | 'G01';
export type ModalState = {
  unit: 'mm' | 'inch' | null;
  distanceMode: 'absolute' | 'incremental' | null;
  motionMode: Motion | null;
  plane: 'XY' | 'XZ' | 'YZ' | null;
  position: Vector3;
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
};
export type ParseResult = {
  status: ValidationStatus;
  segments: MotionSegment[];
  warnings: ParseWarning[];
  finalState: ModalState;
};
export type ParserOptions = {
  initialPosition?: Vector3;
  initialUnit?: 'mm' | 'inch';
  initialDistanceMode?: 'absolute' | 'incremental';
  initialMotionMode?: Motion;
};

const unknownPosition = (): Vector3 => ({ x: null, y: null, z: null });
const finitePosition = (p: Vector3) => [p.x, p.y, p.z].every((v) => v !== null && Number.isFinite(v));

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

/** Parses the deliberately small, modal G-code subset approved for the viewer. */
export function parseGcode(text: string, options: ParserOptions = {}): ParseResult {
  const segments: MotionSegment[] = [];
  const warnings: ParseWarning[] = [];
  const state: ModalState = {
    unit: options.initialUnit ?? null,
    distanceMode: options.initialDistanceMode ?? null,
    motionMode: options.initialMotionMode ?? null,
    plane: null,
    position: options.initialPosition ? { ...options.initialPosition } : unknownPosition(),
  };
  let status: ValidationStatus = 'SUPPORTED';
  let stopped = false;
  const warn = (sourceLine: number, code: string, message: string) => {
    const id = `warning-${sourceLine}-${warnings.length}`;
    warnings.push({ id, sourceLine, code, message });
    return id;
  };
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (Object.values(state.position).some((value) => value !== null && !Number.isFinite(value))) {
    warn(1, 'INVALID_INITIAL_POSITION', 'Initial coordinates must be finite numbers or null');
    return { status: 'INVALID', segments, warnings, finalState: state };
  }

  for (let index = 0; index < lines.length && !stopped; index += 1) {
    const sourceLine = index + 1;
    const rawCode = lines[index];
    let tokens: ReturnType<typeof tokenize>;
    try {
      tokens = tokenize(stripComments(rawCode));
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
    const knownLetters = new Set(['N', 'G', 'M', 'X', 'Y', 'Z', 'F', 'S', 'T']);
    const unsupportedLetter = tokens.find((t) => !knownLetters.has(t.letter));
    if (unsupportedLetter || byLetter.has('M') && mWords.some((m) => ![2, 30].includes(m))) {
      warn(sourceLine, 'UNSUPPORTED_BLOCK', 'Unsupported word or machine command; interpretation stopped here');
      status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
    }

    const supportedG = new Set([0, 1, 17, 18, 19, 20, 21, 90, 91]);
    const badG = gWords.find((g) => !supportedG.has(g));
    if (badG !== undefined) {
      warn(sourceLine, 'UNSUPPORTED_GCODE', `G${badG} is outside the supported profile; interpretation stopped here`);
      status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
    }
    const conflicts = [
      [0, 1], [90, 91], [20, 21], [17, 18, 19],
    ].some((group) => group.filter((g) => gWords.includes(g)).length > 1);
    if (conflicts) {
      warn(sourceLine, 'CONFLICTING_MODAL', 'Conflicting modal groups in one block'); status = 'INVALID'; stopped = true; break;
    }

    // Modal words are applied before coordinates in their own block.
    if (gWords.includes(20)) state.unit = 'inch';
    if (gWords.includes(21)) state.unit = 'mm';
    if (gWords.includes(90)) state.distanceMode = 'absolute';
    if (gWords.includes(91)) state.distanceMode = 'incremental';
    if (gWords.includes(0)) state.motionMode = 'G00';
    if (gWords.includes(1)) state.motionMode = 'G01';
    if (gWords.includes(17)) state.plane = 'XY';
    if (gWords.includes(18)) state.plane = 'XZ';
    if (gWords.includes(19)) state.plane = 'YZ';

    const axes = ['X', 'Y', 'Z'] as const;
    const hasAxis = axes.some((axis) => byLetter.has(axis));
    const hasArcParams = ['I', 'J', 'K', 'R'].some((letter) => byLetter.has(letter));
    if (hasArcParams || (hasAxis && state.motionMode === null)) {
      warn(sourceLine, hasArcParams ? 'UNSUPPORTED_ARC' : 'UNKNOWN_MOTION', hasArcParams ? 'Arc parameters are unsupported' : 'Motion mode is unknown; position interpretation stopped');
      status = segments.length ? 'PARTIAL' : 'UNSUPPORTED'; stopped = true; break;
    }

    if (hasAxis) {
      if (state.unit === null || state.distanceMode === null || state.motionMode === null) {
        warn(sourceLine, 'UNKNOWN_MODAL_STATE', 'Unit, distance mode, or motion mode is unknown; position cannot be interpreted');
        status = segments.length ? 'PARTIAL' : 'UNSUPPORTED';
        // Do not let later modal declarations bridge over an untracked move.
        state.position = unknownPosition();
        stopped = true;
        break;
      }
      const start = { ...state.position };
      const end = { ...state.position };
      const scale = state.unit === 'inch' ? 25.4 : 1;
      for (const axis of axes) {
        const raw = byLetter.get(axis)?.[0];
        if (raw === undefined) continue;
        const value = raw * scale;
        end[axis.toLowerCase() as 'x' | 'y' | 'z'] = state.distanceMode === 'absolute'
          ? value
          : (start[axis.toLowerCase() as 'x' | 'y' | 'z'] === null ? null : start[axis.toLowerCase() as 'x' | 'y' | 'z']! + value);
      }
      state.position = end;
      if (finitePosition(start) && finitePosition(end)) {
        if (start.x !== end.x || start.y !== end.y || start.z !== end.z) {
          segments.push({ id: `line-${sourceLine}-segment-0`, sourceLine, ...(byLetter.has('N') ? { nBlock: String(byLetter.get('N')![0]) } : {}), rawCode, motion: state.motionMode, start, end, status: 'SUPPORTED', warningIds: [], ...(byLetter.has('F') ? { feed: byLetter.get('F')![0] } : {}) });
        }
      } else {
        warn(sourceLine, 'POSITION_UNKNOWN', 'Position is not fully known; no line segment was emitted');
        status = 'PARTIAL';
      }
    }
    if (mWords.includes(2) || mWords.includes(30)) stopped = true;
  }
  if (stopped && status !== 'SUPPORTED') state.position = unknownPosition();
  return { status, segments, warnings, finalState: state };
}
