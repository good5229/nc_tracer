import type {MotionSegment,ParseResult,ParserOptions} from '../parser/gcode';
import type {StockComponent} from './stockComponents';
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
export type LatheStockResult={ok:true;remaining:Uint8Array;removed:number;angularCells?:number;grid:LatheStockGrid;partial?:boolean;stopLine?:number;stopMessage?:string;phaseUncertainty?:{sourceLine:number;kind:string}[];components?:StockComponent[];componentLabels?:Uint32Array}|{ok:false;message:string;sourceLine?:number};
export type LatheInsertModel='round-nose'|'example-insert';
/** Rectangular cutting blade, tip centered at the programmed X/Z point. */
export type PartingToolShape={width:number;length:number};
/** Ideal sharp 60-degree threading insert with its tip at the programmed point. */
export type ThreadingToolShape={length:number};
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
function sweptInsert(a:Point,b:Point,radius:number):Point[]{return sweptPolygon(a,b,[{x:-radius,z:0},{x:0,z:-radius},{x:2,z:1},{x:2,z:2}]);}
function insideConvex(point:Point,polygon:Point[]):boolean{
 for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];if((b.x-a.x)*(point.z-a.z)-(b.z-a.z)*(point.x-a.x)<-1e-12)return false;}
 return polygon.length>=3;
}
/** Approximate example stock. Threading assumes an ideal sharp 60-degree
 * external insert and a fixed phase during rapid motions; real acceleration,
 * holder geometry, machine limits and nonzero offsets are not modelled. */
export function simulateLatheStock(result:ParseResult,options:ParserOptions,model:LatheInsertModel='round-nose',grid:LatheStockGrid=LATHE_STOCK,allowPartial=false,partingTools:Record<string,PartingToolShape>={},threadingTools:Record<string,ThreadingToolShape>={}):LatheStockResult{
 const table=options.linuxcncLatheToolReference?.tools;
 if(!table)return {ok:false,message:'선반 예제 공구표를 선택해 NC를 다시 해석해 주세요.'};
 const partial=allowPartial&&result.status==='PARTIAL'&&result.warnings.length===1&&(result.warnings[0].code==='ENTRY_TOO_SHORT'||(options.linuxcncPawnContourReference===true&&result.warnings[0].code==='CONCAVE_GOUGING'));
 if((result.status!=='SUPPORTED'||result.warnings.length)&&!partial)return {ok:false,message:'NC 전체 경로를 확인하지 못해 완성 형상 계산을 중단했습니다.'};
 if(!result.segments.length)return {ok:false,message:'계산할 선반 이동 경로가 없습니다.'};
 if(result.segments.some(s=>/\bG\s*0*76(?:\D|$)/i.test(s.rawCode)&&!s.thread))return {ok:false,message:'나사 가공의 동기화 정보를 확인할 수 없습니다.'};
 const {radialCells:nr,axialCells:nz,step,zMin,angularSegments}=grid;
 if(![grid.radius,grid.zMin,grid.zMax,step,nr,nz,angularSegments].every(Number.isFinite)||!(grid.radius>0)||!(step>0)||!(grid.zMax>grid.zMin)||![nr,nz,angularSegments].every(Number.isInteger)||nr<1||nz<1||angularSegments<3||nr*nz*angularSegments>1_000_000||Math.abs(nr-Math.ceil(grid.radius/step))>0||Math.abs(nz*step-(grid.zMax-grid.zMin))>1e-8)return {ok:false,message:'예제 소재 격자 설정이 유효하지 않습니다.'};
 const angular=result.segments.some(s=>s.thread)?angularSegments:1,remaining=new Uint8Array(nr*nz*angular).fill(1),phaseUncertainty:{sourceLine:number;kind:string}[]=[];let removed=0,work=0;
 const index=(r:number,z:number,a:number)=>(z*nr+r)*angular+a;
 const collision=(message:string,sourceLine:number):LatheStockResult=>partial?{ok:true,remaining,removed,grid,partial:true,stopLine:sourceLine,stopMessage:message,...(phaseUncertainty.length?{phaseUncertainty}:{}),...(angular>1?{angularCells:angular}:{})}:{ok:false,message,sourceLine};
 for(let r=0;r<nr;r++)if((r+.5)*step>grid.radius)for(let z=0;z<nz;z++)for(let a=0;a<angular;a++)remaining[index(r,z,a)]=0;
 for(const segment of result.segments){
  if(!finite(segment.start)||!finite(segment.end)||segment.start.y!==0||segment.end.y!==0||segment.plane!=='XZ')return {ok:false,message:'X/Z 평면의 완전히 알려진 경로만 계산합니다.',sourceLine:segment.sourceLine};
  const tool=segment.tool===undefined?undefined:table[String(segment.tool)];
  if(!tool||!Number.isFinite(tool.diameter)||tool.diameter<=0||!Number.isInteger(tool.orientation)||tool.orientation<0||tool.orientation>9||tool.offsetX!==0||tool.offsetZ!==0)return {ok:false,message:'각 이동에 길이 0인 예제 공구표 항목이 필요합니다.',sourceLine:segment.sourceLine};
  const blade=partingTools[String(segment.tool)],threadTool=threadingTools[String(segment.tool)];
  if(blade&&(!Number.isFinite(blade.width)||!Number.isFinite(blade.length)||blade.width<=0||blade.width>10||blade.length<=0||blade.length>20))return {ok:false,message:'절단 공구 폭과 길이를 확인해 주세요.',sourceLine:segment.sourceLine};
  if(threadTool&&(!Number.isFinite(threadTool.length)||threadTool.length<=0||threadTool.length>20||blade))return {ok:false,message:'나사 공구 길이와 종류를 확인해 주세요.',sourceLine:segment.sourceLine};
  if(model==='example-insert'&&!blade&&!threadTool&&tool.orientation!==2)return {ok:false,message:'예제 인서트 단면은 방향 2인 공구에만 적용할 수 있습니다.',sourceLine:segment.sourceLine};
  if(segment.thread){
   if(blade)return {ok:false,message:'절단 공구를 나사 가공에 사용할 수 없습니다.',sourceLine:segment.sourceLine};
   const t=segment.thread;
   if(!t.external || ![t.pitch,t.phaseTurnsStart,t.phaseTurnsEnd].every(Number.isFinite) || t.pitch<step*2 || t.indexOffsetDegrees!==0 || ![1,-1].includes(t.spindleDirection) || segment.start.x!<0 || segment.end.x!<0 || (t.synchronized&&segment.motion!=='G01'))return {ok:false,message:'예제 나사 계산은 외경 나사, 0.4mm 이상 피치와 기준 위상 0인 경우만 지원합니다.',sourceLine:segment.sourceLine};
   work+=nr*nz*angular;if(work>120_000_000)return {ok:false,message:'선반 형상 계산 범위를 초과했습니다.'};
   const tan30=Math.tan(Math.PI/6),length=threadTool?.length??2,a={x:segment.start.x!,z:segment.start.z!},b={x:segment.end.x!,z:segment.end.z!};
   if(t.synchronized){
    const dz=b.z-a.z,turnSpan=t.phaseTurnsEnd-t.phaseTurnsStart;
    if(!(turnSpan>0)||!Number.isFinite(turnSpan))return {ok:false,message:'동기화된 나사 이동의 회전량을 확인할 수 없습니다.',sourceLine:segment.sourceLine};
    const phaseTolerance=1/(2*angular),lo=t.phaseTurnsStart-phaseTolerance,hi=t.phaseTurnsEnd+phaseTolerance;
    for(let angle=0;angle<angular;angle++){
     const phase=-t.spindleDirection*(angle+.5)/angular,kMin=Math.ceil(lo-phase-1e-12),kMax=Math.floor(hi-phase+1e-12);
     if(kMin>kMax)continue;
     for(let z=0;z<nz;z++)for(let r=0;r<nr;r++){
      const cell=index(r,z,angle);if(!remaining[cell])continue;
      const x=(r+.5)*step,pz=zMin+(z+.5)*step,near=dz===0?kMin:t.phaseTurnsStart+(pz-a.z)/dz*turnSpan-phase;
      const candidates=[kMin,kMax,Math.max(kMin,Math.min(kMax,Math.floor(near))),Math.max(kMin,Math.min(kMax,Math.ceil(near)))];
      if(candidates.some(k=>{const progress=Math.max(0,Math.min(1,(phase+k-t.phaseTurnsStart)/turnSpan)),toolZ=a.z+dz*progress,toolX=a.x+(b.x-a.x)*progress,depth=x-toolX;return depth>=0&&depth<=length&&Math.abs(pz-toolZ)<=depth*tan30;})){remaining[cell]=0;removed++;}
     }
    }
   }else{
    // The ideal preview freezes spindle phase during unsynchronised rapids.
    // Real spindle rotation during these moves is machine-dependent.
    const fraction=((-t.spindleDirection*t.phaseTurnsStart)%1+1)%1;
    const angle=Math.min(angular-1,Math.floor(fraction*angular));
    const polygon=sweptPolygon(a,b,[{x:0,z:0},{x:length,z:-length*tan30},{x:length,z:length*tan30}]);
    let otherPhaseContact=false;
    for(let z=0;z<nz;z++)for(let r=0;r<nr;r++){
     if(!insideConvex({x:(r+.5)*step,z:zMin+(z+.5)*step},polygon))continue;
     if(remaining[index(r,z,angle)])return collision(`나사 공구의 급속 ${t.kind==='approach'?'진입':t.kind==='retract'?'이탈':'위치'} 이동이 예제 소재에 접촉해 계산을 중단했습니다.`,segment.sourceLine);
     if(!otherPhaseContact)for(let candidate=0;candidate<angular;candidate++)if(candidate!==angle&&remaining[index(r,z,candidate)]){otherPhaseContact=true;break;}
    }
    if(otherPhaseContact&&!phaseUncertainty.some(item=>item.sourceLine===segment.sourceLine&&item.kind===t.kind))phaseUncertainty.push({sourceLine:segment.sourceLine,kind:t.kind});
   }
   continue;
  }
  const radius=tool.diameter/2,shift=blade||threadTool?{x:0,z:0}:latheNoseOriginOffset(tool.orientation,radius),points:Point[]=[];
  if(segment.vertices){for(let i=0;i<segment.vertices.length;i+=3){if(segment.vertices[i+1]!==0)return {ok:false,message:'Y축이 포함된 선반 경로는 지원하지 않습니다.',sourceLine:segment.sourceLine};points.push({x:segment.vertices[i]-shift.x,z:segment.vertices[i+2]-shift.z});}}
  else points.push({x:segment.start.x!-shift.x,z:segment.start.z!-shift.z},{x:segment.end.x!-shift.x,z:segment.end.z!-shift.z});
  // Ordinary turning first scans the X/Z section. Angular cells are only
  // visited when that section intersects the tool; charging every angle for
  // every empty section cell needlessly rejects fine threaded-stock grids.
  work+=(points.length-1)*nr*nz*(model==='example-insert'||blade||threadTool?8:1);if(work>120_000_000)return {ok:false,message:'선반 형상 계산 범위를 초과했습니다.'};
  for(let i=1;i<points.length;i++){const polygon=blade?sweptPolygon(points[i-1],points[i],[{x:0,z:-blade.width/2},{x:blade.length,z:-blade.width/2},{x:blade.length,z:blade.width/2},{x:0,z:blade.width/2}]):threadTool?sweptPolygon(points[i-1],points[i],[{x:0,z:0},{x:threadTool.length,z:-threadTool.length*Math.tan(Math.PI/6)},{x:threadTool.length,z:threadTool.length*Math.tan(Math.PI/6)}]):model==='example-insert'?sweptInsert(points[i-1],points[i],radius):[];
   for(let z=0;z<nz;z++)for(let r=0;r<nr;r++){
   const x=(r+.5)*step,pointZ=zMin+(z+.5)*step;
   if((!blade&&!threadTool&&Math.min(distanceSquared({x,z:pointZ},points[i-1],points[i]),distanceSquared({x:-x,z:pointZ},points[i-1],points[i]))<=radius*radius) || (polygon.length>0 && (insideConvex({x,z:pointZ},polygon)||insideConvex({x:-x,z:pointZ},polygon)))){
    work+=angular;if(work>120_000_000)return {ok:false,message:'선반 형상 계산 범위를 초과했습니다.'};
    for(let angle=0;angle<angular;angle++){const cell=index(r,z,angle);if(!remaining[cell])continue;if(segment.motion==='G00')return collision('급속 이동 중 예제 공구와 소재가 접촉해 계산을 중단했습니다.',segment.sourceLine);remaining[cell]=0;removed++;}
   }
   }
  }
 }
 return {ok:true,remaining,removed,grid,...(partial?{partial:true,stopLine:result.warnings[0].sourceLine,stopMessage:result.warnings[0].message}:{}),...(phaseUncertainty.length?{phaseUncertainty}:{}),...(angular>1?{angularCells:angular}:{})};
}
