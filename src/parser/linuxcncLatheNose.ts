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
