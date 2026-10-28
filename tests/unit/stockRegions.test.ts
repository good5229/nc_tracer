import {describe,expect,it} from 'vitest';
import {findRemovedRegions} from '../../src/simulation/stockRegions';

describe('removed stock regions',()=>{
 it('measures side-connected cells separately from diagonal cells',()=>{
  const result=findRemovedRegions({nx:3,ny:2,minX:0,maxX:6,minY:0,maxY:2,bottom:-5,top:0,diameter:1,heights:new Float64Array([-2,-3,0,0,0,-1]),cellEdges:new Int32Array(6),changedCells:3});
  expect(result.regions).toEqual([
   {minX:0,maxX:4,minY:0,maxY:1,minZ:-3,maxZ:0},
   {minX:4,maxX:6,minY:1,maxY:2,minZ:-1,maxZ:0},
  ]);
  expect(Array.from(result.cellRegion)).toEqual([0,0,-1,-1,-1,1]);
 });
});
