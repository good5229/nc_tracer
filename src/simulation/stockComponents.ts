import type {LatheStockGrid} from './latheStock';

export type StockComponent={zMin:number;zMax:number;cells:number};
/** Face-connected occupied grid cells; angular neighbors wrap at 0/2π. */
export function labelStockComponents(remaining:Uint8Array,grid:LatheStockGrid,angles:number):{components:StockComponent[];labels:Uint32Array}{
 const {radialCells:nr,axialCells:nz,step,zMin}=grid,total=nr*nz*angles;
 if(remaining.length!==total||!Number.isInteger(angles)||angles<1)throw new Error('Invalid stock grid');
 const labels=new Uint32Array(total),queue=new Int32Array(total),components:StockComponent[]=[];
 for(let start=0;start<total;start++){
  if(!remaining[start]||labels[start])continue;
  const id=components.length+1;
  let head=0,tail=0,minZ=nz,maxZ=0;queue[tail++]=start;labels[start]=id;
  while(head<tail){
   const cell=queue[head++],a=cell%angles,radial=Math.floor(cell/angles),r=radial%nr,z=Math.floor(radial/nr);
   minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
   const add=(next:number)=>{if(remaining[next]&&!labels[next]){labels[next]=id;queue[tail++]=next;}};
   if(r>0)add(cell-angles);if(r+1<nr)add(cell+angles);
   if(z>0)add(cell-nr*angles);if(z+1<nz)add(cell+nr*angles);
   if(angles>1){add(cell-a+(a+angles-1)%angles);add(cell-a+(a+1)%angles);}
  }
  components.push({zMin:zMin+minZ*step,zMax:zMin+(maxZ+1)*step,cells:tail});
 }
 return {components,labels};
}
export function stockComponents(remaining:Uint8Array,grid:LatheStockGrid,angles:number):StockComponent[]{return labelStockComponents(remaining,grid,angles).components;}
