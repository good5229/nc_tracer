/** A visual height-field example: one vertical flat cutter, no machine kinematics. */
export type PathStockPreview = {
  nx:number; ny:number; minX:number; minY:number; maxX:number; maxY:number;
  bottom:number; top:number; diameter:number; heights:Float64Array; cellEdges:Int32Array; changedCells:number;
};
export type PathStockPreviewResult = {ok:true;stock:PathStockPreview} | {ok:false;message:string};

export function simulatePathStock(edges:Float64Array):PathStockPreviewResult {
  if(!edges.length || edges.length%6!==0)return {ok:false,message:'이 구간에 예시 소재를 깎을 직선·원호 경로가 없습니다.'};
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<edges.length;i+=3){const x=edges[i],y=edges[i+1],z=edges[i+2];if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))return {ok:false,message:'경로 좌표를 확인할 수 없습니다.'};minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  const span=Math.max(maxX-minX,maxY-minY,(maxZ-minZ)*0.1,0.01);
  const radius=span*0.025,padding=radius+span*0.025;
  minX-=padding;maxX+=padding;minY-=padding;maxY+=padding;
  const bottom=minZ-Math.max(radius*2,(maxZ-minZ)*0.1),top=maxZ+radius*0.25;
  const width=maxX-minX,height=maxY-minY,longest=Math.max(width,height);
  if(!Number.isFinite(longest)||!Number.isFinite(top-bottom)||longest<=0)return {ok:false,message:'예시 소재의 크기를 계산할 수 없습니다.'};
  const nx=Math.max(8,Math.ceil(96*width/longest)),ny=Math.max(8,Math.ceil(96*height/longest));
  const dx=width/nx,dy=height/ny,heights=new Float64Array(nx*ny).fill(top),cellEdges=new Int32Array(nx*ny).fill(-1);
  let checks=0;const limit=30_000_000;
  for(let i=0;i<edges.length;i+=6){
    const ax=edges[i],ay=edges[i+1],az=edges[i+2],bx=edges[i+3],by=edges[i+4],bz=edges[i+5];
    const x0=Math.max(0,Math.floor((Math.min(ax,bx)-radius-minX)/dx)),x1=Math.min(nx-1,Math.floor((Math.max(ax,bx)+radius-minX)/dx));
    const y0=Math.max(0,Math.floor((Math.min(ay,by)-radius-minY)/dy)),y1=Math.min(ny-1,Math.floor((Math.max(ay,by)+radius-minY)/dy));
    checks+=(x1-x0+1)*(y1-y0+1);if(checks>limit)return {ok:false,message:'이 구간은 예시 형상 계산량이 너무 큽니다. 더 작은 경로 구간을 선택해 주세요.'};
    const vx=bx-ax,vy=by-ay,vz=bz-az,aa=vx*vx+vy*vy;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const px=minX+(x+0.5)*dx,py=minY+(y+0.5)*dy,ox=ax-px,oy=ay-py;
      let lo=0,hi=1;
      if(aa===0){if(ox*ox+oy*oy>radius*radius)continue;}
      else {const bb=2*(ox*vx+oy*vy),cc=ox*ox+oy*oy-radius*radius,disc=bb*bb-4*aa*cc;if(disc<0)continue;const root=Math.sqrt(disc);lo=Math.max(0,(-bb-root)/(2*aa));hi=Math.min(1,(-bb+root)/(2*aa));if(lo>hi)continue;}
      const z=az+vz*(vz<0?hi:lo),index=y*nx+x,next=Math.max(bottom,z);
      if(next<heights[index]){heights[index]=next;cellEdges[index]=i/6;}
    }
  }
  let changedCells=0;for(const value of heights)if(value<top-1e-6)changedCells++;
  return {ok:true,stock:{nx,ny,minX,minY,maxX,maxY,bottom,top,diameter:radius*2,heights,cellEdges,changedCells}};
}
