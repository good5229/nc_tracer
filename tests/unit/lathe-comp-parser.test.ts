import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseGcode} from '../../src/parser/gcode';
import reference from '../fixtures/linuxcnc-lathe-comp-reference.json';
const settings={controllerProfile:'linuxcnc' as const,linuxcncLatheToolReference:{tools:{}},initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute' as const};
describe('LinuxCNC explicit lathe compensation profile',()=>{
 for(const name of ['lathe_comp_left','lathe_comp_right','lathe_comp_arc'] as const)it(`matches ${name}`,()=>{
  const source=readFileSync(new URL(`../fixtures/${name}.ngc`,import.meta.url),'utf8');const result=parseGcode(source,settings),expected=reference[name].moves;
  expect(result.warnings).toEqual([]);expect(result.status).toBe('SUPPORTED');expect(result.segments).toHaveLength(expected.length);
  result.segments.forEach((s,i)=>{expect(s.motion).toBe(expected[i].motion);expect(s.end.x).toBeCloseTo(expected[i].end[0],4);expect(s.end.z).toBeCloseTo(expected[i].end[1],4);});
 });
 it('rejects a short lead without fabricating compensated moves',()=>{
  const source=readFileSync(new URL('../fixtures/lathe_comp_entry_fail.ngc',import.meta.url),'utf8');const result=parseGcode(source,settings);
  expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('ENTRY_TOO_SHORT');expect(result.segments).toHaveLength(1);
 });
});
it('uses the explicitly loaded tool table for G41 and rejects unknown offsets',()=>{
 const source=readFileSync(new URL('../fixtures/lathe_comp_left.ngc',import.meta.url),'utf8').replace('G41.1 D0.4 L2','T11 M6\nG43\nG41');
 const table={...settings,linuxcncLatheToolReference:{tools:{'11':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('SUPPORTED');
 const expected=reference.lathe_comp_left.moves;expect(result.segments).toHaveLength(expected.length);
 result.segments.forEach((s,i)=>{expect(s.motion).toBe(expected[i].motion);expect(s.end.x).toBeCloseTo(expected[i].end[0],4);expect(s.end.z).toBeCloseTo(expected[i].end[1],4);});
 const invalid=parseGcode(source,{...table,linuxcncLatheToolReference:{tools:{'11':{diameter:.4,orientation:2,offsetX:1,offsetZ:0}}}});
 expect(invalid.status).toBe('PARTIAL');expect(invalid.warnings.at(-1)?.code).toBe('UNSUPPORTED_TOOL_LENGTH');
 expect(parseGcode(source,settings).warnings.at(-1)?.code).toBe('UNKNOWN_LATHE_TOOL');
});
it('requires a loaded tool for cycles and rejects an unclosed compensation section',()=>{
 const cycle=readFileSync(new URL('../fixtures/g70_single.ngc',import.meta.url),'utf8');
 expect(parseGcode(cycle,settings).warnings.at(-1)?.code).toBe('INVALID_LATHE_CYCLE_TOOL');
 const source=readFileSync(new URL('../fixtures/lathe_comp_left.ngc',import.meta.url),'utf8').replace(/G40[\s\S]*/, '');
 expect(parseGcode(source,settings).warnings.at(-1)?.code).toBe('UNCLOSED_LATHE_COMP');
});
it.each(['g70_single','g70_multi','g71_2_pocket','g71_2_double','g70_arc','g71_2_arc'])('retains LinuxCNC cycle paths and the loaded tool for %s',name=>{
 const source=readFileSync(new URL(`../fixtures/${name}.ngc`,import.meta.url),'utf8');
 const point=parseGcode(source,{controllerProfile:'linuxcnc',linuxcncPointToolReference:true,initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute'});
 const actual=parseGcode(`T1 M6\n${source}`,{...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}});
 expect(point.status).toBe('SUPPORTED');expect(actual.status).toBe('SUPPORTED');
 expect(actual.segments.map(s=>[s.motion,s.start,s.end])).toEqual(point.segments.map(s=>[s.motion,s.start,s.end]));
 expect(actual.segments.every(s=>s.tool===1)).toBe(true);
});
it('does not bypass active compensation or the required first move after G40 for a cycle',()=>{
 const source=readFileSync(new URL('../fixtures/g70_single.ngc',import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const before=`T1 M6\n${source}`;
 const active=parseGcode(before.replace('G70 Q100','G41\nG70 Q100'),table);
 expect(active.warnings.at(-1)?.code).toBe('INVALID_CUTTER_COMP');
 const noExit=parseGcode(before.replace('G70 Q100','G41\nG1 X8 Z1\nG40\nG70 Q100'),table);
 expect(noExit.warnings.at(-1)?.code).toBe('INVALID_LATHE_CYCLE_TOOL');
});
it('stops the G76 demo at the actual short compensation entry under a positive T1 diameter',()=>{
 const source=readFileSync(new URL('../../demo/lathe-g76.ngc',import.meta.url),'utf8');
 const tools=Object.fromEntries([1,4,9].map(n=>[String(n),{diameter:.4,orientation:2,offsetX:0,offsetZ:0}]));
 const result=parseGcode(source,{...settings,linuxcncLatheToolReference:{tools}});
 expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('ENTRY_TOO_SHORT');
 expect(result.warnings.at(-1)?.sourceLine).toBe(source.split(/\r?\n/).findIndex(line=>line.trim().toLowerCase()==='g0z1')+1);
});
