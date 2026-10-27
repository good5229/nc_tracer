import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseGcode} from '../../src/parser/gcode';
import {simulateLatheStock,LATHE_STOCK_PRESETS} from '../../src/simulation/latheStock';
const options={controllerProfile:'linuxcnc' as const,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}},initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute' as const};
const src='G21 G90 G18 G8\nT1 M6\nG43\nG0 X10 Z1\nG41\nG1 X8 Z1 F100\nG1 X8 Z-5\nG1 X11 Z-5\nG40\nG0 X12\nM2';
it('removes stock using the loaded example tool and retains uncompensated material',()=>{
 const parsed=parseGcode(src,options);expect(parsed.status).toBe('SUPPORTED');const simulated=simulateLatheStock(parsed,options);expect(simulated.ok).toBe(true);if(simulated.ok){expect(simulated.removed).toBeGreaterThan(0);expect(simulated.remaining.some(v=>v===1)).toBe(true);expect(simulated.remaining[14*50+39]).toBe(0);expect(simulated.remaining[14*50+2]).toBe(1);}
});
it('refuses incomplete paths, missing tools, and spindle-synchronized threading',()=>{
 const parsed=parseGcode(src,options);expect(simulateLatheStock({...parsed,status:'PARTIAL'},options).ok).toBe(false);
 expect(simulateLatheStock({...parsed,segments:parsed.segments.map(s=>({...s,tool:undefined}))},options).ok).toBe(false);
 expect(simulateLatheStock({...parsed,segments:parsed.segments.map((s,i)=>i===0?{...s,rawCode:'G76 P1'}:s)},options).ok).toBe(false);
});

it('stops if the example nose meets stock during a rapid move',()=>{
 const code='G21 G90 G18 G8\nT1 M6\nG43\nG0 X0 Z-3\nM30';
 const parsed=parseGcode(code,options);expect(parsed.status).toBe('SUPPORTED');
 const outcome=simulateLatheStock(parsed,options);expect(outcome.ok).toBe(false);if(!outcome.ok)expect(outcome.message).toContain('급속');
});

it('uses loaded-tool G70 moves in the example stock calculation',()=>{
 const source=readFileSync(new URL('../fixtures/g70_single.ngc',import.meta.url),'utf8');
 const parsed=parseGcode(`T1 M6\n${source}`,options);
 expect(parsed.status).toBe('SUPPORTED');
 const outcome=simulateLatheStock(parsed,options);
 expect(outcome.ok).toBe(true);
 if(outcome.ok)expect(outcome.removed).toBeGreaterThan(0);
});
it('uses the compensated G70 path in the example stock calculation',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_straight.ngc',import.meta.url),'utf8').replace('G1 X8 Z-5','G1 X11 Z-5');
 const parsed=parseGcode(source,options);expect(parsed.status).toBe('SUPPORTED');
 const outcome=simulateLatheStock(parsed,options);
 expect(outcome.ok).toBe(true);if(outcome.ok)expect(outcome.removed).toBeGreaterThan(0);
});
it('detects example-stock contact on the LinuxCNC multipass return',()=>{
 const source=readFileSync(new URL('../fixtures/g70_comp_multi.ngc',import.meta.url),'utf8');
 const parsed=parseGcode(source,options);expect(parsed.status).toBe('SUPPORTED');
 const outcome=simulateLatheStock(parsed,options);expect(outcome.ok).toBe(false);
 if(!outcome.ok){expect(outcome.message).toContain('급속');expect(outcome.sourceLine).toBe(source.split(/\r?\n/).findIndex(line=>line.startsWith('G70 '))+1);}
});
it('sweeps the example insert body as well as the round nose',()=>{
 const code='G21 G90 G18 G8\nT1 M6\nG0 X12 Z0\nG0 Z-3\nG1 X8 F100\nG0 X12\nM2';
 const parsed=parseGcode(code,options);expect(parsed.status).toBe('SUPPORTED');
 const round=simulateLatheStock(parsed,options,'round-nose'),insert=simulateLatheStock(parsed,options,'example-insert');
 expect(round.ok).toBe(true);expect(insert.ok).toBe(true);
 if(round.ok&&insert.ok){expect(insert.removed).toBeGreaterThan(round.removed);expect(insert.remaining[17*50+47]).toBe(0);expect(round.remaining[17*50+47]).toBe(1);}
 const wrongOrientation={...options,linuxcncLatheToolReference:{tools:{'1':{diameter:.4,orientation:3,offsetX:0,offsetZ:0}}}};
 expect(simulateLatheStock(parsed,wrongOrientation,'example-insert')).toMatchObject({ok:false,message:expect.stringContaining('방향 2')});
});
it('removes a helical groove with the example external threading tool',()=>{
 const code='G21 G90 G18 G8\nT1 M6\nG0 X12 Z0\nS500 M3\nG0 X11\nG76 P1.2 Z-5.5 I-1 J.2 K1 R1\nG0 X12\nM2';
 const parsed=parseGcode(code,options);expect(parsed.status).toBe('SUPPORTED');
 const shape=simulateLatheStock(parsed,options);if(!shape.ok)throw new Error(shape.message);expect(shape.ok).toBe(true);
 if(shape.ok){expect(shape.angularCells).toBe(48);expect(shape.removed).toBeGreaterThan(0);
  const nr=50,na=48,z=10,r=49,ring=Array.from(shape.remaining.slice((z*nr+r)*na,(z*nr+r+1)*na));
  expect(ring).toContain(0);expect(ring).toContain(1);
  const before=Array.from(shape.remaining.slice((7*nr+r)*na,(7*nr+r+1)*na)),after=Array.from(shape.remaining.slice((8*nr+r)*na,(8*nr+r+1)*na));
  for(let angle=0;angle<na;angle++)expect(after[(angle+8)%na]).toBe(before[angle]);
 }
});
it('stops a threading rapid approach that enters uncut example stock',()=>{
 const code='G21 G90 G18 G8\nT1 M6\nG0 X12 Z0\nG0 Z-3\nG0 X11\nS500 M3\nG76 P1.2 Z-5.5 I-1 J.2 K1 R1\nM2';
 const parsed=parseGcode(code,options);expect(parsed.status).toBe('SUPPORTED');
 expect(simulateLatheStock(parsed,options)).toMatchObject({ok:false,message:expect.stringContaining('급속 진입')});
});
it('uses pass phase and the radial exit taper for example threading',()=>{
 const code='G21 G90 G18 G8\nT1 M6\nG0 X12 Z0\nS500 M3\nG0 X11\nG76 P1.2 Z-5.5 I-1 J.2 K1 R1 Q29.5 E1 L2\nG0 X12\nM2';
 const parsed=parseGcode(code,options);expect(parsed.status).toBe('SUPPORTED');
 const exits=parsed.segments.filter(s=>s.thread?.kind==='exit-taper');expect(exits.length).toBeGreaterThan(1);
 expect(exits[0].thread!.phaseOriginZ).not.toBe(exits.at(-1)!.thread!.phaseOriginZ);
 const shape=simulateLatheStock(parsed,options);if(!shape.ok)throw new Error(shape.message);expect(shape.angularCells).toBe(48);expect(shape.removed).toBeGreaterThan(0);
});
it('retains phase through synchronized entry and exit tapers',()=>{
 const code='G21 G90 G18 G8\nT1 M6\nG0 X12 Z0\nS500 M3\nG0 X11\nG76 P1.2 Z-5.5 I-1 J.2 K1 R1 E1 L3\nG0 X12\nM2';
 const parsed=parseGcode(code,options);expect(parsed.status).toBe('SUPPORTED');
 const approach=parsed.segments.find(s=>s.thread?.kind==='approach'&&s.thread.synchronized),entry=parsed.segments.find(s=>s.thread?.kind==='entry-taper'),cut=parsed.segments.find(s=>s.thread?.kind==='thread-cut');
 expect(approach?.thread?.phaseTurnsEnd).toBeGreaterThan(0);expect(entry?.thread?.phaseTurnsStart).toBe(approach?.thread?.phaseTurnsEnd);expect(cut?.thread?.phaseTurnsStart).toBe(entry?.thread?.phaseTurnsEnd);
 const shape=simulateLatheStock(parsed,options);if(!shape.ok)throw new Error(shape.message);expect(shape.angularCells).toBe(48);expect(shape.removed).toBeGreaterThan(0);
});
it('mirrors the ideal thread phase when the spindle direction reverses',()=>{
 const code='G21 G90 G18 G8\nT1 M6\nG0 X12 Z0\nS500 M3\nG0 X11\nG76 P1.2 Z-5.5 I-1 J.2 K1 R1\nG0 X12\nM2';
 const forward=simulateLatheStock(parseGcode(code,options),options),reverse=simulateLatheStock(parseGcode(code.replace('M3','M4'),options),options);
 if(!forward.ok)throw new Error(forward.message);if(!reverse.ok)throw new Error(reverse.message);
 const nr=50,na=48,z=8,r=49,offset=(z*nr+r)*na;
 for(let a=0;a<na;a++)expect(forward.remaining[offset+a]).toBe(reverse.remaining[offset+na-1-a]);
});
it('uses explicit stock dimensions and rejects inconsistent grids',()=>{
 const code='G21 G90 G18 G8\nT1 M6\nG0 X12 Z0\nS500 M3\nG0 X11\nG76 P1.2 Z-5.5 I-1 J.2 K1 R1\nG0 X12\nM2';
 const parsed=parseGcode(code,options),grid=LATHE_STOCK_PRESETS['thread-demo'],outcome=simulateLatheStock(parsed,options,'round-nose',grid);
 expect(outcome.ok).toBe(true);if(outcome.ok){expect(outcome.grid).toEqual(grid);expect(outcome.remaining.length).toBe(32*165*48);}
 expect(simulateLatheStock(parsed,options,'round-nose',{...grid,radialCells:31})).toMatchObject({ok:false,message:expect.stringContaining('격자 설정')});
});
