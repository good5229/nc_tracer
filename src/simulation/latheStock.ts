import type {MotionSegment,ParseResult,ParserOptions} from '../parser/gcode';
import {latheNoseOriginOffset} from '../parser/linuxcncLatheNose';

/** Example stock in mm, with an axis along Z and uniform 0.2 mm cells. */
export const LATHE_STOCK={radius:10,zMin:-6,zMax:-1,step:.2,radialCells:50,axialCells:25,angularSegments:48} as const;
export type LatheStockResult={ok:true;remaining:Uint8Array;removed:number}|{ok:false;message:string;sourceLine?:number};
export type LatheInsertModel='round-nose'|'example-insert';
type Point={x:number;z:number};
const finite=(p:MotionSegment['start'])=>typeof p.x==='number'&&Number.isFinite(p.x)&&typeof p.y==='number'&&Number.isFinite(p.y)&&typeof p.z==='number'&&Number.isFinite(p.z);
function distanceSquared(point:Point,a:Point,b:Point):number{
 const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
 const t=length===0?0:Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/length));
 return (point.x-a.x-t*dx)**2+(point.z-a.z-t*dz)**2;
}
// Convex hull of the insert's two endpoint positions is its exact swept
// section over a linear move. Points are in X/Z relative to the nose center.
function sweptInsert(a:Point,b:Point,radius:number):Point[]{
 const local=[{x:-radius,z:0},{x:0,z:-radius},{x:2,z:1},{x:2,z:2}];
 const points=[...local.map(p=>({x:p.x+a.x,z:p.z+a.z})),...local.map(p=>({x:p.x+b.x,z:p.z+b.z}))].sort((p,q)=>p.x-q.x||p.z-q.z);
 const cross=(o:Point,p:Point,q:Point)=>(p.x-o.x)*(q.z-o.z)-(p.z-o.z)*(q.x-o.x);
 const lower:Point[]=[],upper:Point[]=[];
 for(const p of points){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
 for(const p of [...points].reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
 lower.pop();upper.pop();return lower.concat(upper);
}
function insideConvex(point:Point,polygon:Point[]):boolean{
 for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];if((b.x-a.x)*(point.z-a.z)-(b.z-a.z)*(point.x-a.x)<-1e-12)return false;}
 return polygon.length>=3;
}
/** Revolved cross-section of an explicitly idealised circular nose insert.
 * G76/threading, holder geometry, spindle phase and nonzero length offsets are
 * not modelled. An incomplete parse is never presented as a completed shape. */
export function simulateLatheStock(result:ParseResult,options:ParserOptions,model:LatheInsertModel='round-nose'):LatheStockResult{
 const table=options.linuxcncLatheToolReference?.tools;
 if(!table)return {ok:false,message:'선반 예제 공구표를 선택해 NC를 다시 해석해 주세요.'};
 if(result.status!=='SUPPORTED'||result.warnings.length)return {ok:false,message:'NC 전체 경로를 확인하지 못해 완성 형상 계산을 중단했습니다.'};
 if(!result.segments.length)return {ok:false,message:'계산할 선반 이동 경로가 없습니다.'};
 if(result.segments.some(s=>/\bG\s*0*76(?:\D|$)/i.test(s.rawCode)))return {ok:false,message:'나사산의 스핀들 위상 및 공구 형상은 아직 계산하지 않습니다.'};
 const {radialCells:nr,axialCells:nz,step,zMin}=LATHE_STOCK,remaining=new Uint8Array(nr*nz).fill(1);let removed=0,edges=0;
 for(const segment of result.segments){
  if(!finite(segment.start)||!finite(segment.end)||segment.start.y!==0||segment.end.y!==0||segment.plane!=='XZ')return {ok:false,message:'X/Z 평면의 완전히 알려진 경로만 계산합니다.',sourceLine:segment.sourceLine};
  const tool=segment.tool===undefined?undefined:table[String(segment.tool)];
  if(!tool||!Number.isFinite(tool.diameter)||tool.diameter<=0||!Number.isInteger(tool.orientation)||tool.orientation<0||tool.orientation>9||tool.offsetX!==0||tool.offsetZ!==0)return {ok:false,message:'각 이동에 길이 0인 예제 공구표 항목이 필요합니다.',sourceLine:segment.sourceLine};
  if(model==='example-insert'&&tool.orientation!==2)return {ok:false,message:'예제 인서트 단면은 방향 2인 공구에만 적용할 수 있습니다.',sourceLine:segment.sourceLine};
  const radius=tool.diameter/2,shift=latheNoseOriginOffset(tool.orientation,radius),points:Point[]=[];
  if(segment.vertices){for(let i=0;i<segment.vertices.length;i+=3){if(segment.vertices[i+1]!==0)return {ok:false,message:'Y축이 포함된 선반 경로는 지원하지 않습니다.',sourceLine:segment.sourceLine};points.push({x:segment.vertices[i]-shift.x,z:segment.vertices[i+2]-shift.z});}}
  else points.push({x:segment.start.x!-shift.x,z:segment.start.z!-shift.z},{x:segment.end.x!-shift.x,z:segment.end.z!-shift.z});
  edges+=points.length-1;if(edges*nr*nz*(model==='example-insert'?8:1)>20_000_000)return {ok:false,message:'선반 형상 계산 범위를 초과했습니다.'};
  for(let i=1;i<points.length;i++){const polygon=model==='example-insert'?sweptInsert(points[i-1],points[i],radius):[];
   for(let z=0;z<nz;z++)for(let r=0;r<nr;r++){
   const index=z*nr+r;if(!remaining[index])continue;
   const x=(r+.5)*step,pointZ=zMin+(z+.5)*step;
   if(Math.min(distanceSquared({x,z:pointZ},points[i-1],points[i]),distanceSquared({x:-x,z:pointZ},points[i-1],points[i]))<=radius*radius || (polygon.length>0 && (insideConvex({x,z:pointZ},polygon)||insideConvex({x:-x,z:pointZ},polygon)))){
    if(segment.motion==='G00')return {ok:false,message:'급속 이동 중 예제 공구와 소재가 접촉해 계산을 중단했습니다.',sourceLine:segment.sourceLine};
    remaining[index]=0;removed++;
   }
   }
  }
 }
 return {ok:true,remaining,removed};
}
