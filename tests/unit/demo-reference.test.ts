import { expect, it } from 'vitest';
import { parseGcode } from '../../src/parser/gcode';
import useful from '../../demo/useful-subroutines.ngc?raw';
import g76 from '../../demo/lathe-g76.ngc?raw';
import g70 from '../../demo/lathe_g70_71_demo.ngc?raw';
const setup={controllerProfile:'linuxcnc' as const,linuxcncPointToolReference:true,initialPosition:{x:0,y:0,z:0},initialDistanceMode:'absolute' as const};
it('runs useful-subroutines and G76 with the explicit point-tool reference',()=>{
 const milling=parseGcode(useful,setup),lathe=parseGcode(g76,setup);
 expect(milling.status).toBe('SUPPORTED');expect(milling.segments).toHaveLength(58);
 expect(lathe.status).toBe('SUPPORTED');expect(lathe.segments).toHaveLength(235);
 expect(lathe.segments.filter(segment=>segment.sourceLine===102).length).toBe(175);
 expect(lathe.segments.at(-1)?.end.z).toBeCloseTo(-15.24);expect(lathe.segments.at(-1)?.end.x).toBeCloseTo(5.08);
 const firstArc=lathe.segments.find(segment=>segment.sourceLine===27)!;
 expect(firstArc.end.z).toBeCloseTo(1.3); // G92 translated back into the fixed reference frame.
 const rough=parseGcode(g70,setup);expect(rough.status).toBe('UNSUPPORTED');expect(rough.segments).toHaveLength(0);expect(rough.warnings.at(-1)?.sourceLine).toBe(28);expect(rough.warnings.at(-1)?.message).toContain('no exact intersection');
});
it('keeps coordinates continuous through G92 and G92.1',()=>{
 const result=parseGcode('G21 G90 G0 X0 Y0 Z10\nG92 Z0\nG1 Z5\nG92.1\nG1 Z20\nM2',setup);
 expect(result.segments.map(s=>s.end.z)).toEqual([10,15,20]);
 expect(result.segments[2].start.z).toBe(15);
});

it('renders a radius-defined semicircle with its unique midpoint center',()=>{
 const result=parseGcode('G21 G90 G17 G00 X1 Y0 Z0\nG03 X-1 Y0 R1', {initialPosition:{x:1,y:0,z:0}});
 expect(result.status).toBe('SUPPORTED');
 const vertices=result.segments[0].vertices!;const midpoint=Math.floor(vertices.length/6)*3;
 expect(vertices[midpoint]).toBeCloseTo(0, 5);expect(vertices[midpoint+1]).toBeCloseTo(1, 5);
});

it('matches the official point-tool canonical trace within its printed precision', async()=>{
 const fixture=(await import('../fixtures/linuxcnc-point-reference.json')).default;
 for(const [source,expected] of [[useful,fixture.milling],[g76,fixture.lathe]] as const){
  const result=parseGcode(source,setup);expect(result.segments).toHaveLength(expected.length);
  for(const [index,row] of expected.entries()){
   const segment=result.segments[index];expect(segment.motion,`motion ${index}`).toBe(row.motion);
   for(const [axis,value] of [segment.end.x,segment.end.y,segment.end.z].entries()) expect(Math.abs(value!-row.end[axis]),`endpoint ${index}:${axis}`).toBeLessThanOrEqual(0.00128);
   if ('centerXY' in row && row.centerXY && segment.vertices){
    const [cx,cy]=row.centerXY;const radius=Math.hypot(segment.start.x!-cx,segment.start.y!-cy);
    for(let i=0;i<segment.vertices.length;i+=3)expect(Math.abs(Math.hypot(segment.vertices[i]-cx,segment.vertices[i+1]-cy)-radius)).toBeLessThan(0.003);
   }
  }
 }
});

it('does not silently skip a G71 cycle combined with G92',()=>{
 for(const prefix of ['G92 G71.1 Q100 X10 Z1 I2 R.3','G92.1 G71.1 Q100 I2 R.3']){
  const source=`o100 sub\nG0 X4 Z1\nG1 Z-10\nG1 X10\no100 endsub\nG21 G18 G90 G8\n${prefix}\nG0 X1\nM2`;
  const result=parseGcode(source,setup);
  expect(result.status).toBe('INVALID');expect(result.warnings.at(-1)?.code).toBe('INVALID_G92');
  expect(result.segments).toHaveLength(0);
 }
});
