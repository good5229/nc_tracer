import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseGcode} from '../../src/parser/gcode';
import {simulateLatheStock} from '../../src/simulation/latheStock';
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
