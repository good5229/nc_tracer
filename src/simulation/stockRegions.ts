import type {PathStockPreview} from './pathStockPreview';

export type StockRegion={minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number};

/** Connected removed cells share a side. These are grid regions, not identified parts. */
export function findRemovedRegions(stock:PathStockPreview):{regions:StockRegion[];cellRegion:Int32Array}{
 const {nx,ny,heights,minX,maxX,minY,maxY,top}=stock;
 const dx=(maxX-minX)/nx,dy=(maxY-minY)/ny,cellRegion=new Int32Array(nx*ny).fill(-1),regions:StockRegion[]=[];
 for(let start=0;start<heights.length;start++){
  if(cellRegion[start]!==-1||heights[start]>=top)continue;
  const id=regions.length,queue=[start];cellRegion[start]=id;
  const region:StockRegion={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:top};
  for(let head=0;head<queue.length;head++){
   const i=queue[head],x=i%nx,y=Math.floor(i/nx);
   region.minX=Math.min(region.minX,minX+x*dx);region.maxX=Math.max(region.maxX,minX+(x+1)*dx);
   region.minY=Math.min(region.minY,minY+y*dy);region.maxY=Math.max(region.maxY,minY+(y+1)*dy);
   region.minZ=Math.min(region.minZ,heights[i]);
   for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
    if(xx<0||xx>=nx||yy<0||yy>=ny)continue;
    const next=yy*nx+xx;if(cellRegion[next]===-1&&heights[next]<top){cellRegion[next]=id;queue.push(next);}
   }
  }
  regions.push(region);
 }
 return {regions,cellRegion};
}
