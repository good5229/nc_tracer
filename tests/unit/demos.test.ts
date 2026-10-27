import { describe, expect, it } from 'vitest';
import { parseGcode } from '../../src/parser/gcode';
import subroutines from '../../demo/useful-subroutines.ngc?raw';
import latheCycles from '../../demo/lathe_g70_71_demo.ngc?raw';
import latheThread from '../../demo/lathe-g76.ngc?raw';

describe('LinuxCNC demo support boundaries', () => {
  it.each([
    ['subroutines', subroutines, 76, 'UNSUPPORTED_BLOCK'],
    ['G70/G71 lathe', latheCycles, 1, 'UNSUPPORTED_GCODE'],
    ['G76 lathe', latheThread, 8, 'UNSUPPORTED_BLOCK'],
  ])('%s stops at the first unsupported block without fabricating paths', (_name, source, line, code) => {
    const result = parseGcode(source, { controllerProfile: 'linuxcnc' });
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.segments).toHaveLength(0);
    expect(result.warnings[0]).toMatchObject({ sourceLine: line, code });
  });
  it('enables LinuxCNC path control and spindle commands only in its explicit profile', () => {
    const code = 'G21 G90 G64 G00 X0 Y0 Z0\nS1000 M3\nG01 X10\nM5\nM2';
    const generic = parseGcode(code);
    expect(generic.warnings[0].code).toBe('UNSUPPORTED_GCODE');
    const result = parseGcode(code, {controllerProfile:'linuxcnc', initialPosition:{x:0,y:0,z:0}});
    expect(result.status).toBe('SUPPORTED');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].end).toEqual({x:10,y:0,z:0});
    expect(parseGcode('G64 P0.1 Q0.05\nG4 P1', {controllerProfile:'linuxcnc'}).status).toBe('SUPPORTED');
    expect(parseGcode('G64 Q0.1', {controllerProfile:'linuxcnc'}).status).toBe('INVALID');
    expect(parseGcode('G4 P1 X1', {controllerProfile:'linuxcnc'}).status).toBe('INVALID');
  });
});

it('executes repeated LinuxCNC subroutine moves in order and maps them to their original line', () => {
  const source = 'o100 sub\nG91 G1 X1\no100 endsub\nG21 G90 G0 X0 Y0 Z0\no100 call\no100 call\nM2';
  const result = parseGcode(source, {controllerProfile:'linuxcnc', initialPosition:{x:0,y:0,z:0}});
  expect(result.status).toBe('SUPPORTED');
  expect(result.segments.map(segment=>segment.end.x)).toEqual([1,2]);
  expect(result.segments.map(segment=>segment.sourceLine)).toEqual([2,2]);
  expect(result.segments.map(segment=>segment.rawCode)).toEqual(['G91 G1 X1','G91 G1 X1']);
  expect(new Set(result.segments.map(segment=>segment.id)).size).toBe(2);
});

it('expands an explicitly configured LinuxCNC G76 block with unique source mappings', () => {
  const source='G8 G18 G20 G90 G00 X0.2 Y0 Z0.2\nS800 M3\nG76 P.05 Z-.5 I-.075 J.008 K.045 H3 R2 Q29.5 E.05 L2\nG0 X.5\nM2';
  const result=parseGcode(source,{controllerProfile:'linuxcnc',initialPosition:{x:0,y:0,z:0}});
  expect(result.status).toBe('SUPPORTED');
  const threading=result.segments.filter(s=>s.sourceLine===3);
  expect(threading.length).toBeGreaterThan(100);
  expect(threading.every(s=>s.rawCode.startsWith('G76'))).toBe(true);
  expect(new Set(threading.map(s=>s.id)).size).toBe(threading.length);
  expect(result.segments.at(-1)?.end.x).toBeCloseTo(12.7);
  expect(parseGcode(source.replace('G8 ',''),{controllerProfile:'linuxcnc',initialPosition:{x:0,y:0,z:0}}).warnings.at(-1)?.code).toBe('INVALID_THREAD_SETUP');
});
