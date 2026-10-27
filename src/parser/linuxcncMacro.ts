export type MacroExpandedLine = { sequence: number; text: string; sourceLine: number; sourceText: string; callStack: number[] };
export type MacroWarning = { sourceLine: number; code: string; message: string };
export type MacroSubroutineDefinition = {
  label: string;
  sourceLine: number;
  sourceText: string;
  body: Array<{ sourceLine: number; sourceText: string }>;
};
export type MacroSubroutineIndex = { subroutines: MacroSubroutineDefinition[]; warnings: MacroWarning[] };
export type MacroExpansionResult = {
  status: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'INVALID';
  lines: MacroExpandedLine[];
  warnings: MacroWarning[];
};
export type MacroOptions = {
  maxExpandedLines?: number;
  maxLoopIterations?: number;
  maxCallDepth?: number;
  maxSteps?: number;
};

type SourceRow = { sourceLine: number; text: string };
type Limits = Required<MacroOptions>;
type FailureCode = 'UNSUPPORTED_MACRO' | 'INVALID_MACRO' | 'MACRO_LIMIT';
const COMPARISON_TOLERANCE = 1e-6;

class MacroFailure extends Error {
  constructor(readonly code: FailureCode, message: string, readonly sourceLine: number) { super(message); }
}

function fail(code: FailureCode, message: string, row: SourceRow): never {
  throw new MacroFailure(code, message, row.sourceLine);
}

function codePart(text: string): string {
  let result = '', commentDepth = 0;
  for (const char of text) {
    if (char === '(') { commentDepth += 1; continue; }
    if (char === ')' && commentDepth > 0) { commentDepth -= 1; continue; }
    if (char === ';' && commentDepth === 0) break;
    if (commentDepth === 0) result += char;
  }
  return result;
}

type Token = { kind: 'number' | 'parameter' | 'word' | 'operator' | 'left' | 'right'; text: string };
function tokenizeExpression(expression: string, row: SourceRow): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < expression.length) {
    if (/\s/.test(expression[at])) { at += 1; continue; }
    const tail = expression.slice(at);
    const match = /^(?:#\d+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z]+|\*\*|[+\-*/%[\]])/i.exec(tail);
    if (!match) fail('INVALID_MACRO', `Unexpected expression text near "${tail.slice(0, 16)}"`, row);
    const text = match[0];
    const kind: Token['kind'] = text === '[' ? 'left' : text === ']' ? 'right'
      : text[0] === '#' ? 'parameter' : /^[\d.]/.test(text) ? 'number'
        : /^[A-Za-z]/.test(text) ? 'word' : 'operator';
    tokens.push({ kind, text });
    at += text.length;
  }
  return tokens;
}

function evaluateExpression(expression: string, variables: Map<number, number>, row: SourceRow): number {
  const tokens = tokenizeExpression(expression, row);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const expect = (text: string) => {
    if (peek()?.text !== text) fail('INVALID_MACRO', `Expected "${text}" in expression`, row);
    take();
  };
  const checked = (value: number): number => {
    if (!Number.isFinite(value)) fail('INVALID_MACRO', 'Expression result is not finite', row);
    return value;
  };
  const precedence: Record<string, number> = {
    OR: 1, XOR: 1, AND: 1, EQ: 4, NE: 4, GT: 4, GE: 4, LT: 4, LE: 4,
    '+': 5, '-': 5, '*': 6, '/': 6, MOD: 6, '%': 6, '**': 7,
  };
  const parse = (minimum = 0): number => {
    let left = primary();
    while (peek()) {
      const token = peek()!;
      const operator = token.kind === 'word' ? token.text.toUpperCase() : token.text;
      const priority = precedence[operator];
      if (priority === undefined || priority < minimum) break;
      take();
      const right = parse(priority + 1);
      switch (operator) {
        case '+': left = checked(left + right); break;
        case '-': left = checked(left - right); break;
        case '*': left = checked(left * right); break;
        case '/': if (right === 0) fail('INVALID_MACRO', 'Division by zero in expression', row); left = checked(left / right); break;
        case 'MOD': case '%': if (right === 0) fail('INVALID_MACRO', 'Modulo by zero in expression', row); left = checked(left % right); break;
        case '**': left = checked(left ** right); break;
        case 'EQ': left = Math.abs(left - right) < COMPARISON_TOLERANCE ? 1 : 0; break;
        case 'NE': left = Math.abs(left - right) < COMPARISON_TOLERANCE ? 0 : 1; break;
        case 'GT': left = left - right >= COMPARISON_TOLERANCE ? 1 : 0; break;
        case 'GE': left = left - right > -COMPARISON_TOLERANCE ? 1 : 0; break;
        case 'LT': left = left - right <= -COMPARISON_TOLERANCE ? 1 : 0; break;
        case 'LE': left = left - right < COMPARISON_TOLERANCE ? 1 : 0; break;
        case 'AND': left = left !== 0 && right !== 0 ? 1 : 0; break;
        case 'OR': left = left !== 0 || right !== 0 ? 1 : 0; break;
        case 'XOR': left = (left !== 0) !== (right !== 0) ? 1 : 0; break;
      }
    }
    return left;
  };
  const bracketed = () => {
    expect('[');
    const value = parse();
    expect(']');
    return value;
  };
  const primary = (): number => {
    const token = take();
    if (!token) fail('INVALID_MACRO', 'Expression ended unexpectedly', row);
    if (token.kind === 'operator' && (token.text === '+' || token.text === '-')) {
      const value = parse(8);
      return token.text === '-' ? -value : value;
    }
    if (token.kind === 'left') { cursor -= 1; return bracketed(); }
    if (token.kind === 'number') return checked(Number(token.text));
    if (token.kind === 'parameter') {
      const index = Number(token.text.slice(1));
      const value = variables.get(index);
      if (value === undefined) fail('INVALID_MACRO', `Parameter #${index} is not initialized`, row);
      return checked(value);
    }
    if (token.kind !== 'word') fail('INVALID_MACRO', `Unexpected token "${token.text}"`, row);
    const name = token.text.toLowerCase();
    if (name === 'atan') {
      const y = bracketed();
      expect('/');
      const x = bracketed();
      if (x === 0 && y === 0) fail('INVALID_MACRO', 'ATAN is undefined for [0]/[0]', row);
      return checked(Math.atan2(y, x) * 180 / Math.PI);
    }
    const argument = bracketed();
    const degrees = argument * Math.PI / 180;
    switch (name) {
      case 'sin': return checked(Math.sin(degrees));
      case 'cos': return checked(Math.cos(degrees));
      case 'tan': return checked(Math.tan(degrees));
      case 'asin': return checked(Math.asin(argument) * 180 / Math.PI);
      case 'acos': return checked(Math.acos(argument) * 180 / Math.PI);
      case 'sqrt': if (argument < 0) fail('INVALID_MACRO', 'SQRT argument must be non-negative', row); return checked(Math.sqrt(argument));
      case 'abs': return Math.abs(argument);
      case 'round': return Math.round(argument);
      case 'fix': return Math.floor(argument);
      case 'fup': return Math.ceil(argument);
      case 'exp': return checked(Math.exp(argument));
      case 'ln': if (argument <= 0) fail('INVALID_MACRO', 'LN argument must be positive', row); return checked(Math.log(argument));
      default: fail('UNSUPPORTED_MACRO', `Unsupported expression function "${token.text}"`, row);
    }
  };
  if (tokens.length === 0) fail('INVALID_MACRO', 'Expression is empty', row);
  const value = parse();
  if (cursor !== tokens.length) fail('INVALID_MACRO', `Unexpected token "${peek()!.text}" after expression`, row);
  return checked(value);
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) return '0';
  const text = String(value);
  const exponentAt = text.search(/[eE]/);
  if (exponentAt < 0) return text;
  const mantissa = text.slice(0, exponentAt);
  const exponent = Number(text.slice(exponentAt + 1));
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const dot = unsigned.indexOf('.');
  const decimalAt = dot < 0 ? unsigned.length : dot;
  const digits = unsigned.replace('.', '');
  const newDecimalAt = decimalAt + exponent;
  let decimal: string;
  if (newDecimalAt <= 0) decimal = `0.${'0'.repeat(-newDecimalAt)}${digits}`;
  else if (newDecimalAt >= digits.length) decimal = `${digits}${'0'.repeat(newDecimalAt - digits.length)}`;
  else decimal = `${digits.slice(0, newDecimalAt)}.${digits.slice(newDecimalAt)}`;
  return `${negative ? '-' : ''}${decimal}`;
}

function substitute(line: string, variables: Map<number, number>, row: SourceRow): string {
  let result = '', inComment = false;
  for (let i = 0; i < line.length;) {
    const char = line[i];
    if (char === '(') { inComment = true; result += char; i += 1; continue; }
    if (char === ')' && inComment) { inComment = false; result += char; i += 1; continue; }
    if (char === ';' && !inComment) { result += line.slice(i); break; }
    if (inComment) { result += char; i += 1; continue; }
    if (char === '[') {
      let depth = 1, end = i + 1;
      while (end < line.length && depth > 0) {
        if (line[end] === '[') depth += 1;
        else if (line[end] === ']') depth -= 1;
        end += 1;
      }
      if (depth !== 0) fail('INVALID_MACRO', 'Unclosed expression bracket', row);
      result += formatNumber(evaluateExpression(line.slice(i, end), variables, row));
      i = end;
      continue;
    }
    if (char === '#') {
      const match = /^#(\d+)/.exec(line.slice(i));
      if (!match) fail('UNSUPPORTED_MACRO', 'Only numbered parameters such as #1 are supported', row);
      const index = Number(match[1]), value = variables.get(index);
      if (value === undefined) fail('INVALID_MACRO', `Parameter #${index} is not initialized`, row);
      result += formatNumber(value);
      i += match[0].length;
      continue;
    }
    result += char;
    i += 1;
  }
  return result;
}

function directive(row: SourceRow): RegExpExecArray | null {
  return /^\s*o(\d+)\s+(sub|endsub|call|while|endwhile)\b(.*)$/i.exec(codePart(row.text));
}

function isProgramEnd(row: SourceRow): boolean {
  return /\bM0*(?:2|30)(?:\.0+)?\b/i.test(codePart(row.text));
}

/** Indexes numbered subroutine definitions independently of executing program flow. */
export function getLinuxCncSubroutines(text: string): MacroSubroutineIndex {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line, index) => ({ sourceLine: index + 1, text: line }));
  const subroutines: MacroSubroutineDefinition[] = [], warnings: MacroWarning[] = [];
  let active: { label: string; row: SourceRow; body: SourceRow[] } | null = null;
  for (const row of rows) {
    const match = directive(row), command = match?.[2].toLowerCase();
    if (command === 'sub') {
      if (active) {
        warnings.push({ sourceLine: row.sourceLine, code: 'INVALID_MACRO', message: 'Nested subroutine definitions are not supported' });
        return { subroutines, warnings };
      }
      if (subroutines.some((routine) => routine.label === match![1])) {
        warnings.push({ sourceLine: row.sourceLine, code: 'INVALID_MACRO', message: `Duplicate subroutine O${match![1]}` });
        return { subroutines, warnings };
      }
      active = { label: match![1], row, body: [] };
    } else if (command === 'endsub') {
      if (!active || active.label !== match![1]) {
        warnings.push({ sourceLine: row.sourceLine, code: 'INVALID_MACRO', message: 'Mismatched O-code sub/endsub labels' });
        return { subroutines, warnings };
      }
      subroutines.push({
        label: active.label,
        sourceLine: active.row.sourceLine,
        sourceText: active.row.text,
        body: active.body.map(({ sourceLine, text: sourceText }) => ({ sourceLine, sourceText })),
      });
      active = null;
    } else if (active) active.body.push(row);
  }
  if (active) warnings.push({ sourceLine: active.row.sourceLine, code: 'INVALID_MACRO', message: `Subroutine O${active.label} has no endsub` });
  return { subroutines, warnings };
}

/** Looks up a numbered subroutine and returns its original source row mapping. */
export function findLinuxCncSubroutine(text: string, label: string | number): MacroSubroutineDefinition | null {
  const normalized = String(label).replace(/^o/i, '');
  return getLinuxCncSubroutines(text).subroutines.find((subroutine) => subroutine.label === normalized) ?? null;
}

function bracketArguments(text: string, row: SourceRow, variables: Map<number, number>): number[] {
  const args: number[] = [];
  let i = 0;
  while (i < text.length) {
    while (/\s/.test(text[i] ?? '')) i += 1;
    if (i === text.length) break;
    if (text[i] !== '[') fail('UNSUPPORTED_MACRO', 'Subroutine arguments must be bracketed expressions', row);
    let depth = 1, end = i + 1;
    while (end < text.length && depth > 0) {
      if (text[end] === '[') depth += 1;
      else if (text[end] === ']') depth -= 1;
      end += 1;
    }
    if (depth !== 0) fail('INVALID_MACRO', 'Unclosed subroutine argument expression', row);
    args.push(evaluateExpression(text.slice(i, end), variables, row));
    i = end;
  }
  if (args.length > 30) fail('UNSUPPORTED_MACRO', 'At most 30 positional subroutine arguments are supported', row);
  return args;
}

function matchingLoops(rows: SourceRow[]): Map<number, number> {
  const starts = new Map<number, number>(), stack: Array<{ index: number; label: string }> = [];
  rows.forEach((row, index) => {
    const match = directive(row);
    if (!match) return;
    if (match[2].toLowerCase() === 'while') stack.push({ index, label: match[1] });
    if (match[2].toLowerCase() === 'endwhile') {
      const open = stack.pop();
      if (!open || open.label !== match[1]) fail('INVALID_MACRO', 'Mismatched O-code while/endwhile labels', row);
      starts.set(open.index, index);
    }
  });
  if (stack.length) fail('INVALID_MACRO', 'Missing O-code endwhile', rows[stack.at(-1)!.index]);
  return starts;
}

/** Expands the supported LinuxCNC O-code subset without eval or executing machine code. */
export function expandLinuxCncMacros(text: string, options: MacroOptions = {}): MacroExpansionResult {
  const limits: Limits = {
    maxExpandedLines: options.maxExpandedLines ?? 100_000,
    maxLoopIterations: options.maxLoopIterations ?? 10_000,
    maxCallDepth: options.maxCallDepth ?? 32,
    maxSteps: options.maxSteps ?? 1_000_000,
  };
  if (Object.values(limits).some((limit) => !Number.isSafeInteger(limit) || limit < 1)) {
    return { status: 'INVALID', lines: [], warnings: [{ sourceLine: 1, code: 'INVALID_MACRO', message: 'Macro limits must be positive safe integers' }] };
  }
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line, index) => ({ sourceLine: index + 1, text: line }));
  const routines = new Map<string, SourceRow[]>(), topLevel: SourceRow[] = [];
  const output: MacroExpandedLine[] = [];
  let active: { label: string; row: SourceRow; body: SourceRow[] } | null = null;
  try {
    for (const row of rows) {
      const match = directive(row), command = match?.[2].toLowerCase();
      if (!active && isProgramEnd(row)) {
        topLevel.push(row);
        break;
      }
      if (command === 'sub') {
        if (active) fail('INVALID_MACRO', 'Nested subroutine definitions are not supported', row);
        const label = match![1];
        if (routines.has(label)) fail('INVALID_MACRO', `Duplicate subroutine O${label}`, row);
        active = { label, row, body: [] };
      } else if (command === 'endsub') {
        if (!active || active.label !== match![1]) fail('INVALID_MACRO', 'Mismatched O-code sub/endsub labels', row);
        routines.set(active.label, active.body);
        active = null;
      } else if (active) active.body.push(row);
      else topLevel.push(row);
    }
    if (active) fail('INVALID_MACRO', `Subroutine O${active.label} has no endsub`, active.row);

    const variables = new Map<number, number>();
    const callStack: number[] = [];
    let stopRequested = false;
    let steps = 0;
    const emit = (row: SourceRow) => {
      if (output.length >= limits.maxExpandedLines) fail('MACRO_LIMIT', `Expanded output exceeded ${limits.maxExpandedLines} lines`, row);
      output.push({ sequence: output.length, text: substitute(row.text, variables, row), sourceLine: row.sourceLine, sourceText: row.text, callStack: [...callStack] });
      if (isProgramEnd(row)) stopRequested = true;
    };
    const execute = (program: SourceRow[]): void => {
      const loops = matchingLoops(program);
      const loopFrames: Array<{ start: number; end: number; iterations: number }> = [];
      let pc = 0;
      while (pc < program.length && !stopRequested) {
        const row = program[pc];
        steps += 1;
        if (steps > limits.maxSteps) fail('MACRO_LIMIT', `Macro execution exceeded ${limits.maxSteps} steps`, row);
        const match = directive(row), command = match?.[2].toLowerCase();
        if (command === 'call') {
          const routine = routines.get(match![1]);
          if (!routine) fail('UNSUPPORTED_MACRO', `Subroutine O${match![1]} is not defined`, row);
          if (callStack.length >= limits.maxCallDepth) fail('MACRO_LIMIT', `Subroutine call depth exceeded ${limits.maxCallDepth}`, row);
          const args = bracketArguments(match![3], row, variables);
          const saved = new Map<number, number | undefined>();
          for (let index = 1; index <= 30; index += 1) {
            saved.set(index, variables.get(index));
            variables.set(index, variables.get(index) ?? 0);
          }
          args.forEach((value, index) => variables.set(index + 1, value));
          callStack.push(row.sourceLine);
          try { execute(routine); } finally {
            callStack.pop();
            for (let index = 1; index <= 30; index += 1) {
              const previous = saved.get(index);
              if (previous === undefined) variables.delete(index); else variables.set(index, previous);
            }
          }
        } else if (command === 'while') {
          const end = loops.get(pc);
          if (end === undefined) fail('INVALID_MACRO', 'O-code while has no matching endwhile', row);
          let frame = loopFrames.at(-1);
          if (!frame || frame.start !== pc) {
            frame = { start: pc, end, iterations: 0 };
            loopFrames.push(frame);
          }
          if (evaluateExpression(match![3].trim(), variables, row) !== 0) {
            frame.iterations += 1;
            if (frame.iterations > limits.maxLoopIterations) fail('MACRO_LIMIT', `O-code loop exceeded ${limits.maxLoopIterations} iterations`, row);
            pc += 1;
          } else {
            loopFrames.pop();
            pc = end + 1;
          }
          continue;
        } else if (command === 'endwhile') {
          const frame = loopFrames.at(-1);
          if (!frame || frame.end !== pc) fail('INVALID_MACRO', 'O-code endwhile has no active while', row);
          pc = frame.start;
          continue;
        } else if (command === 'sub' || command === 'endsub') {
          fail('INVALID_MACRO', 'Unexpected subroutine boundary during execution', row);
        } else {
          const code = codePart(row.text);
          const assignment = /^\s*#(\d+)\s*=\s*(.*?)\s*$/i.exec(code);
          if (assignment) {
            const index = Number(assignment[1]);
            if (!Number.isSafeInteger(index) || index < 1 || index > 10_000) fail('UNSUPPORTED_MACRO', 'Parameter index must be from #1 to #10000', row);
            variables.set(index, evaluateExpression(assignment[2], variables, row));
          } else if (/^\s*o\d+\s+/i.test(code)) {
            fail('UNSUPPORTED_MACRO', 'Unsupported O-code statement', row);
          } else if (code.trim() || row.text.trim()) emit(row);
        }
        pc += 1;
      }
    };
    execute(topLevel);
    return { status: 'SUPPORTED', lines: output, warnings: [] };
  } catch (error) {
    const failure = error instanceof MacroFailure ? error : new MacroFailure('INVALID_MACRO', error instanceof Error ? error.message : 'Macro expansion failed', 1);
    const status = failure.code === 'INVALID_MACRO' ? 'INVALID' : output.length ? 'PARTIAL' : 'UNSUPPORTED';
    return { status, lines: output, warnings: [{ sourceLine: failure.sourceLine, code: failure.code, message: failure.message }] };
  }
}
