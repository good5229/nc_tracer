import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STOCK } from '../simulation/example';
import type { NcStockResult } from '../simulation/ncStock';
import type { ParserOptions } from '../parser/gcode';

export default function NcStock({source,profile,onExample}:{source:string;profile:ParserOptions['controllerProfile'];onExample:()=>void}) {
  const [result,setResult]=useState<NcStockResult|null>(null); const [busy,setBusy]=useState(false); const [request,setRequest]=useState(0); const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{setResult(null);setBusy(false);},[source,profile]);
  useEffect(()=>{
    if(!request || !source)return;
    setBusy(true);setResult(null);const worker=new Worker(new URL('../workers/stock.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=(event:MessageEvent<NcStockResult>)=>{setResult(event.data);setBusy(false);worker.terminate();};
    worker.onerror=()=>{setResult({ok:false,message:'예제 소재 계산을 시작할 수 없습니다.'});setBusy(false);worker.terminate();};
    worker.postMessage({source,profile});return ()=>worker.terminate();
  },[request,source,profile]);
  useEffect(()=>{
    const element=host.current;if(!element || !result?.ok)return;
    const scene=new THREE.Scene();scene.background=new THREE.Color('#111827');const camera=new THREE.PerspectiveCamera(45,1,.1,1000);camera.up.set(0,0,1);camera.position.set(38,-20,32);
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));element.appendChild(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(15,10,4);controls.update();scene.add(new THREE.HemisphereLight(0xffffff,0x3a4850,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(20,-10,40);scene.add(light);
    const geometry=new THREE.BoxGeometry(.98,.98,.98),material=new THREE.MeshStandardMaterial({color:'#82b6ae',roughness:.65});
    const mesh=new THREE.InstancedMesh(geometry,material,result.remaining.reduce((a,b)=>a+b,0));const matrix=new THREE.Matrix4();let i=0;
    for(let z=0;z<STOCK.z;z++)for(let y=0;y<STOCK.y;y++)for(let x=0;x<STOCK.x;x++)if(result.remaining[(z*STOCK.y+y)*STOCK.x+x]){matrix.makeTranslation(x+.5,y+.5,z+.5);mesh.setMatrixAt(i++,matrix);}
    scene.add(mesh);scene.add(new THREE.AxesHelper(12));const render=()=>renderer.render(scene,camera);controls.addEventListener('change',render);
    const resize=()=>{const w=element.clientWidth,h=element.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);render();};const observer=new ResizeObserver(resize);observer.observe(element);resize();
    return ()=>{observer.disconnect();controls.dispose();geometry.dispose();material.dispose();renderer.dispose();renderer.domElement.remove();};
  },[result]);
  return <section className="stock-example" aria-label="NC 형상 예측"><div className="panel-head"><div><span className="section-tag">03 / NC MATERIAL</span><h2>불러온 NC의 예제 소재 형상</h2></div></div><div className="stock-body"><div><p>예제 원재료: X 0~30, Y 0~20, Z 0~8 mm. 예제 공구: 지름 4 mm, 절삭 길이 8 mm인 수직 평엔드밀. 시작점은 X0 Y0 Z12 mm, 작업 좌표 오프셋은 0으로 가정합니다.</p><p>NC에 단위와 절대·증분 모드가 명시되어야 합니다. 선택한 NC의 G01/G02/G03 이동을 절삭으로 가정합니다. 실제 공구 정보나 주축 상태를 반영하지 않습니다. 소재와 경로가 겹치지 않으면 형상이 변하지 않습니다.</p><div className="stock-controls"><button className="button secondary" onClick={onExample}>홈 가공 NC 열기</button><button className="button primary" disabled={!source||busy} onClick={()=>setRequest(v=>v+1)}>{busy?'계산 중':'불러온 NC로 형상 계산'}</button></div><p role="status">{busy?'계산 중…':result?.ok?`예상 형상 · 제거된 격자 ${result.removed}개`:result?.message??'NC를 불러온 뒤 형상 계산을 눌러 주세요.'}</p><p className="stock-caution">1 mm 격자 중심과 원호의 선분 근사로 계산합니다. 실제 공구 보정, 공구 홀더, 고정구, 기계 충돌 및 선반 가공은 지원하지 않습니다. 가공 안전이나 치수 적합성을 판정하는 결과가 아닙니다.</p></div>{result?.ok && <div ref={host} className="stock-canvas" aria-label="NC 가공 후 예제 소재 3D 표시"/>}</div></section>;
}
