/**
 * LinuxCNC 2.9.4 straight cutter-compensation entry and lathe-origin translation.
 * Derived from interp_convert.cc and interp_queue.cc (GPL-2.0, see demo/COPYING):
 * https://github.com/LinuxCNC/linuxcnc/tree/v2.9.4/src/emc/rs274ngc
 * This is the entry primitive only; following moves require lookahead and
 * must not use this function as a complete compensated path.
 */
export type LatheNosePoint={x:number;z:number};
export type LatheNoseEntry={ok:true;center:LatheNosePoint;toolOrigin:LatheNosePoint;programmedEnd:LatheNosePoint}|{ok:false;code:'INVALID_TOOL'|'INVALID_COORDINATE'|'ENTRY_TOO_SHORT'};

/** Compute the first straight move in G18/G8. Coordinates and diameter share a unit. */
export function linuxCncLatheNoseEntry(start:LatheNosePoint,end:LatheNosePoint,diameter:number,side:'left'|'right',orientation:number):LatheNoseEntry {
 if(!Number.isFinite(diameter)||diameter<=0||!Number.isInteger(orientation)||orientation<0||orientation>9 || (side!=='left'&&side!=='right')) return {ok:false,code:'INVALID_TOOL'};
 if(![start.x,start.z,end.x,end.z].every(Number.isFinite))return {ok:false,code:'INVALID_COORDINATE'};
 const radius=diameter/2,dx=end.x-start.x,dz=end.z-start.z,distance=Math.hypot(dx,dz);
 if(!(radius>0))return {ok:false,code:'INVALID_TOOL'};
 if(!Number.isFinite(dx)||!Number.isFinite(dz)||!Number.isFinite(distance))return {ok:false,code:'INVALID_COORDINATE'};
 if(distance<=radius)return {ok:false,code:'ENTRY_TOO_SHORT'};
 // LinuxCNC orders G18 coordinates as (Z,X), then offsets to the chosen side.
 const alpha=Math.atan2(dx,dz)+(side==='left'?Math.PI/2:-Math.PI/2);
 const center={x:end.x+radius*Math.sin(alpha),z:end.z+radius*Math.cos(alpha)};
 const toolOrigin={x:center.x+(orientation===2||orientation===6||orientation===1?-radius:orientation===3||orientation===8||orientation===4?radius:0),z:center.z+(orientation===2||orientation===7||orientation===3?-radius:orientation===1||orientation===5||orientation===4?radius:0)};
 if(![center.x,center.z,toolOrigin.x,toolOrigin.z].every(Number.isFinite))return {ok:false,code:'INVALID_COORDINATE'};
 return {ok:true,center,toolOrigin,programmedEnd:{...end}};
}

export type LatheLine={end:LatheNosePoint;motion:'G00'|'G01';sourceLine:number};
export type LatheInputArc={end:LatheNosePoint;center:LatheNosePoint;motion:'G02'|'G03';sourceLine:number};
/** LinuxCNC G70 repositions without cutter compensation between passes while
 * keeping the previous compensated move queued. */
export type LatheBypass={end:LatheNosePoint;motion:'G00_BYPASS';sourceLine:number};
export type LatheInputMove=LatheLine|LatheInputArc|LatheBypass;
export type LatheCompMove={start:LatheNosePoint;end:LatheNosePoint;motion:'G00'|'G01'|'G02'|'G03';sourceLine:number;center?:LatheNosePoint};
export type LatheCompLines={ok:true;moves:LatheCompMove[]}|{ok:false;code:string;sourceLine:number;committed?:LatheCompMove[]};
export const latheNoseOriginOffset=(orientation:number,r:number):LatheNosePoint=>({x:orientation===2||orientation===6||orientation===1?-r:orientation===3||orientation===8||orientation===4?r:0,z:orientation===2||orientation===7||orientation===3?-r:orientation===1||orientation===5||orientation===4?r:0});
const plus=(a:LatheNosePoint,b:LatheNosePoint):LatheNosePoint=>({x:a.x+b.x,z:a.z+b.z});
const cross=(a:LatheNosePoint,b:LatheNosePoint)=>a.z*b.x-a.x*b.z;
const sub=(a:LatheNosePoint,b:LatheNosePoint):LatheNosePoint=>({x:a.x-b.x,z:a.z-b.z});
const times=(a:LatheNosePoint,k:number):LatheNosePoint=>({x:a.x*k,z:a.z*k});

/**
 * G18 compensation with line-to-line lookahead and bounded arc corners.
 * Some arc/arc corners and tool-length offsets are not supported.
 * The parser handles G40 transitions and control flow separately.
 */
export function linuxCncLatheNoseLines(start:LatheNosePoint,lines:LatheInputMove[],diameter:number,side:'left'|'right',orientation:number,allowReferenceSpiral=false):LatheCompLines {
 const error=(code:string,sourceLine:number):LatheCompLines=>({ok:false,code,sourceLine});
 if(!lines.length||lines.length>10000)return error('INVALID_LINE_COUNT',lines[0]?.sourceLine??0);
 if(lines.some(l=>!Number.isInteger(l.sourceLine)||l.sourceLine<1||!['G00','G01','G02','G03','G00_BYPASS'].includes(l.motion)||![l.end.x,l.end.z].every(Number.isFinite)||('center' in l&&![l.center.x,l.center.z].every(Number.isFinite))))return error('INVALID_LINE',lines.find(l=>!Number.isInteger(l.sourceLine)||l.sourceLine<1)?.sourceLine??lines[0].sourceLine);
 if(lines[0].motion==='G02'||lines[0].motion==='G03'||lines[0].motion==='G00_BYPASS')return error('UNSUPPORTED_FIRST_ARC',lines[0].sourceLine);
 const first=linuxCncLatheNoseEntry(start,lines[0].end,diameter,side,orientation);
 if(!first.ok)return error(first.code,lines[0].sourceLine);
 const radius=diameter/2, shift=latheNoseOriginOffset(orientation,radius),toolPoint=(point:LatheNosePoint)=>plus(point,shift);
 const moves:LatheCompMove[]=[{start:{...start},end:first.toolOrigin,motion:lines[0].motion,sourceLine:lines[0].sourceLine}];
 let programStart={...start},programPoint={...lines[0].end},center={...first.center};
 let previousArc=false,previousTangent:LatheNosePoint|undefined,bypassed=false,queuedOriginalStart:LatheNosePoint|undefined,queuedFirst=false,queuedArc:LatheCompMove|undefined;
 for(let i=1;i<lines.length;i++){
  const line=lines[i],a=previousTangent??sub(programPoint,programStart),isArc=line.motion==='G02'||line.motion==='G03';
  if(line.motion==='G00_BYPASS'){
   if(bypassed){
    const pending=moves.pop();
    if(!pending||(!queuedArc&&pending.center))return error('UNSUPPORTED_COMP_G70_QUEUE',line.sourceLine);
    moves.push({start:pending.start,end:{...line.end},motion:'G00',sourceLine:line.sourceLine},{...pending,start:{...line.end}});center={...line.end};continue;
   }
   queuedFirst=moves.length===1;const queued=moves.pop();
   if(!queued)return error('UNSUPPORTED_COMP_G70_QUEUE',line.sourceLine);
   if(queued.center||queued.motion==='G02'||queued.motion==='G03'){
    const reposition={start:queued.start,end:{...line.end},motion:'G00' as const,sourceLine:line.sourceLine};
    if(!queued.center)return {ok:false,code:'UNSUPPORTED_COMP_G70_ARC_QUEUE',sourceLine:line.sourceLine,committed:[...moves,reposition]};
    queuedArc=queued;
    if(Math.hypot(queued.start.x-line.end.x,queued.start.z-line.end.z)>1e-12){moves.push(reposition,{...queued,start:{...line.end}});}
    else moves.push(queued);
   }else moves.push({start:queued.start,end:{...line.end},motion:'G00',sourceLine:line.sourceLine},{...queued,start:{...line.end}});
   queuedOriginalStart={...queued.start};
   center={...line.end};bypassed=true;continue;
  }
  if(bypassed){
   if(line.motion!=='G00'&&line.motion!=='G01')return error('UNSUPPORTED_COMP_G70_QUEUE',line.sourceLine);
   const theta=Math.atan2(center.x-programPoint.x,center.z-programPoint.z);
   let alpha=Math.atan2(line.end.x-programPoint.x,line.end.z-programPoint.z);
   let adjustedTheta=theta;
   if(side==='left' && adjustedTheta<alpha)adjustedTheta+=2*Math.PI;
   if(side==='right' && alpha<adjustedTheta)alpha+=2*Math.PI;
   const beta=(side==='left'?adjustedTheta-alpha:alpha-adjustedTheta)-Math.PI/2,gamma=side==='left'?Math.PI/2:-Math.PI/2;
   if(!Number.isFinite(beta))return error('UNSUPPORTED_COMP_G70_QUEUE',line.sourceLine);
   const pending=moves[moves.length-1],programDirection=sub(programPoint,programStart);
   if(queuedArc){
    const arcQueueError=(code:string):LatheCompLines=>({ok:false,code,sourceLine:line.sourceLine,committed:moves.slice(0,-1)});
    const originalRadius=Math.hypot(queuedArc.start.x-queuedArc.center!.x,queuedArc.start.z-queuedArc.center!.z),anchorRadius=Math.hypot(pending.start.x-queuedArc.center!.x,pending.start.z-queuedArc.center!.z);
    if(!(originalRadius>0)||Math.abs(anchorRadius-originalRadius)>1e-9*Math.max(1,originalRadius))return arcQueueError('UNSUPPORTED_COMP_G70_ARC_QUEUE');
    if(!(beta < -0.01 || beta > Math.PI+0.01))return arcQueueError('UNSUPPORTED_COMP_G70_ARC_QUEUE');
    const previousCenter=sub(queuedArc.center!,shift),oldRadius=Math.hypot(queuedArc.end.x-queuedArc.center!.x,queuedArc.end.z-queuedArc.center!.z),ccw=queuedArc.motion==='G03';
    const inside=(side==='left'&&ccw)||(side==='right'&&!ccw),uncompensatedRadius=inside?oldRadius+radius:oldRadius-radius;
    const base=Math.atan2(line.end.x-programPoint.x,line.end.z-programPoint.z),arcTheta=base+(ccw?Math.PI/2:-Math.PI/2),phi=Math.atan2(previousCenter.x-programPoint.x,previousCenter.z-programPoint.z);
    const distance=uncompensatedRadius*Math.cos(arcTheta-phi)+(inside?-radius:radius),ratio=distance/oldRadius;
    if(!(oldRadius>0)||!Number.isFinite(ratio)||Math.abs(ratio)>1)return arcQueueError('CONCAVE_GOUGING');
    const angle=arcTheta+Math.PI+(inside?(ccw?-1:1):(ccw?1:-1))*Math.acos(ratio),mid={z:previousCenter.z+oldRadius*Math.cos(angle),x:previousCenter.x+oldRadius*Math.sin(angle)};
    const angleOf=(point:LatheNosePoint)=>Math.atan2(point.x-queuedArc!.center!.x,point.z-queuedArc!.center!.z),startAngle=angleOf(queuedArc.start),oldAngle=angleOf(queuedArc.end),newAngle=angleOf(toolPoint(mid));
    const sweep=(end:number)=>((ccw?end-startAngle:startAngle-end)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
    if(sweep(newAngle)>sweep(oldAngle)+.0254)return arcQueueError('CONCAVE_GOUGING');
    pending.end=toolPoint(mid);
    const nextEnd={z:line.end.z+radius*Math.cos(alpha+gamma),x:line.end.x+radius*Math.sin(alpha+gamma)};
    moves.push({start:pending.end,end:toolPoint(nextEnd),motion:line.motion,sourceLine:line.sourceLine});
    center=nextEnd;programStart=programPoint;programPoint={...line.end};previousArc=false;previousTangent=undefined;bypassed=false;queuedOriginalStart=undefined;queuedArc=undefined;continue;
   }
   // LinuxCNC records the *normal* as the queued first entry's direction;
   // subsequent queued straight moves use their programmed direction.
   const entryAngle=Math.atan2(programDirection.x,programDirection.z)+(side==='left'?Math.PI/2:-Math.PI/2);
   const direction=queuedFirst?{z:Math.cos(entryAngle),x:Math.sin(entryAngle)}:programDirection;
   const oldStart=queuedFirst?queuedOriginalStart!:sub(queuedOriginalStart!,shift);
   const checkClip=(point:LatheNosePoint)=>{const delta=sub(point,oldStart);return delta.x*direction.x+delta.z*direction.z>=0;};
   if(beta < -0.01 || beta > Math.PI+0.01){
    const retreat=radius/Math.tan((beta+Math.PI)/2),mid={z:center.z+retreat*Math.cos(adjustedTheta+gamma),x:center.x+retreat*Math.sin(adjustedTheta+gamma)};
    if(![retreat,mid.x,mid.z].every(Number.isFinite)||!checkClip(mid))return {ok:false,code:'CONCAVE_GOUGING',sourceLine:line.sourceLine,committed:moves.slice(0,-1)};
    pending.end=toolPoint(mid);
   }else if(beta>0.01){
    if(!checkClip(center))return {ok:false,code:'CONCAVE_GOUGING',sourceLine:line.sourceLine,committed:moves.slice(0,-1)};
    pending.end=toolPoint(center);
    const mid={z:programPoint.z+radius*Math.cos(alpha+gamma),x:programPoint.x+radius*Math.sin(alpha+gamma)},end=toolPoint(mid);
    moves.push({start:pending.end,end,motion:line.motion==='G00'?'G00':side==='left'?'G02':'G03',sourceLine:line.sourceLine,...(line.motion==='G01'?{center:toolPoint(programPoint)}:{})});
   }
   const nextEnd={z:line.end.z+radius*Math.cos(alpha+gamma),x:line.end.x+radius*Math.sin(alpha+gamma)};
   moves.push({start:moves[moves.length-1].end,end:toolPoint(nextEnd),motion:line.motion,sourceLine:line.sourceLine});
   center=nextEnd;programStart=programPoint;programPoint={...line.end};previousArc=false;previousTangent=undefined;bypassed=false;queuedOriginalStart=undefined;continue;
  }
  let b:LatheNosePoint,arcEndTangent:LatheNosePoint|undefined,arcCenter:LatheNosePoint|undefined;
  if('center' in line){
   arcCenter=line.center;const atStart=sub(programPoint,line.center),atEnd=sub(line.end,line.center),r0=Math.hypot(atStart.x,atStart.z),r1=Math.hypot(atEnd.x,atEnd.z);
   if(!(r0>0)||!Number.isFinite(r0)||!Number.isFinite(r1)||Math.abs(r0-r1)>(allowReferenceSpiral ? .001 : 1e-9*Math.max(1,r0)))return error('INVALID_COMPENSATED_ARC',line.sourceLine);
   const inside=(side==='left' && line.motion==='G03') || (side==='right' && line.motion==='G02');
   if(inside && radius>=r0)return error('COMPENSATION_RADIUS_TOO_LARGE',line.sourceLine);
   const rotate=(v:LatheNosePoint):LatheNosePoint=>line.motion==='G02'?{z:v.x,x:-v.z}:{z:-v.x,x:v.z};
   b=rotate(atStart);arcEndTangent=rotate(atEnd);
  }else b=sub(line.end,programPoint);
  const al=Math.hypot(a.x,a.z),bl=Math.hypot(b.x,b.z);
  if(!Number.isFinite(al)||!Number.isFinite(bl)||al===0||bl===0)return error('INVALID_COMPENSATED_MOVE',line.sourceLine);
  const u=times(a,1/al),v=times(b,1/bl),sign=side==='left'?1:-1;
  const normal=(direction:LatheNosePoint):LatheNosePoint=>({z:-sign*direction.x,x:sign*direction.z});
  const nextStart=plus(programPoint,times(normal(v),radius));
  const endDirection=arcEndTangent?times(arcEndTangent,1/Math.hypot(arcEndTangent.x,arcEndTangent.z)):v;
  const nextEnd=plus(line.end,times(normal(endDirection),radius));
  if(![nextStart.x,nextStart.z,nextEnd.x,nextEnd.z].every(Number.isFinite))return error('INVALID_COORDINATE',line.sourceLine);
  const turn=cross(u,v),dot=u.x*v.x+u.z*v.z;
  if(turn===0 && dot<0)return error('REVERSING_CORNER',line.sourceLine);
  const cornerAngle=Math.atan2(Math.abs(turn),dot);
  const tangentArc=isArc||previousArc;
  const tangent=(tangentArc && Math.abs(turn)<=1e-12 && dot>0)||(allowReferenceSpiral && dot>0 && cornerAngle<=.05);
  if(tangent && tangentArc && !allowReferenceSpiral && Math.hypot(nextStart.x-center.x,nextStart.z-center.z)>1e-9)return error('UNRESOLVED_ARC_JUNCTION',line.sourceLine);
  if(tangentArc && !tangent && dot<0 && Math.abs(turn)<=1e-12)return error('UNSUPPORTED_ARC_CORNER',line.sourceLine);
  if(tangentArc && !tangent && (previousArc && isArc && turn*sign<=0 || line.motion==='G00'))return error('UNSUPPORTED_ARC_CORNER',line.sourceLine);
  if(!tangent && turn!==0 && (cornerAngle<=0.01 || Math.PI-cornerAngle<=0.01))return error('UNSUPPORTED_CORNER_TOLERANCE',line.sourceLine);
  if(tangentArc && !tangent && turn*sign>0){
   const previous=moves[moves.length-1];let mid:LatheNosePoint;
   if(arcCenter && !previousArc){
    const theta=Math.atan2(center.x-programPoint.x,center.z-programPoint.z)+(side==='left'?-Math.PI/2:Math.PI/2);
    const delta=Math.atan2(arcCenter.x-programPoint.x,arcCenter.z-programPoint.z),alpha=delta+(line.motion==='G03'?-Math.PI/2:Math.PI/2);
    let beta=side==='left'?theta-alpha:alpha-theta;
    if(beta>1.5*Math.PI)beta-=2*Math.PI;else if(beta<-Math.PI/2)beta+=2*Math.PI;
    const arcRadius=Math.hypot(line.end.x-arcCenter.x,line.end.z-arcCenter.z),inside=(side==='left'&&line.motion==='G03')||(side==='right'&&line.motion==='G02');
    const compensatedRadius=inside?arcRadius-radius:arcRadius+radius,projection=arcRadius*Math.sin(beta-Math.PI/2)+(inside?radius:-radius),ratio=projection/compensatedRadius;
    if(!(compensatedRadius>0)||!Number.isFinite(ratio)||Math.abs(ratio)>1)return error('CONCAVE_GOUGING',line.sourceLine);
    const angle=inside?(line.motion==='G03'?theta+Math.asin(ratio):theta-Math.asin(ratio)):(line.motion==='G03'?theta+Math.PI-Math.asin(ratio):theta+Math.PI+Math.asin(ratio));
    mid={z:arcCenter.z+compensatedRadius*Math.cos(angle),x:arcCenter.x+compensatedRadius*Math.sin(angle)};
    const clipped=sub(mid,moves.length===1?previous.start:sub(previous.start,shift)),direction=sub(programPoint,programStart);
    if(clipped.x*direction.x+clipped.z*direction.z<0)return error('CONCAVE_GOUGING',line.sourceLine);
   }else if(previousArc && arcCenter && previous.center){
    const previousCenter=sub(previous.center,shift),oldRadius=Math.hypot(previous.end.x-previous.center.x,previous.end.z-previous.center.z);
    const arcRadius=Math.hypot(line.end.x-arcCenter.x,line.end.z-arcCenter.z),currentInside=(side==='left'&&line.motion==='G03')||(side==='right'&&line.motion==='G02'),newRadius=currentInside?arcRadius-radius:arcRadius+radius;
    const between=sub(arcCenter,previousCenter),distance=Math.hypot(between.x,between.z);
    if(!(oldRadius>0)||!(newRadius>0)||!(distance>0))return error('CONCAVE_GOUGING',line.sourceLine);
    const ratio=(oldRadius*oldRadius+distance*distance-newRadius*newRadius)/(2*oldRadius*distance);
    if(!Number.isFinite(ratio)||Math.abs(ratio)>1)return error('CONCAVE_GOUGING',line.sourceLine);
    const previousInside=(side==='left'&&previous.motion==='G03')||(side==='right'&&previous.motion==='G02');
    const direction=Math.atan2(between.x,between.z)+(previousInside?(line.motion==='G03'?1:-1):(line.motion==='G03'?-1:1))*Math.acos(ratio);
    mid={z:previousCenter.z+oldRadius*Math.cos(direction),x:previousCenter.x+oldRadius*Math.sin(direction)};
    const angleOf=(point:LatheNosePoint)=>Math.atan2(point.x-previous.center!.x,point.z-previous.center!.z),startAngle=angleOf(previous.start),oldAngle=angleOf(previous.end),newAngle=angleOf(toolPoint(mid)),ccw=previous.motion==='G03';
    const sweep=(end:number)=>((ccw?end-startAngle:startAngle-end)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
    if(sweep(newAngle)>sweep(oldAngle)+.0254)return error('CONCAVE_GOUGING',line.sourceLine);
   }else if(previousArc && !arcCenter && previous.center){
    const previousCenter=sub(previous.center,shift),oldRadius=Math.hypot(previous.end.x-previous.center.x,previous.end.z-previous.center.z);
    const ccw=previous.motion==='G03',inside=(side==='left'&&ccw)||(side==='right'&&!ccw),uncompensatedRadius=inside?oldRadius+radius:oldRadius-radius;
    const base=Math.atan2(line.end.x-programPoint.x,line.end.z-programPoint.z),theta=base+(ccw?Math.PI/2:-Math.PI/2),phi=Math.atan2(previousCenter.x-programPoint.x,previousCenter.z-programPoint.z);
    const distance=uncompensatedRadius*Math.cos(theta-phi)+(inside?-radius:radius),ratio=distance/oldRadius;
    if(!(oldRadius>0)||!Number.isFinite(ratio)||Math.abs(ratio)>1)return error('CONCAVE_GOUGING',line.sourceLine);
    const angle=theta+Math.PI+(inside?(ccw?-1:1):(ccw?1:-1))*Math.acos(ratio);
    mid={z:previousCenter.z+oldRadius*Math.cos(angle),x:previousCenter.x+oldRadius*Math.sin(angle)};
    const angleOf=(point:LatheNosePoint)=>Math.atan2(point.x-previous.center!.x,point.z-previous.center!.z),startAngle=angleOf(previous.start),oldAngle=angleOf(previous.end),newAngle=angleOf(toolPoint(mid));
    const sweep=(end:number)=>((ccw?end-startAngle:startAngle-end)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
    if(sweep(newAngle)>sweep(oldAngle)+.0254)return error('CONCAVE_GOUGING',line.sourceLine);
   }else return error('UNSUPPORTED_ARC_CORNER',line.sourceLine);
   if(![mid.x,mid.z].every(Number.isFinite))return error('INVALID_COORDINATE',line.sourceLine);
   previous.end=toolPoint(mid);center=mid;
  }else if(!tangent && !tangentArc && turn!==0 && turn*sign>0){
   const delta=sub(nextStart,center),t=cross(delta,v)/turn,s=cross(delta,u)/turn;
   if(!Number.isFinite(t)||!Number.isFinite(s)||t>0||s<0||-t>al||s>bl)return error('CONCAVE_GOUGING',line.sourceLine);
   const intersection=plus(center,times(u,t)),tip=toolPoint(intersection);
   if(![intersection.x,intersection.z,tip.x,tip.z].every(Number.isFinite))return error('INVALID_COORDINATE',line.sourceLine);
   moves[moves.length-1].end=tip;center=intersection;
  } else if(!tangent && turn!==0){
   const end=toolPoint(nextStart), arcCenter=toolPoint(programPoint);
   moves.push({start:toolPoint(center),end,motion:line.motion==='G00'?'G00':side==='left'?'G02':'G03',sourceLine:line.sourceLine,...(line.motion!=='G00'?{center:arcCenter}:{})});center=nextStart;
  }
  if(arcCenter){
   const startRadius=Math.hypot(center.x-arcCenter.x,center.z-arcCenter.z),endRadius=Math.hypot(nextEnd.x-arcCenter.x,nextEnd.z-arcCenter.z);
   if(!(startRadius>0)||Math.abs(startRadius-endRadius)>(allowReferenceSpiral ? .001 : 1e-9*Math.max(1,startRadius)))return error('UNRESOLVED_COMPENSATED_ARC',line.sourceLine);
   moves.push({start:toolPoint(center),end:toolPoint(nextEnd),motion:line.motion,sourceLine:line.sourceLine,center:toolPoint(arcCenter)});
  }else moves.push({start:toolPoint(center),end:toolPoint(nextEnd),motion:line.motion,sourceLine:line.sourceLine});
  center=nextEnd;programStart=programPoint;programPoint={...line.end};previousArc=isArc;previousTangent=arcEndTangent;
 }
 if(bypassed)return error('UNSUPPORTED_COMP_G70_QUEUE',lines.at(-1)!.sourceLine);
 return {ok:true,moves};
}

/** G40 restores the programmed modal position. The first subsequent move must
 * be straight; the physical path starts at the last compensated tool origin. */
export function linuxCncLatheNoseCancel(lastToolOrigin:LatheNosePoint,programmedPosition:LatheNosePoint,exit:{motion:'G00'|'G01'|'G02'|'G03';x?:number;z?:number;sourceLine:number}):LatheCompLines {
 const error=(code:string):LatheCompLines=>({ok:false,code,sourceLine:exit.sourceLine});
 if(!Number.isInteger(exit.sourceLine)||exit.sourceLine<1||![lastToolOrigin.x,lastToolOrigin.z,programmedPosition.x,programmedPosition.z].every(Number.isFinite))return error('INVALID_COORDINATE');
 if(exit.motion!=='G00' && exit.motion!=='G01')return error('G40_EXIT_MUST_BE_STRAIGHT');
 const end={x:exit.x??programmedPosition.x,z:exit.z??programmedPosition.z};
 if(![end.x,end.z].every(Number.isFinite))return error('INVALID_COORDINATE');
 return {ok:true,moves:lastToolOrigin.x===end.x && lastToolOrigin.z===end.z?[]:[{start:{...lastToolOrigin},end,motion:exit.motion,sourceLine:exit.sourceLine}]};
}
