import trace from './data/linuxcnc-mill-d1_5875.json';
import { containsSweptPoint } from './ncStock';

type Point={x:number;y:number;z:number};
export const MILL_GRID={nx:80,ny:80,nz:10,step:.5,x:-5,y:-5,z:-5};
export type MillResult={ok:true;remaining:Uint8Array;removed:number}|{ok:false;message:string};
const p=(v:number[]):Point=>({x:v[0],y:v[1],z:v[2]});
const TAU=2*Math.PI;

/** Replays one published LinuxCNC 2.9.4 canonical trace, rounded to 0.0001 inch. */
export function simulateReferenceMill():MillResult {
 const g=MILL_GRID,r=.79375,length=8,remaining=new Uint8Array(g.nx*g.ny*g.nz).fill(1);let removed=0,previous:Point={x:0,y:0,z:0};
 for(const move of trace.moves){
  const end=p(move.end);const path=[previous];
  if(move.kind==='arc'){
   if(!move.center||!move.turn)return {ok:false,message:'참조 원호 데이터가 올바르지 않습니다.'};
   const [cx,cy]=move.center, a0=Math.atan2(previous.y-cy,previous.x-cx), a1=Math.atan2(end.y-cy,end.x-cx);
   const raw=move.turn>0?(a1-a0+TAU)%TAU:(a0-a1+TAU)%TAU;
   const sweep=(move.turn>0?1:-1)*(raw<1e-8?TAU:raw),r0=Math.hypot(previous.x-cx,previous.y-cy),r1=Math.hypot(end.x-cx,end.y-cy);
   if(Math.abs(r0-r1)>.004)return {ok:false,message:'참조 원호의 반올림 오차가 허용 범위를 넘었습니다.'};
   const count=Math.ceil(Math.abs(sweep)/(Math.PI/36));
   for(let k=1;k<=count;k++){const t=k/count,a=a0+sweep*t,radius=r0+(r1-r0)*t;path.push(k===count?end:{x:cx+radius*Math.cos(a),y:cy+radius*Math.sin(a),z:previous.z+(end.z-previous.z)*t});}
  }else path.push(end);
  for(let j=1;j<path.length;j++){
   const a=path[j-1],b=path[j];
   const lower=(v:number,origin:number,max:number)=>Math.max(0,Math.min(max,Math.ceil((v-origin)/g.step-.5)));
   const upper=(v:number,origin:number,max:number)=>Math.max(-1,Math.min(max-1,Math.floor((v-origin)/g.step-.5)));
   const x0=lower(Math.min(a.x,b.x)-r,g.x,g.nx),x1=upper(Math.max(a.x,b.x)+r,g.x,g.nx);
   const y0=lower(Math.min(a.y,b.y)-r,g.y,g.ny),y1=upper(Math.max(a.y,b.y)+r,g.y,g.ny);
   const z0=lower(Math.min(a.z,b.z),g.z,g.nz),z1=upper(Math.max(a.z,b.z)+length,g.z,g.nz);
   for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const i=(z*g.ny+y)*g.nx+x;if(!remaining[i])continue;
    const point={x:g.x+(x+.5)*g.step,y:g.y+(y+.5)*g.step,z:g.z+(z+.5)*g.step};
    if(containsSweptPoint(point,a,b,r,length)){
     if(move.kind==='rapid')return {ok:false,message:'참조 급속 이동이 격자 소재에 닿아 중단했습니다. 소재 또는 공구 조건을 확인해야 합니다.'};
     remaining[i]=0;removed++;
    }
   }
  }
  previous=end;
 }
 return {ok:true,remaining,removed};
}
