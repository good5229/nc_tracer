import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {LATHE_STOCK_PRESETS,type LatheStockResult,type LatheInsertModel} from '../simulation/latheStock';
import type {ParseResult,ParserOptions} from '../parser/gcode';

export default function LatheStock({result,options,defaultPreset='standard'}:{result:ParseResult|null;options:ParserOptions;defaultPreset?:keyof typeof LATHE_STOCK_PRESETS}){
 const [shape,setShape]=useState<LatheStockResult|null>(null),[busy,setBusy]=useState(false),[request,setRequest]=useState(0),[model,setModel]=useState<LatheInsertModel>('round-nose'),[preset,setPreset]=useState(defaultPreset),[partialRequest,setPartialRequest]=useState(false);const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!request||!result)return;setBusy(true);setShape(null);const worker=new Worker(new URL('../workers/latheStock.worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=(event:MessageEvent<LatheStockResult>)=>{setShape(event.data);setBusy(false);worker.terminate();};worker.onerror=()=>{setShape({ok:false,message:'선반 소재 계산을 시작할 수 없습니다.'});setBusy(false);worker.terminate();};worker.postMessage({result,options,model,grid:LATHE_STOCK_PRESETS[preset],allowPartial:partialRequest});return()=>worker.terminate();
 },[request,result,options,model,preset,partialRequest]);
 useEffect(()=>{
  const element=host.current;if(!element||!shape?.ok)return;
  const {radialCells:nr,axialCells:nz,step,zMin,angularSegments:na}=shape.grid,positions:number[]=[];
  const angles=shape.angularCells??1;
  const at=(r:number,z:number,a:number)=>r<0||r>=nr||z<0||z>=nz?0:shape.remaining[(z*nr+r)*angles+(angles===1?0:(a+na)%na)];
  const point=(r:number,z:number,a:number)=>[r*Math.cos(a),r*Math.sin(a),z];
  const quad=(a:number[],b:number[],c:number[],d:number[])=>positions.push(...a,...b,...c,...a,...c,...d);
  for(let z=0;z<nz;z++)for(let r=0;r<nr;r++){
   const r0=r*step,r1=(r+1)*step,z0=zMin+z*step,z1=z0+step;
   for(let i=0;i<na;i++){if(!at(r,z,i))continue;const a=2*Math.PI*i/na,b=2*Math.PI*(i+1)/na;
    const outer=!at(r+1,z,i),inner=r>0&&!at(r-1,z,i),top=!at(r,z+1,i),bottom=!at(r,z-1,i);
    if(outer)quad(point(r1,z0,a),point(r1,z0,b),point(r1,z1,b),point(r1,z1,a));
    if(inner)quad(point(r0,z0,b),point(r0,z0,a),point(r0,z1,a),point(r0,z1,b));
    if(top)quad(point(r0,z1,a),point(r1,z1,a),point(r1,z1,b),point(r0,z1,b));
    if(bottom)quad(point(r0,z0,b),point(r1,z0,b),point(r1,z0,a),point(r0,z0,a));
    if(angles>1&&!at(r,z,i-1))quad(point(r0,z0,a),point(r1,z0,a),point(r1,z1,a),point(r0,z1,a));
    if(angles>1&&!at(r,z,i+1))quad(point(r1,z0,b),point(r0,z0,b),point(r0,z1,b),point(r1,z1,b));
   }
  }
  const scene=new THREE.Scene();scene.background=new THREE.Color('#111827');const camera=new THREE.PerspectiveCamera(45,1,.1,1000),scale=Math.max(shape.grid.radius*2,shape.grid.zMax-shape.grid.zMin)/20,centerZ=(shape.grid.zMin+shape.grid.zMax)/2;camera.up.set(0,0,1);camera.position.set(24*scale,-28*scale,centerZ+22.5*scale);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));element.appendChild(renderer.domElement);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,centerZ);controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff,0x3a4850,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(20,-10,40);scene.add(light);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();const material=new THREE.MeshStandardMaterial({color:'#82b6ae',roughness:.65,side:THREE.DoubleSide});scene.add(new THREE.Mesh(geometry,material));scene.add(new THREE.AxesHelper(8));
  const render=()=>renderer.render(scene,camera);controls.addEventListener('change',render);const resize=()=>{const w=element.clientWidth,h=element.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);render();};const observer=new ResizeObserver(resize);observer.observe(element);resize();
  return()=>{observer.disconnect();controls.dispose();geometry.dispose();material.dispose();renderer.dispose();renderer.domElement.remove();};
 },[shape]);
 return <section className="stock-example" aria-label="선반 예제 소재 형상"><div className="panel-head"><div><span className="section-tag">LATHE / EXAMPLE STOCK</span><h2>선반 예제 소재의 예상 형상</h2></div></div><div className="stock-body"><div><p>선택한 소재는 반경 {LATHE_STOCK_PRESETS[preset].radius}mm, Z {LATHE_STOCK_PRESETS[preset].zMin}~{LATHE_STOCK_PRESETS[preset].zMax}mm의 가상 원통입니다. 일반 선반 이동은 단면을 축 대칭으로 제거하고 G76 나사는 회전 각도를 나누어 계산합니다.</p><div className="stock-controls"><label>예제 소재 <select aria-label="예제 소재" value={preset} onChange={e=>setPreset(e.target.value as keyof typeof LATHE_STOCK_PRESETS)}><option value="standard">기본 원통 · 반경 10mm</option><option value="thread-demo">나사 데모 원통 · 반경 3.175mm</option><option value="pawn-demo">G70/G71 데모 원통 · 반경 15mm</option></select></label><label>예제 공구 형상 <select aria-label="예제 공구 형상" value={model} onChange={e=>setModel(e.target.value as LatheInsertModel)}><option value="round-nose">원형 공구 끝</option><option value="example-insert">원형 끝과 예제 인서트 단면</option></select></label></div><p>인서트 예제는 반경 0.2mm 원형 끝에 중심에서 X+2mm, Z+2mm까지 뻗는 가상 인서트 단면을 더합니다. 모든 공구에 같은 형상을 적용하며 실제 공구표나 인서트 규격이 아닙니다.</p><p>G01/G02/G03은 절삭, G00은 급속 이동으로 가정합니다. G76은 가상의 60도 뾰족한 외경 나사 공구와 각 패스의 기준 위상을 사용하며 급속 이동 중에는 회전 위상이 변하지 않는다고 가정합니다. 해석이 중단된 파일은 완성 형상을 표시하지 않습니다.</p><button className="button primary" disabled={!result||!options.linuxcncLatheToolReference||busy} onClick={()=>{setPartialRequest(false);setRequest(n=>n+1);}}>{busy?'계산 중':'선반 소재 형상 계산'}</button>{result?.status==='PARTIAL' && result.warnings.length===1 && result.warnings[0].code==='ENTRY_TOO_SHORT' && <button className="button secondary" disabled={!options.linuxcncLatheToolReference||busy} onClick={()=>{setPartialRequest(true);setRequest(n=>n+1);}}>중단 전 형상 계산</button>}<p role="status">{busy?'계산 중…':shape?.ok?`${shape.partial?"중단 전 예상 형상 (완성 형상 아님)":"예상 형상"} · 제거된 ${shape.angularCells?"3D":"단면"} 격자 ${shape.removed}개`:shape?.message??'선반 예제 공구표를 선택해 NC를 해석한 뒤 계산하세요.'}{shape&&!shape.ok&&shape.sourceLine?` (행 ${shape.sourceLine})`:shape?.ok&&shape.partial?` · 행 ${result?.warnings[0]?.sourceLine}에서 중단`:''}</p><p className="stock-caution">{LATHE_STOCK_PRESETS[preset].step}mm 단면 격자와 원호 선분 근사입니다. 실제 인서트 날·공구 홀더·고정구·스핀들 가감속 및 급속 중 회전은 계산하지 않으며, 나사 형상과 충돌의 가공 안전이나 치수 적합성을 판정할 수 없습니다.</p></div>{shape?.ok&&<div ref={host} className="stock-canvas" aria-label="선반 예제 소재 3D 표시"/>}</div></section>;
}
