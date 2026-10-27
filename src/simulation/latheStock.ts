import type {MotionSegment,ParseResult,ParserOptions} from '../parser/gcode';
import type {StockComponent} from './stockComponents';
import {threadHalfWidth,sweptThreadToolContains,threadToolIntervals,movingBoxInterval} from './threadToolGeometry';
import {latheNoseOriginOffset} from '../parser/linuxcncLatheNose';

/** Example stock in mm, with an axis along Z and uniform 0.2 mm cells. */
export const LATHE_STOCK={radius:10,zMin:-6,zMax:-1,step:.2,radialCells:50,axialCells:25,angularSegments:48} as const;
export type LatheStockGrid={radius:number;zMin:number;zMax:number;step:number;radialCells:number;axialCells:number;angularSegments:number};
export const LATHE_STOCK_PRESETS:Record<'standard'|'thread-demo'|'pawn-demo',LatheStockGrid>={
 standard:LATHE_STOCK,
 'thread-demo':{radius:3.175,zMin:-16.5,zMax:0,step:.1,radialCells:32,axialCells:165,angularSegments:48},
 'pawn-demo':{radius:15,zMin:-40,zMax:3,step:.2,radialCells:75,axialCells:215,angularSegments:48},
};
/** Physical-tool preview for the original zero-table-radius G76 reference. */
export const THREAD_POINT_PREVIEW_GRID:LatheStockGrid=LATHE_STOCK_PRESETS['thread-demo'];
export type LatheGridContact={radius:number;z:number;angleDegrees?:number};
export type HolderContact={sourceLine:number;tool:number;motion:string;radius:number;z:number};
export type LatheStockResult={ok:true;holderContacts?:HolderContact[];contact?:LatheGridContact;remaining:Uint8Array;removed:number;angularCells?:number;grid:LatheStockGrid;partial?:boolean;stopLine?:number;stopMessage?:string;phaseUncertainty?:{sourceLine:number;kind:string}[];components?:StockComponent[];componentLabels?:Uint32Array}|{ok:false;message:string;sourceLine?:number;contact?:LatheGridContact;holderContacts?:HolderContact[]};
export type LatheInsertModel='round-nose'|'example-insert';
/** Q2 insert section, relative to the circular nose center, in mm. */
export type LatheInsertShape={xExtent:number;zNear:number;zFar:number};
/** Example axis-aligned holder box relative to the tool reference; missing Y is zero. */
export type LatheHolderShape={xMin:number;xMax:number;yMin?:number;yMax?:number;zMin:number;zMax:number};
const validHolder=(s:LatheHolderShape)=>[s.xMin,s.xMax,s.yMin??0,s.yMax??0,s.zMin,s.zMax].every(Number.isFinite)&&s.xMin<s.xMax&&(s.yMin??0)<=(s.yMax??0)&&s.zMin<s.zMax&&[s.xMin,s.xMax,s.yMin??0,s.yMax??0,s.zMin,s.zMax].every(v=>Math.abs(v)<=50);
const intervalDistance=(min:number,max:number)=>min<=0&&max>=0?0:Math.min(Math.abs(min),Math.abs(max));
export const DEFAULT_LATHE_INSERT:LatheInsertShape={xExtent:2,zNear:1,zFar:2};
/** Rectangular cutting blade, tip centered at the programmed X/Z point. */
export type PartingToolShape={width:number;length:number};
/** Symmetric threading insert; the programmed point is its most inward tip. */
export type ThreadingToolShape={length:number;includedAngleDegrees?:number;tipRadius?:number};
type Point={x:number;z:number};
const finite=(p:MotionSegment['start'])=>typeof p.x==='number'&&Number.isFinite(p.x)&&typeof p.y==='number'&&Number.isFinite(p.y)&&typeof p.z==='number'&&Number.isFinite(p.z);
function distanceSquared(point:Point,a:Point,b:Point):number{
 const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
 const t=length===0?0:Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/length));
 return (point.x-a.x-t*dx)**2+(point.z-a.z-t*dz)**2;
}
// Convex hull of the insert's two endpoint positions is its exact swept
// section over a linear move. Points are in X/Z relative to the nose center.
function sweptPolygon(a:Point,b:Point,local:Point[]):Point[]{
 const points=[...local.map(p=>({x:p.x+a.x,z:p.z+a.z})),...local.map(p=>({x:p.x+b.x,z:p.z+b.z}))].sort((p,q)=>p.x-q.x||p.z-q.z);
 const cross=(o:Point,p:Point,q:Point)=>(p.x-o.x)*(q.z-o.z)-(p.z-o.z)*(q.x-o.x);
 const lower:Point[]=[],upper:Point[]=[];
 for(const p of points){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
 for(const p of [...points].reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
 lower.pop();upper.pop();return lower.concat(upper);
}
const validInsert=(s:LatheInsertShape)=>[s.xExtent,s.zNear,s.zFar].every(Number.isFinite)&&s.xExtent>0&&s.xExtent<=20&&s.zNear>=0&&s.zFar>s.zNear&&s.zFar<=20;
function sweptInsert(a:Point,b:Point,radius:number,shape:LatheInsertShape):Point[]{return sweptPolygon(a,b,[{x:-radius,z:0},{x:0,z:-radius},{x:shape.xExtent,z:shape.zNear},{x:shape.xExtent,z:shape.zFar}]);}
function insideConvex(point:Point,polygon:Point[]):boolean{
 for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];if((b.x-a.x)*(point.z-a.z)-(b.z-a.z)*(point.x-a.x)<-1e-12)return false;}
 return polygon.length>=3;
}
/** Approximate example stock. Threading uses a symmetric insert section and
 * fixed phase during rapid motions; real acceleration, holder geometry,
 * machine limits and nonzero offsets are not modelled. An optional rectangular
 * holder reports potential overlaps with stock at the start of each move. */
export function simulateLatheStock(result:ParseResult,options:ParserOptions,model:LatheInsertModel='round-nose',grid:LatheStockGrid=LATHE_STOCK,allowPartial=false,partingTools:Record<string,PartingToolShape>={},threadingTools:Record<string,ThreadingToolShape>={},insertShape:LatheInsertShape=DEFAULT_LATHE_INSERT,insertOverrides:Record<string,LatheInsertShape>={},holder?:LatheHolderShape,holderOverrides:Record<string,LatheHolderShape>={}):LatheStockResult{
 if(holder&&!validHolder(holder))return {ok:false,message:'홀더 단면 범위를 확인해 주세요.'};
 if(model==='example-insert'&&!validInsert(insertShape))return {ok:false,message:'인서트 단면 X 길이와 Z 범위를 확인해 주세요.'};
 const table=options.linuxcncLatheToolReference?.tools;
 if(!table)return {ok:false,message:'선반 예제 공구표를 선택해 NC를 다시 해석해 주세요.'};
 const partial=allowPartial&&result.status==='PARTIAL'&&result.warnings.length===1&&(result.warnings[0].code==='ENTRY_TOO_SHORT'||(options.linuxcncPawnContourReference===true&&result.warnings[0].code==='CONCAVE_GOUGING'));
 if((result.status!=='SUPPORTED'||result.warnings.length)&&!partial)return {ok:false,message:'NC 전체 경로를 확인하지 못해 완성 형상 계산을 중단했습니다.'};
 if(!result.segments.length)return {ok:false,message:'계산할 선반 이동 경로가 없습니다.'};
 if(result.segments.some(s=>/\bG\s*0*76(?:\D|$)/i.test(s.rawCode)&&!s.thread))return {ok:false,message:'나사 가공의 동기화 정보를 확인할 수 없습니다.'};
 const {radialCells:nr,axialCells:nz,step,zMin,angularSegments}=grid;
 const angular=result.segments.some(s=>s.thread)?angularSegments:1;
 if(![grid.radius,grid.zMin,grid.zMax,step,nr,nz,angularSegments].every(Number.isFinite)||!(grid.radius>0)||!(step>0)||!(grid.zMax>grid.zMin)||![nr,nz,angularSegments].every(Number.isInteger)||nr<1||nz<1||angularSegments<3||nr*nz*angular>1_000_000||nr*nz*angularSegments>16_000_000||Math.abs(nr-Math.ceil(grid.radius/step))>0||Math.abs(nz*step-(grid.zMax-grid.zMin))>1e-8)return {ok:false,message:'예제 소재 격자 설정이 유효하지 않습니다.'};
 const remaining=new Uint8Array(nr*nz*angular).fill(1),phaseUncertainty:{sourceLine:number;kind:string}[]=[],holderContacts:HolderContact[]=[];let removed=0,work=0;
 const index=(r:number,z:number,a:number)=>(z*nr+r)*angular+a;
 const collision=(message:string,sourceLine:number,contact:LatheGridContact):LatheStockResult=>partial?{ok:true,remaining,removed,grid,partial:true,stopLine:sourceLine,stopMessage:message,contact,...(holderContacts.length?{holderContacts}:{}),...(phaseUncertainty.length?{phaseUncertainty}:{}),...(angular>1?{angularCells:angular}:{})}:{ok:false,message,sourceLine,contact,...(holderContacts.length?{holderContacts}:{})};
 // Conservative swept section against the stock before each linear piece.
 // During a cut, some of this material may be removed before the holder
 // arrives; report a possibility, not a confirmed physical collision.
 const scanHolder=(a:Point,b:Point,segment:MotionSegment,holder:LatheHolderShape|undefined,sync?:{start:number;end:number;direction:number;length:number;halfAngle:number;tipRadius:number}):boolean=>{
  if(!holder||holderContacts.some(c=>c.sourceLine===segment.sourceLine&&c.tool===segment.tool&&c.motion===segment.motion))return true;
  const polygon=sweptPolygon(a,b,[{x:holder.xMin,z:holder.zMin},{x:holder.xMax,z:holder.zMin},{x:holder.xMax,z:holder.zMax},{x:holder.xMin,z:holder.zMax}]);
  const eps=1e-7,minX=Math.min(...polygon.map(p=>p.x))-eps,maxX=Math.max(...polygon.map(p=>p.x))+eps,minZ=Math.min(...polygon.map(p=>p.z))-eps,maxZ=Math.max(...polygon.map(p=>p.z))+eps;
  const yMin=holder.yMin??0,yMax=holder.yMax??0,hasY=yMin!==0||yMax!==0,timed=hasY?undefined:sync;
  const minR=Math.hypot(intervalDistance(minX,maxX),intervalDistance(yMin,yMax)),maxR=Math.hypot(Math.max(Math.abs(minX),Math.abs(maxX)),Math.max(Math.abs(yMin),Math.abs(yMax)));
  const r0=Math.max(0,Math.ceil(minR/step-.5)),r1=Math.min(nr-1,Math.floor(maxR/step-.5)),z0=Math.max(0,Math.ceil((minZ-zMin)/step-.5)),z1=Math.min(nz-1,Math.floor((maxZ-zMin)/step-.5));
  work+=Math.max(0,r1-r0+1)*Math.max(0,z1-z0+1)*8;if(work>120_000_000)return false;
  for(let z=z0;z<=z1;z++)for(let r=r0;r<=r1;r++){
   const x=(r+.5)*step,pz=zMin+(z+.5)*step;
   if(hasY){
    // Slice the swept X/Z box at this Z, then ask whether any rotation
    // of the stock radius intersects that X/Y rectangle. This deliberately
    // ignores timing and is a conservative potential contact.
    const xs:number[]=[];
    for(let i=0;i<polygon.length;i++){
     const u=polygon[i],v=polygon[(i+1)%polygon.length];
     if(Math.abs(v.z-u.z)<1e-12){if(Math.abs(pz-u.z)<=eps)xs.push(u.x,v.x);}
     else {const q=(pz-u.z)/(v.z-u.z);if(q>=-1e-10&&q<=1+1e-10)xs.push(u.x+q*(v.x-u.x));}
    }
    if(!xs.length)continue;
    const lo=Math.min(...xs),hi=Math.max(...xs),near=Math.hypot(intervalDistance(lo,hi),intervalDistance(yMin,yMax)),far=Math.hypot(Math.max(Math.abs(lo),Math.abs(hi)),Math.max(Math.abs(yMin),Math.abs(yMax)));
    if(x<near-eps||x>far+eps)continue;
   }else if(!insideConvex({x,z:pz},polygon)&&!insideConvex({x:-x,z:pz},polygon))continue;
   work+=angular*(timed?16:1);if(work>120_000_000)return false;
   const plusInterval=timed?movingBoxInterval({x,z:pz},a,b,{xMin:holder.xMin-1e-10,xMax:holder.xMax+1e-10,zMin:holder.zMin-1e-10,zMax:holder.zMax+1e-10}):null;
   const minusInterval=timed?movingBoxInterval({x:-x,z:pz},a,b,{xMin:holder.xMin-1e-10,xMax:holder.xMax+1e-10,zMin:holder.zMin-1e-10,zMax:holder.zMax+1e-10}):null;
   const cuttingIntervals=timed?threadToolIntervals({x,z:pz},a,b,timed.length,timed.halfAngle,timed.tipRadius):[];
   for(let angle=0;angle<angular;angle++)if(remaining[index(r,z,angle)]){
    if(timed){
     const span=timed.end-timed.start,tolerance=1/(2*angular),phase=-timed.direction*(angle+.5)/angular;
     const earliest=(interval:[number,number]|null,atPhase:number)=>{
      if(!interval)return Infinity;
      const low=timed.start+interval[0]*span-(interval[0]===0?tolerance:0),high=timed.start+interval[1]*span+(interval[1]===1?tolerance:0);
      const time=atPhase+Math.ceil(low-atPhase-1e-12);
      return time<=high+1e-12?Math.max(timed.start,Math.min(timed.end,time)):Infinity;
     };
     const hit=Math.min(earliest(plusInterval,phase),earliest(minusInterval,phase-timed.direction*.5));
     if(!Number.isFinite(hit))continue;
     const cut=Math.min(...cuttingIntervals.map(interval=>earliest(interval,phase)));
     if(cut<hit-1e-10)continue;
    }
    if(holderContacts.length>=1000)return false;
    holderContacts.push({sourceLine:segment.sourceLine,tool:segment.tool!,motion:segment.motion,radius:x,z:pz});return true;
   }
  }
  return true;
 };
 for(let r=0;r<nr;r++)if((r+.5)*step>grid.radius)for(let z=0;z<nz;z++)for(let a=0;a<angular;a++)remaining[index(r,z,a)]=0;
 for(const segment of result.segments){
  if(!finite(segment.start)||!finite(segment.end)||segment.start.y!==0||segment.end.y!==0||segment.plane!=='XZ')return {ok:false,message:'X/Z 평면의 완전히 알려진 경로만 계산합니다.',sourceLine:segment.sourceLine};
  const tool=segment.tool===undefined?undefined:table[String(segment.tool)];
  if(!tool||!Number.isFinite(tool.diameter)||tool.diameter<=0||!Number.isInteger(tool.orientation)||tool.orientation<0||tool.orientation>9||!Number.isFinite(tool.offsetX)||!Number.isFinite(tool.offsetZ))return {ok:false,message:'각 이동에 유효한 예제 공구표 항목이 필요합니다.',sourceLine:segment.sourceLine};
  const blade=partingTools[String(segment.tool)],threadTool=threadingTools[String(segment.tool)],currentInsert=insertOverrides[String(segment.tool)]??insertShape,currentHolder=holderOverrides[String(segment.tool)]??holder;
  if(currentHolder&&!validHolder(currentHolder))return {ok:false,message:'공구별 홀더 단면 범위를 확인해 주세요.',sourceLine:segment.sourceLine};
  if(model==='example-insert'&&!blade&&!threadTool&&!validInsert(currentInsert))return {ok:false,message:'공구별 인서트 단면 X 길이와 Z 범위를 확인해 주세요.',sourceLine:segment.sourceLine};
  if(blade&&(!Number.isFinite(blade.width)||!Number.isFinite(blade.length)||blade.width<=0||blade.width>10||blade.length<=0||blade.length>20))return {ok:false,message:'절단 공구 폭과 길이를 확인해 주세요.',sourceLine:segment.sourceLine};
  if(threadTool&&(!Number.isFinite(threadTool.length)||threadTool.length<=0||threadTool.length>20||!Number.isFinite(threadTool.includedAngleDegrees??60)||(threadTool.includedAngleDegrees??60)<10||(threadTool.includedAngleDegrees??60)>160||!Number.isFinite(threadTool.tipRadius??0)||(threadTool.tipRadius??0)<0||(threadTool.tipRadius??0)>threadTool.length||blade))return {ok:false,message:'나사 공구 길이, 날 각도(10~160도)와 끝 반경을 확인해 주세요.',sourceLine:segment.sourceLine};
  if(model==='example-insert'&&!blade&&!threadTool&&tool.orientation!==2)return {ok:false,message:'예제 인서트 단면은 방향 2인 공구에만 적용할 수 있습니다.',sourceLine:segment.sourceLine};
  if(segment.thread){
   if(blade)return {ok:false,message:'절단 공구를 나사 가공에 사용할 수 없습니다.',sourceLine:segment.sourceLine};
   const t=segment.thread;
   if(!t.external || ![t.pitch,t.phaseTurnsStart,t.phaseTurnsEnd].every(Number.isFinite) || t.pitch<step*2 || t.indexOffsetDegrees!==0 || ![1,-1].includes(t.spindleDirection) || segment.start.x!<0 || segment.end.x!<0 || (t.synchronized&&segment.motion!=='G01'))return {ok:false,message:'예제 나사 계산은 외경 나사, 0.4mm 이상 피치와 기준 위상 0인 경우만 지원합니다.',sourceLine:segment.sourceLine};
   work+=nr*nz*angular;if(work>120_000_000)return {ok:false,message:'선반 형상 계산 범위를 초과했습니다.'};
   const halfAngle=(threadTool?.includedAngleDegrees??60)*Math.PI/360,tipRadius=threadTool?.tipRadius??0,length=threadTool?.length??2,a={x:segment.start.x!,z:segment.start.z!},b={x:segment.end.x!,z:segment.end.z!};
   if(t.synchronized){
    const dz=b.z-a.z,turnSpan=t.phaseTurnsEnd-t.phaseTurnsStart;
    if(!(turnSpan>0)||!Number.isFinite(turnSpan))return {ok:false,message:'동기화된 나사 이동의 회전량을 확인할 수 없습니다.',sourceLine:segment.sourceLine};
    if(!scanHolder(a,b,segment,currentHolder,{start:t.phaseTurnsStart,end:t.phaseTurnsEnd,direction:t.spindleDirection,length,halfAngle,tipRadius}))return {ok:false,message:'홀더 간섭 계산 범위를 초과했습니다.',sourceLine:segment.sourceLine};
    const phaseTolerance=1/(2*angular),lo=t.phaseTurnsStart-phaseTolerance,hi=t.phaseTurnsEnd+phaseTolerance;
    for(let angle=0;angle<angular;angle++){
     const phase=-t.spindleDirection*(angle+.5)/angular,kMin=Math.ceil(lo-phase-1e-12),kMax=Math.floor(hi-phase+1e-12);
     if(kMin>kMax)continue;
     for(let z=0;z<nz;z++)for(let r=0;r<nr;r++){
      const cell=index(r,z,angle);if(!remaining[cell])continue;
      const x=(r+.5)*step,pz=zMin+(z+.5)*step,near=dz===0?kMin:t.phaseTurnsStart+(pz-a.z)/dz*turnSpan-phase;
      const candidates=[kMin,kMax,Math.max(kMin,Math.min(kMax,Math.floor(near))),Math.max(kMin,Math.min(kMax,Math.ceil(near)))],dx=b.x-a.x;
      if(dx!==0){
       // A moving tip can enter and leave this cell's radial range between
       // revolutions even for a sharp insert. Check integer phases adjacent
       // to both depth boundaries as well as the rounded-nose extrema.
       const depths=[0,length],slope=dz/dx;
       if(tipRadius>0&&Number.isFinite(slope))depths.push(tipRadius*(1-Math.sin(halfAngle)),tipRadius*(1-slope/Math.hypot(1,slope)),tipRadius*(1+slope/Math.hypot(1,slope)));
       for(const d of depths){
        const k=t.phaseTurnsStart+(x-a.x-d)/dx*turnSpan-phase;
        candidates.push(Math.max(kMin,Math.min(kMax,Math.floor(k))),Math.max(kMin,Math.min(kMax,Math.ceil(k))));
       }
      }
      if(candidates.some(k=>{const progress=Math.max(0,Math.min(1,(phase+k-t.phaseTurnsStart)/turnSpan)),toolZ=a.z+dz*progress,toolX=a.x+dx*progress,depth=x-toolX;return depth>=0&&depth<=length&&Math.abs(pz-toolZ)<=threadHalfWidth(depth,halfAngle,tipRadius);})){remaining[cell]=0;removed++;}
     }
    }
   }else{
    if(!scanHolder(a,b,segment,currentHolder))return {ok:false,message:'홀더 간섭 계산 범위를 초과했습니다.',sourceLine:segment.sourceLine};
    // The ideal preview freezes spindle phase during unsynchronised rapids.
    // Real spindle rotation during these moves is machine-dependent.
    const fraction=((-t.spindleDirection*t.phaseTurnsStart)%1+1)%1;
    const angle=Math.min(angular-1,Math.floor(fraction*angular));
    let otherPhaseContact=false;
    for(let z=0;z<nz;z++)for(let r=0;r<nr;r++){
     if(!sweptThreadToolContains({x:(r+.5)*step,z:zMin+(z+.5)*step},a,b,length,halfAngle,tipRadius))continue;
     if(remaining[index(r,z,angle)])return collision(`나사 공구의 급속 ${t.kind==='approach'?'진입':t.kind==='retract'?'이탈':'위치'} 이동이 예제 소재에 접촉해 계산을 중단했습니다.`,segment.sourceLine,{radius:(r+.5)*step,z:zMin+(z+.5)*step,angleDegrees:(angle+.5)*360/angular});
     if(!otherPhaseContact)for(let candidate=0;candidate<angular;candidate++)if(candidate!==angle&&remaining[index(r,z,candidate)]){otherPhaseContact=true;break;}
    }
    if(otherPhaseContact&&!phaseUncertainty.some(item=>item.sourceLine===segment.sourceLine&&item.kind===t.kind))phaseUncertainty.push({sourceLine:segment.sourceLine,kind:t.kind});
   }
   continue;
  }
  const radius=tool.diameter/2,shift=blade||threadTool?{x:0,z:0}:latheNoseOriginOffset(tool.orientation,radius),points:Point[]=[];
  if(segment.vertices){for(let i=0;i<segment.vertices.length;i+=3){if(segment.vertices[i+1]!==0)return {ok:false,message:'Y축이 포함된 선반 경로는 지원하지 않습니다.',sourceLine:segment.sourceLine};points.push({x:segment.vertices[i]-shift.x,z:segment.vertices[i+2]-shift.z});}}
  else points.push({x:segment.start.x!-shift.x,z:segment.start.z!-shift.z},{x:segment.end.x!-shift.x,z:segment.end.z!-shift.z});
  if(currentHolder&&segment.motion!=='G00'){
   // Apply stock removal between short pieces so a following holder does
   // not report material that the cutter already removed on the same move.
   // Each piece remains a conservative pre-cut holder overlap check.
   const refined:Point[]=[points[0]];
   for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/Math.max(step,.1)));
    if(refined.length+count>100_000)return {ok:false,message:'홀더 간섭 이동 분할 범위를 초과했습니다.',sourceLine:segment.sourceLine};
    for(let n=1;n<=count;n++)refined.push(n===count?b:{x:a.x+(b.x-a.x)*n/count,z:a.z+(b.z-a.z)*n/count});
   }
   points.length=0;for(const point of refined)points.push(point);
  }
  for(let i=1;i<points.length;i++){if(!scanHolder(points[i-1],points[i],segment,currentHolder))return {ok:false,message:'홀더 간섭 계산 범위를 초과했습니다.',sourceLine:segment.sourceLine};const polygon=blade?sweptPolygon(points[i-1],points[i],[{x:0,z:-blade.width/2},{x:blade.length,z:-blade.width/2},{x:blade.length,z:blade.width/2},{x:0,z:blade.width/2}]):!threadTool&&model==='example-insert'?sweptInsert(points[i-1],points[i],radius,currentInsert):[];
   let r0=0,r1=nr-1,z0=0,z1=nz-1;
   if(!blade&&!threadTool&&radius>=1e-4){
    // Conservative X/Z bounds for the swept round nose and insert. Both
    // positive and negative X correspond to the same stock radius.
    const a=points[i-1],b=points[i],eps=1e-7;
    const minX=Math.min(a.x-radius,b.x-radius,...polygon.map(p=>p.x))-eps;
    const maxX=Math.max(a.x+radius,b.x+radius,...polygon.map(p=>p.x))+eps;
    const minZ=Math.min(a.z-radius,b.z-radius,...polygon.map(p=>p.z))-eps;
    const maxZ=Math.max(a.z+radius,b.z+radius,...polygon.map(p=>p.z))+eps;
    const minR=minX<=0&&maxX>=0?0:Math.min(Math.abs(minX),Math.abs(maxX));
    const maxR=Math.max(Math.abs(minX),Math.abs(maxX));
    r0=Math.max(0,Math.ceil(minR/step-.5));r1=Math.min(nr-1,Math.floor(maxR/step-.5));
    z0=Math.max(0,Math.ceil((minZ-zMin)/step-.5));z1=Math.min(nz-1,Math.floor((maxZ-zMin)/step-.5));
   }
   work+=Math.max(0,r1-r0+1)*Math.max(0,z1-z0+1)*(model==='example-insert'||blade||threadTool?8:1);
   if(work>120_000_000)return {ok:false,message:'선반 형상 계산 범위를 초과했습니다.'};
   for(let z=z0;z<=z1;z++)for(let r=r0;r<=r1;r++){
   const x=(r+.5)*step,pointZ=zMin+(z+.5)*step;
   if((threadTool&&[x,-x].some(radial=>sweptThreadToolContains({x:radial,z:pointZ},points[i-1],points[i],threadTool.length,(threadTool.includedAngleDegrees??60)*Math.PI/360,threadTool.tipRadius??0))) || (!blade&&!threadTool&&Math.min(distanceSquared({x,z:pointZ},points[i-1],points[i]),distanceSquared({x:-x,z:pointZ},points[i-1],points[i]))<=radius*radius) || (polygon.length>0 && (insideConvex({x,z:pointZ},polygon)||insideConvex({x:-x,z:pointZ},polygon)))){
    work+=angular;if(work>120_000_000)return {ok:false,message:'선반 형상 계산 범위를 초과했습니다.'};
    for(let angle=0;angle<angular;angle++){const cell=index(r,z,angle);if(!remaining[cell])continue;if(segment.motion==='G00')return collision('급속 이동 중 예제 공구와 소재가 접촉해 계산을 중단했습니다.',segment.sourceLine,{radius:x,z:pointZ,...(angular>1?{angleDegrees:(angle+.5)*360/angular}:{})});remaining[cell]=0;removed++;}
   }
   }
  }
 }
 return {ok:true,remaining,removed,grid,...(holderContacts.length?{holderContacts}:{}),...(partial?{partial:true,stopLine:result.warnings[0].sourceLine,stopMessage:result.warnings[0].message}:{}),...(phaseUncertainty.length?{phaseUncertainty}:{}),...(angular>1?{angularCells:angular}:{})};
}
