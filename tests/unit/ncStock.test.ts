import { describe, expect, it } from 'vitest';
import { simulateNcStock } from '../../src/simulation/ncStock';
const program = (cut:string) => `G21 G90 G17\nG0 X5 Y10 Z9\nG1 Z6 F200\n${cut}\nG0 Z12\nM30`;
describe('NC material simulation',()=>{
  it('uses the loaded NC trajectory and a 4mm cutter on the stated stock',()=>{
    const long=simulateNcStock(program('G1 X25 Y10'));
    const short=simulateNcStock(program('G1 X10 Y10'));
    expect(long.ok && short.ok).toBe(true);
    if(long.ok && short.ok){expect(long.removed).toBeGreaterThan(short.removed);expect(long.removed).toBeGreaterThan(0);}
  });
  it('rejects rapid contact, unsupported compensation and incomplete parsing',()=>{
    expect(simulateNcStock('G21 G90\nG0 Z6\nM30')).toMatchObject({ok:false,message:expect.stringContaining('급속')});
    expect(simulateNcStock('G21 G90 G41\nG1 X10\nM30')).toMatchObject({ok:false});
    expect(simulateNcStock('G21 G90\nG1 X10\nG71.2 Q1')).toMatchObject({ok:false});
  });
  it('handles XY arcs and sloping moves, but rejects lathe planes',()=>{
    expect(simulateNcStock(program('G2 X10 Y10 I2.5 J0')).ok).toBe(true);
    expect(simulateNcStock(program('G1 X15 Z7')).ok).toBe(true);
    expect(simulateNcStock('G21 G90 G18\nG1 X5 Z6\nM30').ok).toBe(false);
  });
});
