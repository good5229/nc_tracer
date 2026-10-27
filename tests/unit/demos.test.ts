import { describe, expect, it } from 'vitest';
import { parseGcode } from '../../src/parser/gcode';
import subroutines from '../../demo/useful-subroutines.ngc?raw';
import latheCycles from '../../demo/lathe_g70_71_demo.ngc?raw';
import latheThread from '../../demo/lathe-g76.ngc?raw';

describe('LinuxCNC demo support boundaries', () => {
  it.each([
    ['subroutines', subroutines, 14, 'UNSUPPORTED_MACRO'],
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
    expect(parseGcode('G64 P0.1', {controllerProfile:'linuxcnc'}).status).toBe('UNSUPPORTED');
  });
});
