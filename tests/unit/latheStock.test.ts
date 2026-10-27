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
it('can show only the confirmed prefix of the original G76 demo without calling it complete',()=>{
 const source=readFileSync(new URL('../../demo/lathe-g76.ngc',import.meta.url),'utf8');
 const tools=Object.fromEntries([1,4,9].map(n=>[String(n),{diameter:.4,orientation:2,offsetX:0,offsetZ:0}]));
 const setup={...options,linuxcncLatheToolReference:{tools}},parsed=parseGcode(source,setup);
 expect(parsed.status).toBe('PARTIAL');expect(parsed.warnings.at(-1)?.code).toBe('ENTRY_TOO_SHORT');
 const shape=simulateLatheStock(parsed,setup,'round-nose',LATHE_STOCK_PRESETS['thread-demo'],true);
 if(!shape.ok)throw new Error(shape.message);expect(shape.partial).toBe(true);expect(shape.removed).toBeGreaterThan(0);
 expect(simulateLatheStock(parsed,setup,'round-nose',LATHE_STOCK_PRESETS['thread-demo'])).toMatchObject({ok:false});
});
it('shows the original pawn demo up to the verified G70 gouging error',()=>{
 const source=readFileSync(new URL('../../demo/lathe_g70_71_demo.ngc',import.meta.url),'utf8');
 const tools=Object.fromEntries([2,10].map(n=>[String(n),{diameter:.4,orientation:2,offsetX:0,offsetZ:0}]));
 const setup={...options,linuxcncLatheToolReference:{tools},linuxcncPawnContourReference:true,initialPosition:{x:20,y:0,z:5}};
 const parsed=parseGcode(source,setup);expect(parsed.status).toBe('PARTIAL');expect(parsed.warnings.at(-1)?.code).toBe('CONCAVE_GOUGING');
 const shape=simulateLatheStock(parsed,setup,'example-insert',LATHE_STOCK_PRESETS['pawn-demo'],true);
 if(!shape.ok)throw new Error(`${shape.message} (row ${shape.sourceLine})`);expect(shape.partial).toBe(true);expect(shape.removed).toBeGreaterThan(0);expect(shape.stopLine).toBe(30);expect(shape.stopMessage).toContain('급속 이동');
});
it('calculates the complete original G76 point-table path with separately assumed physical tools',()=>{
 const source=readFileSync(new URL('../../demo/lathe-g76.ngc',import.meta.url),'utf8');
 const pointOptions={controllerProfile:'linuxcnc' as const,linuxcncPointToolReference:true,initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute' as const};
 const parsed=parseGcode(source,pointOptions);expect(parsed.status).toBe('SUPPORTED');expect(parsed.segments.some(s=>s.thread?.kind==='thread-cut')).toBe(true);
 const tools=Object.fromEntries([1,4,9].map(n=>[String(n),{diameter:.4,orientation:2,offsetX:0,offsetZ:0}]));
 const grid={radius:3.175,zMin:-16.6,zMax:0,step:.2,radialCells:16,axialCells:83,angularSegments:24};
 const shape=simulateLatheStock(parsed,{...pointOptions,linuxcncLatheToolReference:{tools}},'round-nose',grid,false,{'9':{width:1,length:2}},{'4':{length:2}});
 if(!shape.ok)throw new Error(shape.message);expect(shape.angularCells).toBe(24);expect(shape.removed).toBeGreaterThan(0);expect(shape.remaining.some(v=>v===1)).toBe(true);
 let mixedRings=0;for(let i=0;i<shape.remaining.length;i+=24){const ring=shape.remaining.slice(i,i+24);if(ring.some(v=>v===0)&&ring.some(v=>v===1))mixedRings++;}expect(mixedRings).toBeGreaterThan(0);
});
it('sweeps a distinct parting blade across its stated width, including rapid collision checks',()=>{
 const setup={...options,linuxcncLatheToolReference:{tools:{'9':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const program='G21 G90 G18 G8\nT9 M6\nG0 X12 Z0\nG0 Z-3\nG1 X0 F100\nG0 X12\nM2';
 const parsed=parseGcode(program,setup);expect(parsed.status).toBe('SUPPORTED');
 const shape=simulateLatheStock(parsed,setup,'round-nose',undefined,false,{'9':{width:1,length:2}});
 if(!shape.ok)throw new Error(shape.message);const cell=(r:number,z:number)=>shape.remaining[z*50+r];
 expect(cell(5,15)).toBe(0);expect(cell(5,11)).toBe(1);expect(cell(40,15)).toBe(0);
 const unsafe=parseGcode(program.replace('G0 Z-3','G0 X8 Z-3'),setup);
 expect(simulateLatheStock(unsafe,setup,'round-nose',undefined,false,{'9':{width:1,length:2}})).toMatchObject({ok:false,message:expect.stringContaining('급속')});
 expect(simulateLatheStock(parsed,setup,'round-nose',undefined,false,{'9':{width:0,length:2}})).toMatchObject({ok:false,message:expect.stringContaining('폭')});
});
it('uses the sharp threading insert outside the synchronized cycle as well',()=>{
 const setup={...options,initialPosition:{x:12,y:0,z:1},linuxcncLatheToolReference:{tools:{'4':{diameter:.4,orientation:2,offsetX:0,offsetZ:0}}}};
 const parsed=parseGcode('G21 G90 G18 G8\nT4 M6\nG0 X12 Z0\nG0 Z-3\nG1 X8 F100\nG0 X12\nM2',setup);expect(parsed.status).toBe('SUPPORTED');
 const sharp=simulateLatheStock(parsed,setup,'round-nose',undefined,false,{}, {'4':{length:2}}),round=simulateLatheStock(parsed,setup);
 if(!sharp.ok)throw new Error(sharp.message);if(!round.ok)throw new Error(round.message);
 expect(sharp.remaining[18*50+47]).toBe(0);expect(round.remaining[18*50+47]).toBe(1);
 expect(simulateLatheStock(parsed,setup,'round-nose',undefined,false,{}, {'4':{length:0}})).toMatchObject({ok:false,message:expect.stringContaining('나사 공구')});
});
it('uses the threading insert length during synchronized cutting',()=>{
 const code='G21 G90 G18 G8\nT1 M6\nG0 X12 Z0\nS500 M3\nG0 X11\nG76 P1.2 Z-5.5 I-1 J.2 K1 R1\nG0 X12\nM2';
 const parsed=parseGcode(code,{...options,initialPosition:{x:12,y:0,z:1}});
 const setup={...options,initialPosition:{x:12,y:0,z:1}};
 const full=simulateLatheStock(parsed,setup,'round-nose',undefined,false,{}, {'1':{length:2}}),short=simulateLatheStock(parsed,setup,'round-nose',undefined,false,{}, {'1':{length:.3}});
 if(!full.ok)throw new Error(full.message);if(!short.ok)throw new Error(short.message);expect(full.removed).toBeGreaterThan(short.removed);
});
