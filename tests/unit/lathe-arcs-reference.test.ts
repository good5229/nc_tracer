import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseGcode} from '../../src/parser/gcode';
import reference from '../fixtures/linuxcnc-lathe-arcs-reference.json';
const options={controllerProfile:'linuxcnc' as const,linuxcncPointToolReference:true,initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute' as const};
describe('LinuxCNC 2.9.4 arc reference',()=>{
 for(const name of ['g70_arc','g70_arc_offset','g71_2_arc','g71_2_arc_offset'] as const) it(name,()=>{
  const source=readFileSync(new URL(`../fixtures/${name}.ngc`,import.meta.url),'utf8'), result=parseGcode(source,options),expected=reference[name];
  expect(result.warnings).toEqual([]);expect(result.status).toBe('SUPPORTED');expect(result.segments).toHaveLength(expected.length);
  result.segments.forEach((segment,i)=>{
   const value=expected[i];expect(segment.motion).toBe(value.motion);expect(segment.end.x).toBeCloseTo(value.end[0],4);expect(segment.end.z).toBeCloseTo(value.end[1],4);
   if('center' in value && value.center){expect(segment.vertices).toBeDefined();const data=segment.vertices!,r=Math.hypot(segment.start.x!-value.center[0],segment.start.z!-value.center[1]);for(let j=0;j<data.length;j+=3)expect(Math.hypot(data[j]-value.center[0],data[j+2]-value.center[1])).toBeCloseTo(r,4);}
  });
 });
});

it('fails closed on corner offsets whose exact intersection is not verified',()=>{
 for(const name of ['g70_corner','g71_2_corner']){
  const source=readFileSync(new URL(`../fixtures/${name}.ngc`,import.meta.url),'utf8'),result=parseGcode(source,options);
  expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toMatch(/UNSUPPORTED_G(70_PROFILE|71_2)/);
 }
});
