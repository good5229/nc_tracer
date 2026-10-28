import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import {FacePatchFinder, faceAxisDimensions} from '../../src/simulation/facePatch';

describe('grid face selection',()=>{
 it('shows the two varying axes for XY, XZ, and YZ faces',()=>{
  expect(faceAxisDimensions({x:3,y:4,z:0})).toEqual([{axis:'X',length:3},{axis:'Y',length:4}]);
  expect(faceAxisDimensions({x:3,y:0,z:4})).toEqual([{axis:'X',length:3},{axis:'Z',length:4}]);
  expect(faceAxisDimensions({x:0,y:3,z:4})).toEqual([{axis:'Y',length:3},{axis:'Z',length:4}]);
 });
 it('includes connected coplanar faces but excludes disconnected and perpendicular faces',()=>{
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([
   0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,1,0,
   1,0,0, 2,0,0, 2,1,0, 1,0,0, 2,1,0, 1,1,0,
   0,0,0, 1,0,0, 1,0,1, 4,0,0, 5,0,0, 5,1,0,
  ],3));
  const patch=new FacePatchFinder(geometry).find(0)!;
  expect(patch.bounds.min.toArray()).toEqual([0,0,0]);
  expect(patch.bounds.max.toArray()).toEqual([2,1,0]);
  expect(patch.outline.length).toBeGreaterThan(0);
 });
});
