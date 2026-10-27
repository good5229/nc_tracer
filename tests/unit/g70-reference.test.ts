import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseGcode} from '../../src/parser/gcode';
import reference from '../fixtures/linuxcnc-g70-reference.json';
const settings={controllerProfile:'linuxcnc' as const,linuxcncPointToolReference:true,initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute' as const};
it('matches LinuxCNC 2.9.4 for the single-pass straight G70 reference',()=>{
 const source=readFileSync(new URL('../fixtures/g70_single.ngc',import.meta.url),'utf8');const parsed=parseGcode(source,settings);
 expect(parsed.status).toBe('SUPPORTED');expect(parsed.segments.map(s=>({motion:s.motion,end:[s.end.x,s.end.z]}))).toEqual(reference.moves);
});
it('stops on unverified multi-pass or compensated finishing',()=>{
 const source=readFileSync(new URL('../fixtures/g70_multi.ngc',import.meta.url),'utf8');const parsed=parseGcode(source,settings);
 expect(parsed.status).toBe('PARTIAL');expect(parsed.warnings.at(-1)?.code).toBe('UNSUPPORTED_G70');
});
it('stops before a finishing pass with a curved profile or extra axis word',()=>{
 const source=readFileSync(new URL('../fixtures/g70_single.ngc',import.meta.url),'utf8');
 const curved=source.replace('G1 X4 Z-10','G2 X4 Z-10 I1 K0');
 const extra=source.replace('G70 Q100','G70 I1 Q100');
 for(const code of [curved,extra]){const parsed=parseGcode(code,settings);expect(parsed.status).toBe('PARTIAL');expect(parsed.warnings.at(-1)?.code).toMatch(/UNSUPPORTED_G70/);}
});
