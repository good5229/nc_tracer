import { describe, expect, it } from 'vitest';
import { expandLinuxCncMacros, findLinuxCncSubroutine } from '../../src/parser/linuxcncMacro';
import usefulSubroutines from '../../demo/useful-subroutines.ngc?raw';
import latheG76 from '../../demo/lathe-g76.ngc?raw';

describe('expandLinuxCncMacros', () => {
  it('evaluates arithmetic and expands positional subroutine calls with original row mappings', () => {
    const source = [
      'o100 sub',
      '#31=[#1 + 2]',
      'G01 X#31',
      'o100 endsub',
      'G21 G90 G01 X0',
      'o100 call [3]',
      'o100 call [5]',
    ].join('\n');
    const result = expandLinuxCncMacros(source);
    expect(result.status).toBe('SUPPORTED');
    expect(result.warnings).toHaveLength(0);
    expect(result.lines.map(({ text }) => text)).toEqual(['G21 G90 G01 X0', 'G01 X5', 'G01 X7']);
    expect(result.lines.map(({ sourceLine }) => sourceLine)).toEqual([5, 3, 3]);
    expect(result.lines.map(({ sourceText }) => sourceText)).toEqual(['G21 G90 G01 X0', 'G01 X#31', 'G01 X#31']);
    expect(result.lines.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
    expect(result.lines[1].callStack).toEqual([6]);
    expect(result.lines[2].callStack).toEqual([7]);
  });

  it('preserves caller values for omitted call parameters and restores all local parameters on return', () => {
    const result = expandLinuxCncMacros([
      '#2=7',
      'o100 sub',
      'G01 X#1 Y#2 Z#3',
      'o100 endsub',
      'o100 call [1]',
      'G01 X#2',
    ].join('\n'));
    expect(result.status).toBe('SUPPORTED');
    expect(result.lines.map(({ text }) => text)).toEqual(['G01 X1 Y7 Z0', 'G01 X7']);
  });

  it('executes a bounded while loop and retains the repeated body source row', () => {
    const source = [
      '#31=0',
      'o10 while [#31 LT 3]',
      'G01 X#31',
      '#31=[#31+1]',
      'o10 endwhile',
    ].join('\n');
    const result = expandLinuxCncMacros(source);
    expect(result.status).toBe('SUPPORTED');
    expect(result.lines.map(({ text }) => text)).toEqual(['G01 X0', 'G01 X1', 'G01 X2']);
    expect(result.lines.map(({ sourceLine }) => sourceLine)).toEqual([3, 3, 3]);
    expect(result.lines.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
  });

  it('applies LinuxCNC degree trig and atan ratio syntax used by the utility subroutines', () => {
    const result = expandLinuxCncMacros([
      'o200 sub',
      '#10=[#1 * [cos [atan [#2]/[#3]]]]',
      'G01 X#10',
      'o200 endsub',
      'o200 call [2] [1] [1]',
    ].join('\n'));
    expect(result.status).toBe('SUPPORTED');
    expect(result.lines.map(({ text }) => text)).toEqual(['G01 X1.4142135623730951']);
  });

  it('formats expanded numbers without exponents so the G-code tokenizer can read them', () => {
    const result = expandLinuxCncMacros('#31=[1/100000000000000000]\nG01 X#31');
    expect(result.status).toBe('SUPPORTED');
    expect(result.lines[0].text).toBe('G01 X0.00000000000000001');
    expect(result.lines[0].text).not.toMatch(/[eE][+-]?\d/);
    expect(Number(result.lines[0].text.slice('G01 X'.length))).toBe(1e-17);
  });

  it('uses LinuxCNC floor semantics for FIX and 1e-6 comparison equality', () => {
    const result = expandLinuxCncMacros([
      '#31=[FIX[-2.8]]',
      '#32=[1 EQ 1.0000005]',
      '#33=[1 NE 1.0000005]',
      '#34=[1 GT 1.0000005]',
      '#35=[1 GE 1.0000005]',
      '#36=[1 LT 1.000002]',
      '#37=[1 LE 1.0000005]',
      'G01 X#31', 'G01 X#32', 'G01 X#33', 'G01 X#34', 'G01 X#35', 'G01 X#36', 'G01 X#37',
    ].join('\n'));
    expect(result.status).toBe('SUPPORTED');
    expect(result.lines.map(({ text }) => text)).toEqual(['G01 X-3', 'G01 X1', 'G01 X0', 'G01 X0', 'G01 X1', 'G01 X1', 'G01 X1']);
  });

  it('evaluates logical operators at shared left-associative precedence and power left-to-right', () => {
    const result = expandLinuxCncMacros([
      '#31=[1 OR 0 AND 0]',
      '#32=[2 ** 3 ** 2]',
      'G01 X#31',
      'G01 X#32',
    ].join('\n'));
    expect(result.status).toBe('SUPPORTED');
    expect(result.lines.map(({ text }) => text)).toEqual(['G01 X0', 'G01 X64']);
  });

  it('expands the useful-subroutines demo loops and strips definitions/call statements', () => {
    const result = expandLinuxCncMacros(usefulSubroutines);
    expect(result.status).toBe('SUPPORTED');
    expect(result.warnings).toHaveLength(0);
    expect(result.lines.some(({ text }) => /^\s*o\d+\s+(?:sub|endsub|call|while|endwhile)\b/i.test(text))).toBe(false);
    const depthMoves = result.lines.filter(({ sourceText }) => sourceText.trim().toLowerCase() === 'g0 z#3');
    const depthMoveSourceRows = usefulSubroutines.split(/\r?\n/).flatMap((line, index) =>
      line.trim().toLowerCase() === 'g0 z#3' ? [index + 1] : [],
    );
    expect(depthMoves).toHaveLength(4);
    expect(depthMoves.map(({ sourceLine }) => sourceLine)).toEqual([...depthMoveSourceRows, ...depthMoveSourceRows]);
    expect(new Set(depthMoves.map(({ sequence }) => sequence)).size).toBe(4);
  });

  it('expands the parameterless lathe subroutine calls with stable original line mappings', () => {
    const result = expandLinuxCncMacros(latheG76);
    expect(result.status).toBe('SUPPORTED');
    expect(result.warnings).toHaveLength(0);
    expect(result.lines.some(({ text }) => /^\s*o100\s+call\b/i.test(text))).toBe(false);
    const routineRow = latheG76.split(/\r?\n/).findIndex((line) => line.trim().toLowerCase() === 'g0z1x-1') + 1;
    const entries = result.lines.filter(({ sourceLine }) => sourceLine === routineRow);
    expect(entries).toHaveLength(8);
    expect(entries.every(({ sourceText }) => sourceText.trim().toLowerCase() === 'g0z1x-1')).toBe(true);
  });

  it('stops expansion at M2/M30 while allowing independent source-mapped subroutine lookup', () => {
    const source = [
      'o100 sub', 'G01 X1', 'o100 endsub', 'o100 call', 'M30',
      'o200 sub', 'G01 X2', 'o200 endsub', 'o999 if [#1]',
    ].join('\n');
    const result = expandLinuxCncMacros(source);
    expect(result.status).toBe('SUPPORTED');
    expect(result.warnings).toHaveLength(0);
    expect(result.lines.map(({ text }) => text)).toEqual(['G01 X1', 'M30']);
    expect(result.lines.map(({ sourceLine }) => sourceLine)).toEqual([2, 5]);

    const definition = findLinuxCncSubroutine(source, 'O200');
    expect(definition).toMatchObject({ label: '200', sourceLine: 6, sourceText: 'o200 sub' });
    expect(definition?.body).toEqual([{ sourceLine: 7, sourceText: 'G01 X2' }]);
  });

  it('stops safely on missing routines, unknown variables, recursion, and loop limits', () => {
    const missing = expandLinuxCncMacros('G01 X0\no999 call');
    expect(missing.status).toBe('PARTIAL');
    expect(missing.lines).toHaveLength(1);
    expect(missing.warnings[0].code).toBe('UNSUPPORTED_MACRO');

    const undefinedParameter = expandLinuxCncMacros('G01 X#31');
    expect(undefinedParameter.status).toBe('INVALID');
    expect(undefinedParameter.warnings[0].code).toBe('INVALID_MACRO');

    const recursive = expandLinuxCncMacros('o1 sub\no1 call\no1 endsub\no1 call', { maxCallDepth: 3 });
    expect(recursive.status).toBe('UNSUPPORTED');
    expect(recursive.warnings[0].code).toBe('MACRO_LIMIT');

    const loop = expandLinuxCncMacros('#31=1\no2 while [#31 GT 0]\nG01 X1\no2 endwhile', { maxLoopIterations: 2 });
    expect(loop.status).toBe('PARTIAL');
    expect(loop.lines).toHaveLength(2);
    expect(loop.warnings[0].code).toBe('MACRO_LIMIT');
  });

  it('preserves the executed prefix when the expanded-line limit is reached', () => {
    const result = expandLinuxCncMacros('G01 X1\nG01 X2\nG01 X3', { maxExpandedLines: 2 });
    expect(result.status).toBe('PARTIAL');
    expect(result.lines.map(({ text }) => text)).toEqual(['G01 X1', 'G01 X2']);
    expect(result.warnings[0]).toMatchObject({ sourceLine: 3, code: 'MACRO_LIMIT' });
  });
});
