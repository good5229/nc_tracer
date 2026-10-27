import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseGcode} from '../../src/parser/gcode';
import reference from '../fixtures/linuxcnc-lathe-comp-reference.json';
import priorDirections from '../fixtures/linuxcnc-g70-prior-directions.json';
import twoMoves from '../fixtures/linuxcnc-g70-two-moves.json';
import arcAnchor from '../fixtures/linuxcnc-g70-arc-anchor.json';
import arcTop from '../fixtures/linuxcnc-g70-arc-on-top.json';
import anchors from '../fixtures/linuxcnc-g70-anchors.json';
import belowComp from '../fixtures/linuxcnc-g70-comp-below.json';
import lowAllowance from '../fixtures/linuxcnc-g70-comp-lowallow.json';
import lowArc from '../fixtures/linuxcnc-g70-arc-low-other.json';
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
 const invalid=parseGcode(source,{...table,linuxcncLatheToolReference:{tools:{'11':{diameter:.4,orientation:2,offsetX:NaN,offsetZ:0}}}});
 expect(invalid.status).toBe('PARTIAL');expect(invalid.warnings.at(-1)?.code).toBe('UNSUPPORTED_TOOL_LENGTH');
 expect(parseGcode(source,settings).warnings.at(-1)?.code).toBe('UNKNOWN_LATHE_TOOL');
});
it('keeps physical tool position continuous through G43 and G49',()=>{
 // Canonical positions independently checked against LinuxCNC 2.9.4:
 // https://github.com/good5229/nc_tracer/actions/runs/40533488881
 const code='G18 G8 G21 G90\nT1 M6\nG0 X10 Z10\nG43\nG1 X5 F100\nG91 G1 Z-2\nG90\nG49\nG1 Z0\nM2';
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:2,offsetZ:3}}}};
 const result=parseGcode(code,table);expect(result.status).toBe('SUPPORTED');expect(result.warnings).toEqual([]);
 expect(result.segments.map(s=>[s.start.x,s.start.z,s.end.x,s.end.z])).toEqual([[-2,-3,8,7],[8,7,5,7],[5,7,5,5],[5,5,5,-3]]);
 expect(result.finalState.position).toMatchObject({x:7,z:0});
});
it('keeps physical positions consistent through G43 and G92 changes',()=>{
 const code='G18 G8 G21 G90\nT1 M6\nG0 X10 Z10\nG43\nG92 X0 Z0\nG1 X-3 Z-2 F100\nG92.1\nG1 X4\nM2';
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:2,offsetZ:3}}}};
 const result=parseGcode(code,table);expect(result.status).toBe('SUPPORTED');
 expect(result.segments.map(s=>[s.start.x,s.start.z,s.end.x,s.end.z])).toEqual([[-2,-3,8,7],[8,7,5,5],[5,5,4,5]]);
});
it('uses a distinct H offset without treating it as the physical tool size',()=>{
 const code='G18 G8 G21 G90\nT1 M6\nG0 X10 Z10\nG43 H2\nG1 X5 F100\nG49\nG1 Z0\nM2';
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:2,offsetZ:3},'2':{diameter:.4,orientation:2,offsetX:4,offsetZ:6}}}};
 const result=parseGcode(code,table);expect(result.status).toBe('SUPPORTED');
 expect(result.segments.map(s=>[s.start.x,s.start.z,s.end.x,s.end.z])).toEqual([[-2,-3,8,7],[8,7,7,7],[7,7,7,-3]]);
 expect(parseGcode(code.replace('H2','H99'),table).warnings.at(-1)?.code).toBe('UNSUPPORTED_TOOL_LENGTH');
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
it('does not interpret G76 D as a LinuxCNC 2.9.4 spindle angle',()=>{
 const source='G18 G8 G21 G90\nT1 M6\nG0 X10 Z1\nS800 M3\nG76 P1 Z-5 I-.5 J.1 K.3 D120\nM2';
 const result=parseGcode(source,{controllerProfile:'linuxcnc',linuxcncPointToolReference:true,initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute'});
 expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('UNSUPPORTED_THREAD_D');expect(result.segments.some(s=>s.thread)).toBe(false);
});
it('rejects G76 while cutter compensation is active',()=>{
 const source='G18 G8 G21 G90\nT1 M6\nG0 X10 Z1\nS800 M3\nG41.1 D.4 L2\nG76 P1 Z-5 I-.5 J.1 K.3\nM2';
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('INVALID_THREAD_COMP');
 expect(result.segments.some(s=>s.rawCode.includes('G76'))).toBe(false);
});
it.each(['M2','M30'])('flushes compensated motion at standalone %s without a fabricated exit',end=>{
 const source=readFileSync(new URL('../fixtures/lathe_comp_left.ngc',import.meta.url),'utf8');
 const expected=parseGcode(source,settings),ended=parseGcode(source.replace(/G40\s+G0 X11\s+M2/,end),settings);
 expect(ended.status).toBe('SUPPORTED');expect(ended.warnings).toEqual([]);
 expect(ended.segments.map(s=>[s.motion,s.start,s.end])).toEqual(expected.segments.slice(0,-1).map(s=>[s.motion,s.start,s.end]));
});
it('flushes the multipass compensated G70 at M2',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_multi.ngc',import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const reference=parseGcode(source,table),ended=parseGcode(source.replace(/G40\s+G0 X12\s+M2/,'M2'),table);
 expect(ended.status).toBe('SUPPORTED');expect(ended.warnings).toEqual([]);
 expect(ended.segments.map(s=>[s.motion,s.start,s.end])).toEqual(reference.segments.slice(0,-1).map(s=>[s.motion,s.start,s.end]));
 // LinuxCNC 2.9.4 run 40518734540, omitting the duplicate no-motion anchor.
 const canonical=[['G00',10,3],['G00',10,1],['G00',4,.6],['G01',4,-5],['G00',10,1],['G01',9.247,.9843],['G00',4,.1394],['G01',4,-5],['G01',7.8,-5]] as const;
 expect(ended.segments).toHaveLength(canonical.length);ended.segments.forEach((segment,i)=>{expect(segment.motion).toBe(canonical[i][0]);expect(segment.end.x).toBeCloseTo(canonical[i][1],4);expect(segment.end.z).toBeCloseTo(canonical[i][2],4);});
});
it('retains a real gouging failure even when the program ends with M2',()=>{
 const source=readFileSync(new URL('../../demo/lathe_g70_71_demo.ngc',import.meta.url),'utf8');
 const tools=Object.fromEntries([2,10].map(n=>[String(n),{diameter:.4,orientation:2,offsetX:0,offsetZ:0}]));
 const result=parseGcode(source,{...settings,linuxcncLatheToolReference:{tools},linuxcncPawnContourReference:true,initialPosition:{x:20,y:0,z:5}});
 expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('CONCAVE_GOUGING');
});
it('matches LinuxCNC when a compensated move precedes multipass G70',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_pre_move.ngc',import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);
 expect(result.status).toBe('SUPPORTED');expect(result.warnings).toEqual([]);
 const canonical=[['G00',10,3],['G00',10,1],['G01',9.8166,.8],['G00',4,.6306],['G01',4,-5],['G00',10,1],['G01',9.247,.9843],['G00',4,.1394],['G01',4,-5],['G01',7.8,-5],['G00',12,-5]] as const;
 expect(result.segments).toHaveLength(canonical.length);result.segments.forEach((s,i)=>{expect(s.motion,`motion ${i}`).toBe(canonical[i][0]);expect(s.end.x,`X ${i}`).toBeCloseTo(canonical[i][1],4);expect(s.end.z,`Z ${i}`).toBeCloseTo(canonical[i][2],4);if(i)expect(s.start).toEqual(result.segments[i-1].end);});
});
it('identifies gouging when a prior compensated move ends at the G70 anchor',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_pre_at_anchor.ngc',import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('CONCAVE_GOUGING');
 expect(result.segments.map(s=>[s.motion,s.end.x,s.end.z])).toEqual([['G00',10,3],['G00',10,1]]);
});

it.each(['right_x9','left_x11','left_z1','left_z2'] as const)('matches the LinuxCNC compensated G70 reference for %s',name=>{
 const source=readFileSync(new URL(`../fixtures/g70_comp_pre_${name}.ngc`,import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table),expected=priorDirections[name];expect(result.status).toBe('SUPPORTED');expect(result.warnings).toEqual([]);expect(result.segments).toHaveLength(expected.length);
 result.segments.forEach((segment,i)=>{expect(segment.motion,`${name} move ${i}`).toBe(expected[i].motion);expect(segment.end.x,`${name} X ${i}`).toBeCloseTo(expected[i].end[0],4);expect(segment.end.z,`${name} Z ${i}`).toBeCloseTo(expected[i].end[1],4);if(i)expect(segment.start).toEqual(result.segments[i-1].end);});
});
it.each(['right_x11','right_z0','left_x9','left_z0'] as const)('matches the LinuxCNC gouging stop for %s',name=>{
 const source=readFileSync(new URL(`../fixtures/g70_comp_pre_${name}.ngc`,import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('CONCAVE_GOUGING');
 expect(result.segments.map(s=>[s.motion,s.end.x,s.end.z])).toEqual([['G00',10,3],['G00',10,1]]);
});

it.each(['left_x11','left_x9','left_z0','left_z15','right_x11','right_x9','right_z0','right_z15'] as const)('matches LinuxCNC after two compensated moves for %s',name=>{
 const source=readFileSync(new URL(`../fixtures/g70_comp_two_${name}.ngc`,import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table),expected=twoMoves[name];expect(result.status).toBe(expected.status);if(expected.status==='PARTIAL')expect(result.warnings.at(-1)?.code).toBe('CONCAVE_GOUGING');
 expect(result.segments).toHaveLength(expected.moves.length);result.segments.forEach((segment,i)=>{expect(segment.motion,`${name} move ${i}`).toBe(expected.moves[i].motion);expect(segment.end.x,`${name} X ${i}`).toBeCloseTo(expected.moves[i].end[0],4);expect(segment.end.z,`${name} Z ${i}`).toBeCloseTo(expected.moves[i].end[1],4);if(i)expect(segment.start).toEqual(result.segments[i-1].end);});
});
it.each(['left_ccw','left_cw','right_ccw','right_cw'] as const)('preserves the verified prefix and refuses the queued arc for %s',name=>{
 const source=readFileSync(new URL(`../fixtures/g70_comp_pre_arc_${name}.ngc`,import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('UNSUPPORTED_COMP_G70_ARC_QUEUE');
 const expected=[['G00',10,3],['G01',name.startsWith('left')?9.6:10,1.8],['G00',10,1]] as const;
 expect(result.segments).toHaveLength(expected.length);result.segments.forEach((segment,i)=>{expect(segment.motion).toBe(expected[i][0]);expect(segment.end.x).toBeCloseTo(expected[i][1],4);expect(segment.end.z).toBeCloseTo(expected[i][2],4);if(i)expect(segment.start).toEqual(result.segments[i-1].end);});
});

it('matches LinuxCNC G70 when the compensated arc begins at the cycle anchor',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_arc_anchor_left_cw.ngc',import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('SUPPORTED');expect(result.warnings).toEqual([]);expect(result.segments).toHaveLength(arcAnchor.length);
 result.segments.forEach((segment,i)=>{expect(segment.motion,`motion ${i}`).toBe(arcAnchor[i].motion);expect(segment.end.x,`X ${i}`).toBeCloseTo(arcAnchor[i].end[0],4);expect(segment.end.z,`Z ${i}`).toBeCloseTo(arcAnchor[i].end[1],4);if(i)expect(segment.start).toEqual(result.segments[i-1].end);
  const center=arcAnchor[i].center;if(center){const vertices=segment.vertices!;expect(vertices).toBeDefined();const r=Math.hypot(segment.start.x!-center[0],segment.start.z!-center[1]);for(let n=0;n<vertices.length;n+=3)expect(Math.abs(Math.hypot(vertices[n]-center[0],vertices[n+2]-center[1])-r)).toBeLessThan(.0002);}
 });
});
it.each([['left_ccw','LINUXCNC_INVALID_COMP_ARC'],['right_ccw','LINUXCNC_INVALID_COMP_ARC'],['right_cw','CONCAVE_GOUGING']] as const)('stops safely for the anchored arc reference %s',(name,code)=>{
 const source=readFileSync(new URL(`../fixtures/g70_comp_arc_anchor_${name}.ngc`,import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe(code);
 expect(result.segments).toHaveLength(2);expect(result.segments[1].end.x).toBeCloseTo(name.startsWith('left')?9.6:10,4);expect(result.segments[1].end.z).toBeCloseTo(1.8,4);
});

it('matches LinuxCNC when G70 repositions to a different point on a queued arc',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_arc_on_top.ngc',import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('SUPPORTED');expect(result.warnings).toEqual([]);expect(result.segments).toHaveLength(arcTop.length);
 result.segments.forEach((segment,i)=>{const expected=arcTop[i];expect(segment.motion,`motion ${i}`).toBe(expected.motion);expect(segment.end.x,`X ${i}`).toBeCloseTo(expected.end[0],4);expect(segment.end.z,`Z ${i}`).toBeCloseTo(expected.end[1],4);if(i)expect(segment.start).toEqual(result.segments[i-1].end);
  if(expected.center){const center=expected.center,vertices=segment.vertices!;expect(vertices).toBeDefined();const r=Math.hypot(segment.start.x!-center[0],segment.start.z!-center[1]);for(let n=0;n<vertices.length;n+=3)expect(Math.abs(Math.hypot(vertices[n]-center[0],vertices[n+2]-center[1])-r)).toBeLessThan(.0002);}
 });
});
it('keeps both verified rapids before refusing an inconsistent queued arc',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_arc_on_bottom.ngc',import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('UNSUPPORTED_COMP_G70_ARC_QUEUE');
 expect(result.segments.map(s=>[s.motion,s.end.x,s.end.z])).toEqual([['G00',10,3],['G01',9.600000000000001,1.8],['G00',10.8,.6],['G00',10.8,1]]);
});
it.each(['off','right'] as const)('refuses the unverified or inconsistent queued arc at %s',name=>{
 const source=readFileSync(new URL(`../fixtures/g70_comp_arc_on_${name}.ngc`,import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe(name==='right'?'LINUXCNC_INVALID_COMP_ARC':'UNSUPPORTED_COMP_G70_ARC_QUEUE');
});

it.each(['below','far','allowance','above'] as const)('matches the LinuxCNC G70 start reposition with compensation off for %s',name=>{
 const source=readFileSync(new URL(`../fixtures/g70_anchor_${name}.ngc`,import.meta.url),'utf8');
 const point={controllerProfile:'linuxcnc' as const,linuxcncPointToolReference:true,initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute' as const};
 const result=parseGcode(source,point),expected=anchors[name];expect(result.status).toBe('SUPPORTED');expect(result.warnings).toEqual([]);expect(result.segments).toHaveLength(expected.length);
 result.segments.forEach((s,i)=>{expect(s.motion).toBe(expected[i].motion);expect(s.end.x).toBeCloseTo(expected[i].end[0],4);expect(s.end.z).toBeCloseTo(expected[i].end[1],4);if(i)expect(s.start).toEqual(result.segments[i-1].end);});
});
it('refuses unverified non-rapid profile entry below the first point',()=>{
 const source=readFileSync(new URL('../fixtures/g70_anchor_below.ngc',import.meta.url),'utf8').replace('G0 X4 Z1','G1 X4 Z1');
 const point={controllerProfile:'linuxcnc' as const,linuxcncPointToolReference:true,initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute' as const};
 expect(parseGcode(source,point).warnings.at(-1)?.code).toBe('UNSUPPORTED_G70_ANCHOR');
});

it.each(['left_entry','left_prior','right_entry','right_prior'] as const)('matches LinuxCNC compensated G70 with a lower initial anchor for %s',name=>{
 const source=readFileSync(new URL(`../fixtures/g70_comp_below_${name}.ngc`,import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table),expected=belowComp[name];expect(result.status).toBe('SUPPORTED');expect(result.warnings).toEqual([]);expect(result.segments).toHaveLength(expected.length);
 result.segments.forEach((s,i)=>{expect(s.motion,`motion ${i}`).toBe(expected[i].motion);expect(s.end.x,`X ${i}`).toBeCloseTo(expected[i].end[0],4);expect(s.end.z,`Z ${i}`).toBeCloseTo(expected[i].end[1],4);if(i)expect(s.start).toEqual(result.segments[i-1].end);const center=expected[i].center;if(center){const vertices=s.vertices!;expect(vertices).toBeDefined();const r=Math.hypot(s.start.x!-center[0],s.start.z!-center[1]);for(let n=0;n<vertices.length;n+=3)expect(Math.abs(Math.hypot(vertices[n]-center[0],vertices[n+2]-center[1])-r)).toBeLessThan(.0002);}});
});

it.each(['left_entry','left_prior','right_entry','right_prior'] as const)('matches LinuxCNC compensated low-anchor G70 with allowance for %s',name=>{
 const source=readFileSync(new URL(`../fixtures/g70_comp_lowallow_${name}.ngc`,import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table),expected=lowAllowance[name];expect(result.status).toBe('SUPPORTED');expect(result.warnings).toEqual([]);expect(result.segments).toHaveLength(expected.length);
 result.segments.forEach((s,i)=>{expect(s.motion,`motion ${i}`).toBe(expected[i].motion);expect(s.end.x,`X ${i}`).toBeCloseTo(expected[i].end[0],4);expect(s.end.z,`Z ${i}`).toBeCloseTo(expected[i].end[1],4);if(i)expect(s.start).toEqual(result.segments[i-1].end);const center=expected[i].center;if(center){const vertices=s.vertices!;expect(vertices).toBeDefined();const r=Math.hypot(s.start.x!-center[0],s.start.z!-center[1]);for(let n=0;n<vertices.length;n+=3)expect(Math.abs(Math.hypot(vertices[n]-center[0],vertices[n+2]-center[1])-r)).toBeLessThan(.0002);}});
});

it('matches LinuxCNC queued arc after two low-anchor reposition moves',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_arc_low_other.ngc',import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('SUPPORTED');expect(result.warnings).toEqual([]);expect(result.segments).toHaveLength(lowArc.length);
 result.segments.forEach((segment,i)=>{const expected=lowArc[i];expect(segment.motion,`motion ${i}`).toBe(expected.motion);expect(segment.end.x,`X ${i}`).toBeCloseTo(expected.end[0],4);expect(segment.end.z,`Z ${i}`).toBeCloseTo(expected.end[1],4);if(i)expect(segment.start).toEqual(result.segments[i-1].end);if(expected.center){const center=expected.center,vertices=segment.vertices!;expect(vertices).toBeDefined();const r=Math.hypot(segment.start.x!-center[0],segment.start.z!-center[1]);for(let n=0;n<vertices.length;n+=3)expect(Math.abs(Math.hypot(vertices[n]-center[0],vertices[n+2]-center[1])-r)).toBeLessThan(.0002);}});
 // LinuxCNC emits a full circle here even though its printed endpoints match.
 const circle=result.segments[4];expect(circle.motion).toBe('G02');expect(circle.start).toEqual(circle.end);expect(circle.vertices!.length).toBeGreaterThan(150);
});
it('keeps both rapids when LinuxCNC reports inconsistent queued arc radii',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_arc_low_on.ngc',import.meta.url),'utf8');
 const table={...settings,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const result=parseGcode(source,table);expect(result.status).toBe('PARTIAL');expect(result.warnings.at(-1)?.code).toBe('LINUXCNC_INVALID_COMP_ARC');expect(result.segments).toHaveLength(4);
 expect(result.segments[2].end.z).toBeCloseTo(.6);expect(result.segments[3].end.z).toBeCloseTo(1);
});
