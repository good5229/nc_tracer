import { expect, it } from 'vitest';
import { MILL_GRID, simulateReferenceMill } from '../../src/simulation/referenceMill';
it('replays the positive-diameter LinuxCNC milling trace through its last movement',()=>{
 const result=simulateReferenceMill();expect(result).toMatchObject({ok:true});if(result.ok){expect(result.removed).toBeGreaterThan(100);const at=(x:number,y:number,z:number)=>result.remaining[(z*MILL_GRID.ny+y)*MILL_GRID.nx+x];expect(at(10,10,5)).toBe(0);expect(at(10,10,0)).toBe(1);expect(at(70,70,9)).toBe(1);}
});
