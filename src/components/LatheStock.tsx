import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {LATHE_STOCK,type LatheStockResult} from '../simulation/latheStock';
import type {ParseResult,ParserOptions} from '../parser/gcode';

export default function LatheStock({result,options}:{result:ParseResult|null;options:ParserOptions}){
 const [shape,setShape]=useState<LatheStockResult|null>(null),[busy,setBusy]=useState(false),[request,setRequest]=useState(0);const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!request||!result)return;setBusy(true);setShape(null);const worker=new Worker(new URL('../workers/latheStock.worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=(event:MessageEvent<LatheStockResult>)=>{setShape(event.data);setBusy(false);worker.terminate();};worker.onerror=()=>{setShape({ok:false,message:'선반 소재 계산을 시작할 수 없습니다.'});setBusy(false);worker.terminate();};worker.postMessage({result,options});return()=>worker.terminate();
 },[request,result,options]);
 useEffect(()=>{
  const element=host.current;if(!element||!shape?.ok)return;
  const {radialCells:nr,axialCells:nz,step,zMin,angularSegments:na}=LATHE_STOCK,positions:number[]=[];
  const at=(r:number,z:number)=>r<0||r>=nr||z<0||z>=nz?0:shape.remaining[z*nr+r];
  const point=(r:number,z:number,a:number)=>[r*Math.cos(a),r*Math.sin(a),z];
  const quad=(a:number[],b:number[],c:number[],d:number[])=>positions.push(...a,...b,...c,...a,...c,...d);
  for(let z=0;z<nz;z++)for(let r=0;r<nr;r++)if(at(r,z)){
   const r0=r*step,r1=(r+1)*step,z0=zMin+z*step,z1=z0+step;
   const outer=!at(r+1,z),inner=r>0&&!at(r-1,z),top=!at(r,z+1),bottom=!at(r,z-1);
   if(!outer&&!inner&&!top&&!bottom)continue;
   for(let i=0;i<na;i++){const a=2*Math.PI*i/na,b=2*Math.PI*(i+1)/na;
    if(outer)quad(point(r1,z0,a),point(r1,z0,b),point(r1,z1,b),point(r1,z1,a));
    if(inner)quad(point(r0,z0,b),point(r0,z0,a),point(r0,z1,a),point(r0,z1,b));
    if(top)quad(point(r0,z1,a),point(r1,z1,a),point(r1,z1,b),point(r0,z1,b));
    if(bottom)quad(point(r0,z0,b),point(r1,z0,b),point(r1,z0,a),point(r0,z0,a));
   }
  }
  const scene=new THREE.Scene();scene.background=new THREE.Color('#111827');const camera=new THREE.PerspectiveCamera(45,1,.1,1000);camera.up.set(0,0,1);camera.position.set(30,-35,25);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));element.appendChild(renderer.domElement);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,(LATHE_STOCK.zMin+LATHE_STOCK.zMax)/2);controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff,0x3a4850,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(20,-10,40);scene.add(light);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();const material=new THREE.MeshStandardMaterial({color:'#82b6ae',roughness:.65,side:THREE.DoubleSide});scene.add(new THREE.Mesh(geometry,material));scene.add(new THREE.AxesHelper(8));
  const render=()=>renderer.render(scene,camera);controls.addEventListener('change',render);const resize=()=>{const w=element.clientWidth,h=element.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);render();};const observer=new ResizeObserver(resize);observer.observe(element);resize();
  return()=>{observer.disconnect();controls.dispose();geometry.dispose();material.dispose();renderer.dispose();renderer.domElement.remove();};
 },[shape]);
 return <section className="stock-example" aria-label="선반 예제 소재 형상"><div className="panel-head"><div><span className="section-tag">LATHE / EXAMPLE STOCK</span><h2>선반 예제 소재의 예상 형상</h2></div></div><div className="stock-body"><div><p>예제 소재는 반경 10mm, Z -6~−1mm의 원통입니다. 선택한 예제 공구표의 공구 끝을 원형으로 이상화하고 절삭 이동으로 지나간 부분을 축 대칭으로 제거합니다.</p><p>G01/G02/G03은 절삭, G00은 급속 이동으로 가정합니다. 해석이 중단된 파일은 완성 형상을 표시하지 않습니다.</p><button className="button primary" disabled={!result||!options.linuxcncLatheToolReference||busy} onClick={()=>setRequest(n=>n+1)}>{busy?'계산 중':'선반 소재 형상 계산'}</button><p role="status">{busy?'계산 중…':shape?.ok?`예상 형상 · 제거된 단면 격자 ${shape.removed}개`:shape?.message??'선반 예제 공구표를 선택해 NC를 해석한 뒤 계산하세요.'}{shape&&!shape.ok&&shape.sourceLine?` (행 ${shape.sourceLine})`:''}</p><p className="stock-caution">0.2mm 단면 격자와 원호 선분 근사입니다. 실제 인서트 날·공구 홀더·고정구·스핀들 상태 및 나사산은 계산하지 않으며, 가공 안전이나 치수 적합성을 판정할 수 없습니다.</p></div>{shape?.ok&&<div ref={host} className="stock-canvas" aria-label="선반 예제 소재 3D 표시"/>}</div></section>;
}
