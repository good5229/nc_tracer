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
export type LatheInputMove=LatheLine|LatheInputArc;
export type LatheCompMove={start:LatheNosePoint;end:LatheNosePoint;motion:'G00'|'G01'|'G02'|'G03';sourceLine:number;center?:LatheNosePoint};
export type LatheCompLines={ok:true;moves:LatheCompMove[]}|{ok:false;code:string;sourceLine:number};
export const latheNoseOriginOffset=(orientation:number,r:number):LatheNosePoint=>({x:orientation===2||orientation===6||orientation===1?-r:orientation===3||orientation===8||orientation===4?r:0,z:orientation===2||orientation===7||orientation===3?-r:orientation===1||orientation===5||orientation===4?r:0});
const plus=(a:LatheNosePoint,b:LatheNosePoint):LatheNosePoint=>({x:a.x+b.x,z:a.z+b.z});
const cross=(a:LatheNosePoint,b:LatheNosePoint)=>a.z*b.x-a.x*b.z;
const sub=(a:LatheNosePoint,b:LatheNosePoint):LatheNosePoint=>({x:a.x-b.x,z:a.z-b.z});
const times=(a:LatheNosePoint,k:number):LatheNosePoint=>({x:a.x*k,z:a.z*k});

/**
 * G18 compensation with line-to-line lookahead and tangent arcs. Non-tangent
 * arc corners and tool-length offsets are not supported by this primitive.
 * The parser handles G40 transitions and control flow separately.
 */
export function linuxCncLatheNoseLines(start:LatheNosePoint,lines:LatheInputMove[],diameter:number,side:'left'|'right',orientation:number):LatheCompLines {
 const error=(code:string,sourceLine:number):LatheCompLines=>({ok:false,code,sourceLine});
 if(!lines.length||lines.length>10000)return error('INVALID_LINE_COUNT',lines[0]?.sourceLine??0);
 if(lines.some(l=>!Number.isInteger(l.sourceLine)||l.sourceLine<1||!['G00','G01','G02','G03'].includes(l.motion)||![l.end.x,l.end.z].every(Number.isFinite)||('center' in l&&![l.center.x,l.center.z].every(Number.isFinite))))return error('INVALID_LINE',lines.find(l=>!Number.isInteger(l.sourceLine)||l.sourceLine<1)?.sourceLine??lines[0].sourceLine);
 if(lines[0].motion==='G02'||lines[0].motion==='G03')return error('UNSUPPORTED_FIRST_ARC',lines[0].sourceLine);
 const first=linuxCncLatheNoseEntry(start,lines[0].end,diameter,side,orientation);
 if(!first.ok)return error(first.code,lines[0].sourceLine);
 const radius=diameter/2, shift=latheNoseOriginOffset(orientation,radius),toolPoint=(point:LatheNosePoint)=>plus(point,shift);
 const moves:LatheCompMove[]=[{start:{...start},end:first.toolOrigin,motion:lines[0].motion,sourceLine:lines[0].sourceLine}];
 let programStart={...start},programPoint={...lines[0].end},center={...first.center};
 let previousArc=false,previousTangent:LatheNosePoint|undefined;
 for(let i=1;i<lines.length;i++){
  const line=lines[i],a=previousTangent??sub(programPoint,programStart),isArc=line.motion==='G02'||line.motion==='G03';
  let b:LatheNosePoint,arcEndTangent:LatheNosePoint|undefined,arcCenter:LatheNosePoint|undefined;
  if('center' in line){
   arcCenter=line.center;const atStart=sub(programPoint,line.center),atEnd=sub(line.end,line.center),r0=Math.hypot(atStart.x,atStart.z),r1=Math.hypot(atEnd.x,atEnd.z);
   if(!(r0>0)||!Number.isFinite(r0)||!Number.isFinite(r1)||Math.abs(r0-r1)>1e-9*Math.max(1,r0))return error('INVALID_COMPENSATED_ARC',line.sourceLine);
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
  if(tangentArc && (Math.abs(turn)>1e-12 || dot<=0))return error('UNSUPPORTED_ARC_CORNER',line.sourceLine);
  if(tangentArc && Math.hypot(nextStart.x-center.x,nextStart.z-center.z)>1e-9)return error('UNRESOLVED_ARC_JUNCTION',line.sourceLine);
  if(!tangentArc && turn!==0 && (cornerAngle<=0.01 || Math.PI-cornerAngle<=0.01))return error('UNSUPPORTED_CORNER_TOLERANCE',line.sourceLine);
  if(!tangentArc && turn!==0 && turn*sign>0){
   const delta=sub(nextStart,center),t=cross(delta,v)/turn,s=cross(delta,u)/turn;
   if(!Number.isFinite(t)||!Number.isFinite(s)||t>0||s<0||-t>al||s>bl)return error('CONCAVE_GOUGING',line.sourceLine);
   const intersection=plus(center,times(u,t)),tip=toolPoint(intersection);
   if(![intersection.x,intersection.z,tip.x,tip.z].every(Number.isFinite))return error('INVALID_COORDINATE',line.sourceLine);
   moves[moves.length-1].end=tip;center=intersection;
  } else if(!tangentArc && turn!==0){
   const end=toolPoint(nextStart), arcCenter=toolPoint(programPoint);
   moves.push({start:toolPoint(center),end,motion:line.motion==='G00'?'G00':side==='left'?'G02':'G03',sourceLine:line.sourceLine,...(line.motion==='G01'?{center:arcCenter}:{})});center=nextStart;
  }
  if(arcCenter){
   const startRadius=Math.hypot(center.x-arcCenter.x,center.z-arcCenter.z),endRadius=Math.hypot(nextEnd.x-arcCenter.x,nextEnd.z-arcCenter.z);
   if(!(startRadius>0)||Math.abs(startRadius-endRadius)>1e-9*Math.max(1,startRadius))return error('UNRESOLVED_COMPENSATED_ARC',line.sourceLine);
   moves.push({start:toolPoint(center),end:toolPoint(nextEnd),motion:line.motion,sourceLine:line.sourceLine,center:toolPoint(arcCenter)});
  }else moves.push({start:toolPoint(center),end:toolPoint(nextEnd),motion:line.motion,sourceLine:line.sourceLine});
  center=nextEnd;programStart=programPoint;programPoint={...line.end};previousArc=isArc;previousTangent=arcEndTangent;
 }
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
