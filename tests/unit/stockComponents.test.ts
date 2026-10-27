import {expect,it} from 'vitest';
import {stockComponents,labelStockComponents} from '../../src/simulation/stockComponents';
const grid={radius:2,zMin:-2,zMax:1,step:1,radialCells:2,axialCells:3,angularSegments:4};
it('connects adjacent angular cells across the zero-angle seam',()=>{
 const cells=new Uint8Array(24);cells[0]=1;cells[3]=1;cells[16]=1;
 const labelled=labelStockComponents(cells,grid,4);expect(labelled.components).toEqual([{zMin:-2,zMax:-1,cells:2},{zMin:0,zMax:1,cells:1}]);expect([labelled.labels[0],labelled.labels[3],labelled.labels[16],labelled.labels[1]]).toEqual([1,1,2,0]);
});
it('supports axisymmetric sections, empty stock, and rejects mismatched dimensions',()=>{
 expect(stockComponents(new Uint8Array([1,1,0,0,1,1]),grid,1)).toEqual([{zMin:-2,zMax:-1,cells:2},{zMin:0,zMax:1,cells:2}]);
 expect(stockComponents(new Uint8Array(6),grid,1)).toEqual([]);
 expect(()=>stockComponents(new Uint8Array(5),grid,1)).toThrow();
});
