export type ThreadSectionPoint={x:number;z:number};

/** Width of a symmetric nose with a circular tip tangent to both flanks. */
export function threadHalfWidth(depth:number,halfAngle:number,tipRadius:number):number{
 if(tipRadius===0)return depth*Math.tan(halfAngle);
 const tangentDepth=tipRadius*(1-Math.sin(halfAngle));
 return depth<tangentDepth?Math.sqrt(Math.max(0,2*tipRadius*depth-depth*depth)):(depth+tipRadius*(1/Math.sin(halfAngle)-1))*Math.tan(halfAngle);
}

/** Test one point against the exact X/Z section swept by a straight move. */
export function sweptThreadToolContains(point:ThreadSectionPoint,a:ThreadSectionPoint,b:ThreadSectionPoint,length:number,halfAngle:number,tipRadius:number):boolean{
 const d0=point.x-a.x,dd=a.x-b.x,h0=point.z-a.z,dh=a.z-b.z,tan=Math.tan(halfAngle);
 const tangentDepth=tipRadius*(1-Math.sin(halfAngle)),offset=tipRadius===0?0:tipRadius*(1/Math.sin(halfAngle)-1);
 // Intersect the motion parameter [0,1] with half-spaces f(t)>=0.
 const interval=(constraints:[number,number][]):[number,number]|null=>{
  let lo=0,hi=1;
  for(const [value,slope] of constraints){
   if(slope===0){if(value<0)return null;continue;}
   const boundary=-value/slope;if(slope>0)lo=Math.max(lo,boundary);else hi=Math.min(hi,boundary);
   if(lo>hi+1e-12)return null;
  }
  return [Math.max(0,lo),Math.min(1,hi)];
 };
 const flank=interval([[d0-tangentDepth,dd],[length-d0,-dd],[(d0+offset)*tan-h0,dd*tan-dh],[(d0+offset)*tan+h0,dd*tan+dh]]);
 if(flank)return true;
 if(tipRadius===0)return false;
 const nose=interval([[d0,dd],[tangentDepth-d0,-dd]]);if(!nose)return false;
 const squared=dd*dd+dh*dh,q=squared===0?nose[0]:Math.max(nose[0],Math.min(nose[1],-((d0-tipRadius)*dd+h0*dh)/squared));
 const x=d0+dd*q-tipRadius,z=h0+dh*q;
 return x*x+z*z<=tipRadius*tipRadius+1e-12;
}

/** Parameter intervals where a moving thread section contains a fixed point. */
export function threadToolIntervals(point:ThreadSectionPoint,a:ThreadSectionPoint,b:ThreadSectionPoint,length:number,halfAngle:number,tipRadius:number):[number,number][]{
 const d=point.x-a.x,dd=a.x-b.x,h=point.z-a.z,dh=a.z-b.z,tan=Math.tan(halfAngle);
 const tangent=tipRadius*(1-Math.sin(halfAngle)),offset=tipRadius===0?0:tipRadius*(1/Math.sin(halfAngle)-1);
 const clip=(constraints:[number,number][]):[number,number]|null=>{
  let lo=0,hi=1;for(const [v,s] of constraints){if(s===0){if(v<0)return null;}else if(s>0)lo=Math.max(lo,-v/s);else hi=Math.min(hi,-v/s);if(lo>hi)return null;}return [lo,hi];
 };
 const intervals:[number,number][]=[],flank=clip([[d-tangent,dd],[length-d,-dd],[(d+offset)*tan-h,dd*tan-dh],[(d+offset)*tan+h,dd*tan+dh]]);
 if(flank)intervals.push(flank);
 if(tipRadius>0){
  const nose=clip([[d,dd],[tangent-d,-dd]]);
  if(nose){const aa=dd*dd+dh*dh,bb=2*((d-tipRadius)*dd+h*dh),cc=(d-tipRadius)**2+h*h-tipRadius*tipRadius;
   if(aa===0){if(cc<=0)intervals.push(nose);}else{const disc=bb*bb-4*aa*cc;if(disc>=0){const root=Math.sqrt(disc),lo=Math.max(nose[0],(-bb-root)/(2*aa)),hi=Math.min(nose[1],(-bb+root)/(2*aa));if(lo<=hi)intervals.push([lo,hi]);}}
  }
 }
 return intervals;
}

/** Parameter interval where a moving axis-aligned X/Z rectangle contains a point. */
export function movingBoxInterval(point:ThreadSectionPoint,a:ThreadSectionPoint,b:ThreadSectionPoint,box:{xMin:number;xMax:number;zMin:number;zMax:number}):[number,number]|null{
 const d=point.x-a.x,dd=a.x-b.x,h=point.z-a.z,dh=a.z-b.z;
 let lo=0,hi=1;
 for(const [v,s] of [[d-box.xMin,dd],[box.xMax-d,-dd],[h-box.zMin,dh],[box.zMax-h,-dh]]){
  if(s===0){if(v<0)return null;}else if(s>0)lo=Math.max(lo,-v/s);else hi=Math.min(hi,-v/s);
  if(lo>hi)return null;
 }
 return [lo,hi];
}
