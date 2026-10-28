import {describe,expect,it} from 'vitest';
import {simulatePathStock} from '../../src/simulation/pathStockPreview';
describe('illustrative vertical-cutter stock',()=>{
 it('fits the specified path and cuts a trough to its programmed depth',()=>{
  const r=simulatePathStock(new Float64Array([0,0,0,10,0,0]));
  expect(r.ok).toBe(true);if(!r.ok)return;
  expect(r.stock.minX).toBeLessThan(0);expect(r.stock.maxX).toBeGreaterThan(10);
  expect(r.stock.bottom).toBeLessThan(0);expect(r.stock.top).toBeGreaterThan(0);
  expect(r.stock.changedCells).toBeGreaterThan(0);
  expect(Math.min(...r.stock.heights)).toBeCloseTo(0);
 });
 it('sweeps a vertical plunge to its deepest point',()=>{
  const r=simulatePathStock(new Float64Array([0,0,5,0,0,-2]));
  expect(r.ok).toBe(true);if(r.ok)expect(Math.min(...r.stock.heights)).toBeCloseTo(-2);
 });
 it('records the edge that produced the deepest simulated cell',()=>{
  const r=simulatePathStock(new Float64Array([0,0,0,10,0,0,0,0,-2,10,0,-2]));
  expect(r.ok).toBe(true);if(!r.ok)return;
  const i=r.stock.heights.findIndex(z=>z===-2);
  expect(i).toBeGreaterThanOrEqual(0);expect(r.stock.cellEdges[i]).toBe(1);
 });
 it('rejects missing or non-finite path data',()=>{
  expect(simulatePathStock(new Float64Array()).ok).toBe(false);
  expect(simulatePathStock(new Float64Array([0,0,0,1,NaN,1])).ok).toBe(false);
 });
});
