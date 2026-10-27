import {expect,it} from 'vitest';
import {stockComponents} from '../../src/simulation/stockComponents';
const grid={radius:2,zMin:-2,zMax:1,step:1,radialCells:2,axialCells:3,angularSegments:4};
it('connects adjacent angular cells across the zero-angle seam',()=>{
 const cells=new Uint8Array(24);cells[0]=1;cells[3]=1;cells[16]=1;
 expect(stockComponents(cells,grid,4)).toEqual([{zMin:-2,zMax:-1,cells:2},{zMin:0,zMax:1,cells:1}]);
});
it('supports axisymmetric sections, empty stock, and rejects mismatched dimensions',()=>{
 expect(stockComponents(new Uint8Array([1,1,0,0,1,1]),grid,1)).toEqual([{zMin:-2,zMax:-1,cells:2},{zMin:0,zMax:1,cells:2}]);
 expect(stockComponents(new Uint8Array(6),grid,1)).toEqual([]);
 expect(()=>stockComponents(new Uint8Array(5),grid,1)).toThrow();
});
