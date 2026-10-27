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
it('resolves incremental moves during compensation while preserving the source mode',()=>{
 const source=readFileSync(new URL('../fixtures/lathe_comp_arc.ngc',import.meta.url),'utf8');
 const incremental=source.replace('G1 X4 Z0','G91 G1 Z-1').replace('G2 X6 Z-2 I2 K0','G2 X2 Z-2 I2 K0').replace('G1 X10 Z-2','G90 G1 X10 Z-2');
 const baseline=parseGcode(source,settings),result=parseGcode(incremental,settings);
 expect(result.status).toBe('SUPPORTED');expect(result.warnings).toEqual([]);
 expect(result.segments.map(s=>[s.motion,s.start,s.end])).toEqual(baseline.segments.map(s=>[s.motion,s.start,s.end]));
 expect(result.segments.find(s=>s.rawCode.includes('G2 X2'))?.distanceMode).toBe('incremental');
});
it('handles convex transitions into and out of a compensated arc',()=>{
 const source=readFileSync(new URL('../fixtures/lathe_comp_arc_convex.ngc',import.meta.url),'utf8');
 const result=parseGcode(source,settings);
 expect(result.warnings).toEqual([]);expect(result.status).toBe('SUPPORTED');
 expect(result.segments.filter(s=>s.vertices)).toHaveLength(3);
 const expected=[['G00',10,1],['G01',3.7671,-.0027],['G02',3.6,-.2],['G02',5.8,-2.4],['G02',5.8485,-2.394],['G01',9.8485,-1.394],['G00',11,-1]] as const;
 expect(result.segments).toHaveLength(expected.length);
 result.segments.forEach((segment,i)=>{expect(segment.motion).toBe(expected[i][0]);expect(segment.end.x).toBeCloseTo(expected[i][1],4);expect(segment.end.z).toBeCloseTo(expected[i][2],4);});
});
it('matches the G42 convex arc reference',()=>{
 const source=readFileSync(new URL('../fixtures/lathe_comp_arc_convex_right.ngc',import.meta.url),'utf8');const result=parseGcode(source,settings);
 expect(result.warnings).toEqual([]);expect(result.status).toBe('SUPPORTED');
 const expected=[['G00',-10,1],['G01',-4.1671,-.0027],['G03',-4,-.2],['G03',-6.2,-2.4],['G03',-6.2485,-2.394],['G01',-10.2485,-1.394],['G00',-11,-1]] as const;
 expect(result.segments).toHaveLength(expected.length);result.segments.forEach((segment,i)=>{expect(segment.motion).toBe(expected[i][0]);expect(segment.end.x).toBeCloseTo(expected[i][1],4);expect(segment.end.z).toBeCloseTo(expected[i][2],4);});
});
it.each([
 ['lathe_comp_line_arc_concave',[['G00',10,1],['G01',4.0079,-.3681],['G02',5.8,-2],['G01',9.8,-2],['G00',11,-2]]],
 ['lathe_comp_arc_line_concave',[['G00',10,1],['G01',3.8,1],['G02',3.6,.8],['G01',3.6,-.2],['G02',5.7748,-2.3999],['G01',9.7515,-3.394],['G00',11,-3]]],
] as const)('matches LinuxCNC for %s',(name,expected)=>{
 const source=readFileSync(new URL(`../fixtures/${name}.ngc`,import.meta.url),'utf8');
 const result=parseGcode(source,settings);expect(result.warnings).toEqual([]);expect(result.status).toBe('SUPPORTED');
 expect(result.segments).toHaveLength(expected.length);result.segments.forEach((segment,i)=>{expect(segment.motion).toBe(expected[i][0]);expect(segment.end.x).toBeCloseTo(expected[i][1],4);expect(segment.end.z).toBeCloseTo(expected[i][2],4);});
});
it('interprets the concave arc-to-arc reference',()=>{
 const source=readFileSync(new URL('../fixtures/lathe_comp_arc_arc_concave.ngc',import.meta.url),'utf8');
 const result=parseGcode(source,settings);expect(result.warnings).toEqual([]);expect(result.status).toBe('SUPPORTED');
 const expected=[['G00',10,1],['G01',3.8,1],['G02',3.6,.8],['G01',3.6,-.2],['G02',5.7506,-2.3994],['G03',6.6211,-5.1106],['G02',6.8,-5.4],['G01',8.8,-5.4],['G00',11,-5]] as const;
 expect(result.segments).toHaveLength(expected.length);result.segments.forEach((segment,i)=>{expect(segment.motion).toBe(expected[i][0]);expect(segment.end.x).toBeCloseTo(expected[i][1],4);expect(segment.end.z).toBeCloseTo(expected[i][2],4);});
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
 const active=parseGcode(before.replace('G70 Q100 X10 Z1 D0 E0 P1','G41\nG71.2 Q100 X10 Z1 D0 I1 R0.3'),table);
 expect(active.warnings.at(-1)?.code).toBe('INVALID_CUTTER_COMP');
 const noExit=parseGcode(before.replace('G70 Q100','G41\nG1 X8 Z1\nG40\nG70 Q100'),table);
 expect(noExit.warnings.at(-1)?.code).toBe('INVALID_LATHE_CYCLE_TOOL');
});
it('supports the bounded compensated G70 reference fixture',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_straight.ngc',import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);
 expect(result.warnings).toEqual([]);expect(result.status).toBe('SUPPORTED');
 const expected=[['G00',10,3],['G00',10,1],['G00',4,.6],['G01',4,-5],['G01',7.8,-5],['G00',12,-5]] as const;
 expect(result.segments).toHaveLength(expected.length);
 result.segments.forEach((segment,i)=>{expect(segment.motion).toBe(expected[i][0]);expect(segment.end.x).toBeCloseTo(expected[i][1],4);expect(segment.end.z).toBeCloseTo(expected[i][2],4);});
});
it.each([
 ['g70_comp_multi',[['G00',10,3],['G00',10,1],['G00',4,.6],['G01',4,-5],['G00',10,1],['G01',9.247,.9843],['G00',4,.1394],['G01',4,-5],['G01',7.8,-5],['G00',12,-5]]],
 ['g70_comp_allowance',[['G00',10,3],['G00',10,1],['G00',4.25,.6],['G01',4.25,-4.75],['G00',10,1],['G01',9.2186,1.0022],['G00',4,.1623],['G01',4,-5],['G01',7.8,-5],['G00',12,-5]]],
] as const)('matches LinuxCNC for %s', (name,expected)=>{
 const source=readFileSync(new URL(`../fixtures/${name}.ngc`,import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.warnings).toEqual([]);expect(result.status).toBe('SUPPORTED');expect(result.segments).toHaveLength(expected.length);
 result.segments.forEach((segment,i)=>{expect(segment.motion).toBe(expected[i][0]);expect(segment.end.x).toBeCloseTo(expected[i][1],4);expect(segment.end.z).toBeCloseTo(expected[i][2],4);if(i)expect(segment.start).toEqual(result.segments[i-1].end);});
});
it('stops the G76 demo at the actual short compensation entry under a positive T1 diameter',()=>{
 const source=readFileSync(new URL('../../demo/lathe-g76.ngc',import.meta.url),'utf8');
 const tools=Object.fromEntries([1,4,9].map(n=>[String(n),{diameter:.4,orientation:2,offsetX:0,offsetZ:0}]));
 const result=parseGcode(source,{...settings,linuxcncLatheToolReference:{tools}});
 expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('ENTRY_TOO_SHORT');
 expect(result.warnings.at(-1)?.sourceLine).toBe(source.split(/\r?\n/).findIndex(line=>line.trim().toLowerCase()==='g0z1')+1);
});
