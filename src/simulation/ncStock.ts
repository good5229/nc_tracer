import { parseGcode, type MotionSegment, type ParserOptions } from '../parser/gcode';
import { STOCK } from './example';

type Point = {x:number;y:number;z:number};
export type NcStockResult = {ok:true; remaining:Uint8Array; removed:number} | {ok:false; message:string};
const RADIUS = 2, LENGTH = 8, MAX_CHECKS = 12_000_000;

// Returns whether the center of a cell intersects a vertical cylinder swept along a line.
export function containsSweptPoint(p:Point, a:Point, b:Point, radius=RADIUS, length=LENGTH):boolean {
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z, x=a.x-p.x,y=a.y-p.y;
  const aa=dx*dx+dy*dy, bb=2*(x*dx+y*dy), cc=x*x+y*y-radius*radius;
  let lo=0,hi=1;
  if (aa===0) { if(cc>0) return false; }
  else {
    const discriminant=bb*bb-4*aa*cc; if(discriminant<0)return false;
    const root=Math.sqrt(discriminant); lo=Math.max(lo,(-bb-root)/(2*aa)); hi=Math.min(hi,(-bb+root)/(2*aa));
  }
  // A point is inside the cutting cylinder when tipZ <= pointZ <= tipZ + LENGTH.
  if(dz===0) { if(p.z<a.z || p.z>a.z+length)return false; }
  else { const t0=(p.z-length-a.z)/dz, t1=(p.z-a.z)/dz;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1)); }
  return lo<=hi;
}
function points(segment:MotionSegment): Point[] {
  if(segment.vertices) {const p:Point[]=[];for(let i=0;i<segment.vertices.length;i+=3)p.push({x:segment.vertices[i],y:segment.vertices[i+1],z:segment.vertices[i+2]});return p;}
  return [segment.start,segment.end].map(p=>({x:p.x!,y:p.y!,z:p.z!}));
}

/** Example setup only. No inference of machine offsets, real cutter comp or spindle behavior. */
export function simulateNcStock(source:string, profile:ParserOptions['controllerProfile']='generic'):NcStockResult {
  const parsed=parseGcode(source,{controllerProfile:profile,initialPosition:{x:0,y:0,z:12}});
  if(parsed.status!=='SUPPORTED' || parsed.warnings.length) return {ok:false,message:'NC 경로를 끝까지 해석할 수 없어 형상 계산을 중단했습니다. 지원되지 않는 명령 또는 좌표 설정을 확인해 주세요.'};
  if(!parsed.segments.length)return {ok:false,message:'계산할 이동 경로가 없습니다.'};
  if(parsed.segments.some(s=>s.plane==='XZ'||s.plane==='YZ'||/\bG\s*0*76(?:\D|$)/i.test(s.rawCode)))return {ok:false,message:'이 예제는 수직 밀링 전용입니다. 선반 사이클이나 XZ/YZ 평면 경로는 지원하지 않습니다.'};
  if(new Set(parsed.segments.map(s=>s.tool).filter(t=>t!==undefined)).size>1)return {ok:false,message:'공구가 여러 개인 NC 파일은 이 단일 공구 예제로 계산할 수 없습니다.'};
  let edges=0;for(const s of parsed.segments) edges+=s.vertices ? s.vertices.length/3-1 : 1;
  if(edges*STOCK.x*STOCK.y*STOCK.z>MAX_CHECKS)return {ok:false,message:'경로가 예제 계산 용량을 초과했습니다.'};
  const remaining=new Uint8Array(STOCK.x*STOCK.y*STOCK.z).fill(1);let removed=0;
  for(const segment of parsed.segments) {
    const path=points(segment);
    for(let i=1;i<path.length;i++) {
      const a=path[i-1],b=path[i];
      for(let z=0;z<STOCK.z;z++)for(let y=0;y<STOCK.y;y++)for(let x=0;x<STOCK.x;x++) {
        const index=(z*STOCK.y+y)*STOCK.x+x;if(!remaining[index])continue;
        if(containsSweptPoint({x:x+.5,y:y+.5,z:z+.5},a,b)) {
          if(segment.motion==='G00')return {ok:false,message:`${segment.sourceLine}행 급속 이동에서 예제 공구와 소재의 접촉이 감지되어 계산을 중단했습니다.`};
          remaining[index]=0;removed++;
        }
      }
    }
  }
  return {ok:true,remaining,removed};
}
