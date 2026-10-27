import {expect,it} from 'vitest';
import {sweptThreadToolContains,threadHalfWidth,threadToolIntervals} from '../../src/simulation/threadToolGeometry';
const half=Math.PI/6,radius=.4,length=2,origin={x:0,z:0};
it('matches the circular nose and its tangent flanks without a bounding-polygon false contact',()=>{
 expect(threadHalfWidth(.1,half,radius)).toBeCloseTo(Math.sqrt(.07),12);
 expect(threadHalfWidth(.2,half,radius)).toBeCloseTo(radius*Math.cos(half),12);
 expect(sweptThreadToolContains({x:0,z:.005},origin,origin,length,half,radius)).toBe(false);
 expect(sweptThreadToolContains({x:.1,z:.2},origin,origin,length,half,radius)).toBe(true);
 expect(sweptThreadToolContains({x:.1,z:.3},origin,origin,length,half,radius)).toBe(false);
 expect(sweptThreadToolContains({x:.5,z:.5},origin,origin,length,half,radius)).toBe(true);
 expect(sweptThreadToolContains({x:.5,z:.6},origin,origin,length,half,radius)).toBe(false);
 expect(sweptThreadToolContains({x:2.1,z:0},origin,origin,length,half,radius)).toBe(false);
});
it('detects the swept tip through a line segment rather than just its ends',()=>{
 const end={x:0,z:-1};
 expect(sweptThreadToolContains({x:.1,z:-.5},origin,end,length,half,radius)).toBe(true);
 expect(sweptThreadToolContains({x:.1,z:-1.4},origin,end,length,half,radius)).toBe(false);
 expect(sweptThreadToolContains({x:0,z:-.5},origin,end,length,half,radius)).toBe(true);
});
it('agrees with dense independent time samples for varied trajectories',()=>{
 let seed=123456789;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
 for(let i=0;i<250;i++){
  const a={x:2*random()-1,z:2*random()-1},b={x:2*random()-1,z:2*random()-1},p={x:3*random()-1,z:3*random()-1};
  let sampled=false;for(let n=0;n<=5000;n++){const q=n/5000,d=p.x-(a.x+(b.x-a.x)*q),z=p.z-(a.z+(b.z-a.z)*q);if(d>=0&&d<=length&&Math.abs(z)<=threadHalfWidth(d,half,radius)){sampled=true;break;}}
  expect(sweptThreadToolContains(p,a,b,length,half,radius),`case ${i}`).toBe(sampled);
 }
});
it('intervals agree with independent samples for rounded and sharp sections',()=>{
 let seed=712345;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
 for(let i=0;i<300;i++){
  const a={x:2*random()-1,z:2*random()-1},b={x:2*random()-1,z:2*random()-1},p={x:3*random()-1,z:3*random()-1},tip=i%2?.4:0;
  const spans=threadToolIntervals(p,a,b,length,half,tip);
  for(let k=0;k<=100;k++){
   const t=k/100,d=p.x-(a.x+(b.x-a.x)*t),z=Math.abs(p.z-(a.z+(b.z-a.z)*t));
   const expected=d>=0&&d<=length&&z<=threadHalfWidth(d,half,tip);
   expect(spans.some(([lo,hi])=>t>=lo-1e-12&&t<=hi+1e-12),`case ${i}, t ${t}`).toBe(expected);
  }
 }
});
