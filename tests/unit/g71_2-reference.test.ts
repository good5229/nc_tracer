import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseGcode} from '../../src/parser/gcode';
import reference from '../fixtures/linuxcnc-g71_2-reference.json';
describe('LinuxCNC G71.2 reference traces',()=>{
 for(const name of ['step','pocket','wide','double','slope'] as const)it(`matches the ${name} path in the bounded D0 straight subset`,()=>{
  const source=readFileSync(new URL(`../fixtures/g71_2_${name}.ngc`,import.meta.url),'utf8');
  const result=parseGcode(source,{controllerProfile:'linuxcnc',linuxcncPointToolReference:true,initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute'});
  expect(result.status).toBe('SUPPORTED');
  expect(result.segments).toHaveLength(reference[name].length);
  result.segments.forEach((segment,i)=>{const expected=reference[name][i];expect(segment.motion).toBe(expected.motion);expect(segment.end.x).toBeCloseTo(expected.end[0],4);expect(segment.end.z).toBeCloseTo(expected.end[1],4);});
 });
});
it('does not emit a partial cycle for unsupported corner finish or tiny contour changes',()=>{
 const source=readFileSync(new URL('../fixtures/g71_2_pocket.ngc',import.meta.url),'utf8');
 const settings={controllerProfile:'linuxcnc' as const,linuxcncPointToolReference:true,initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute' as const};
 for(const modified of [source.replace('G1 X4 Z-3','G1 X4 Z-3 A0.2'),source.replace('X6 Z-4','X4.001 Z-4')]){
  const result=parseGcode(modified,settings);expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('UNSUPPORTED_G71_2');expect(result.segments.every(s=>!s.rawCode.includes('G71.2'))).toBe(true);
 }
});
