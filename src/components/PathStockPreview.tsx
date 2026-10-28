import {useEffect,useMemo,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {MotionSegment, ParseWarning} from '../parser/gcode';
import type {PathStockPreviewResult} from '../simulation/pathStockPreview';
import {findRemovedRegions, type StockRegion} from '../simulation/stockRegions';
import {FacePatchFinder, faceAxisDimensions} from '../simulation/facePatch';

type Result={preview:PathStockPreviewResult; excluded:number; unit:string; edgeSegments?:Uint32Array; cuts?:MotionSegment[]};
type StockView='both'|'remaining'|'removed';
type FaceSelection={x:number;y:number;width:number;length:number;height:number;kind:'remaining'|'removed';segment?:MotionSegment};
type Inspection={kind:'remaining'|'removed';x:number;y:number;z:number;region?:StockRegion; segment?:MotionSegment};
const format=(value:number)=>Number(value.toPrecision(4)).toString();

function packCuttingPaths(segments:MotionSegment[]):{edges:Float64Array;edgeSegments:Uint32Array;cuts:MotionSegment[];excluded:number;unit:string}|{error:string}{
 const cuts=segments.filter(s=>s.motion!=='G00'&&!s.drillSpan&&!s.thread);
 const excluded=segments.filter(s=>!!s.drillSpan||!!s.thread).length;
 if(!cuts.length)return {error:'선택한 구간에 예시 형상을 만들 직선·원호 절삭 경로가 없습니다.'};
 const native=cuts.some(s=>s.unit==='native'),known=cuts.some(s=>s.unit!==null&&s.unit!=='native');
 if(native&&known)return {error:'이 구간에는 단위가 확인된 경로와 확인되지 않은 경로가 섞여 있어 소재를 계산할 수 없습니다.'};
 const n=cuts.reduce((sum,s)=>sum+(s.vertices ? s.vertices.length/3-1 : 1),0);
 if(n>1_000_000)return {error:'경로가 너무 많아 예시 형상을 계산할 수 없습니다. 더 작은 좌표·회전 구간을 선택해 주세요.'};
 const edges=new Float64Array(n*6),edgeSegments=new Uint32Array(n);let offset=0;
 for(const [cutIndex,s] of cuts.entries()){
  if(s.vertices){for(let i=3;i<s.vertices.length;i+=3){edges.set(s.vertices.subarray(i-3,i+3),offset);edgeSegments[offset/6]=cutIndex;offset+=6;}}
  else {edges.set([s.start.x!,s.start.y!,s.start.z!,s.end.x!,s.end.y!,s.end.z!],offset);edgeSegments[offset/6]=cutIndex;offset+=6;}
 }
 return {edges,edgeSegments,cuts,excluded,unit:native?'원본 단위 (mm로 가정)':'mm'};
}

export default function PathStockPreview({segments,groupDescription,warnings,onSelectSegment}:{segments:MotionSegment[];groupDescription:string;warnings:ParseWarning[];onSelectSegment:(segment:MotionSegment)=>void}){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false);
 const [stockView,setStockView]=useState<StockView>('removed'),[inspection,setInspection]=useState<Inspection|null>(null),[faceSelection,setFaceSelection]=useState<FaceSelection|null>(null);
 const expandedRef=useRef(expanded);expandedRef.current=expanded;
 const worker=useRef<Worker|null>(null),host=useRef<HTMLDivElement>(null),axisSvg=useRef<SVGSVGElement>(null);
 const viewer=useRef<{render:()=>void;clearFace:()=>void}|null>(null),viewMode=useRef<StockView>(stockView);
 useEffect(()=>{
  const calculate=()=>{
  worker.current?.terminate();setResult(null);
  const packed=packCuttingPaths(segments);
  if('error' in packed){setResult({preview:{ok:false,message:packed.error},excluded:0,unit:'mm'});return;}
  setBusy(true);const w=new Worker(new URL('../workers/pathStockPreview.worker.ts',import.meta.url),{type:'module'});worker.current=w;
  w.onmessage=(event:MessageEvent<PathStockPreviewResult>)=>{setResult({preview:event.data,excluded:packed.excluded,unit:packed.unit,edgeSegments:packed.edgeSegments,cuts:packed.cuts});setBusy(false);w.terminate();if(worker.current===w)worker.current=null;};
  w.onerror=()=>{setResult({preview:{ok:false,message:'예시 형상 계산을 시작할 수 없습니다.'},excluded:0,unit:packed.unit});setBusy(false);w.terminate();};
  w.postMessage({edges:packed.edges},{transfer:[packed.edges.buffer]});
  };
  calculate();return ()=>{worker.current?.terminate();worker.current=null;};
 },[segments]);
 useEffect(()=>{if(!expanded)return;const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setExpanded(false);};window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey);},[expanded]);
 useEffect(()=>{
  const element=host.current;if(!element||!result?.preview.ok)return;
  const s=result.preview.stock,w=s.maxX-s.minX,h=s.maxY-s.minY,depth=s.top-s.bottom,scale=2/Math.max(w,h,depth);
  const dx=w/s.nx,dy=h/s.ny,cx=(s.minX+s.maxX)/2,cy=(s.minY+s.maxY)/2,cz=(s.top+s.bottom)/2;
  const vertices:number[]=[],removedVertices:number[]=[],removedFaces:number[]=[];
  const {regions,cellRegion}=findRemovedRegions(s);let cell=0;
  const quad=(a:number[],b:number[],c:number[],d:number[],target=vertices)=>{target.push(...a,...b,...c,...a,...c,...d);if(target===removedVertices)removedFaces.push(cell,cell);};
  const point=(x:number,y:number,z:number)=>[(x-cx)*scale,(y-cy)*scale,(z-cz)*scale];
  for(let y=0;y<s.ny;y++)for(let x=0;x<s.nx;x++){
   cell=y*s.nx+x;
   const x0=s.minX+x*dx,x1=x0+dx,y0=s.minY+y*dy,y1=y0+dy,z=s.heights[y*s.nx+x];
   quad(point(x0,y0,z),point(x1,y0,z),point(x1,y1,z),point(x0,y1,z));
   const right=x===s.nx-1?s.bottom:s.heights[y*s.nx+x+1];if(z>right)quad(point(x1,y0,right),point(x1,y1,right),point(x1,y1,z),point(x1,y0,z));
   const left=x===0?s.bottom:s.heights[y*s.nx+x-1];if(z>left)quad(point(x0,y1,left),point(x0,y0,left),point(x0,y0,z),point(x0,y1,z));
   const back=y===s.ny-1?s.bottom:s.heights[(y+1)*s.nx+x];if(z>back)quad(point(x1,y1,back),point(x0,y1,back),point(x0,y1,z),point(x1,y1,z));
   const front=y===0?s.bottom:s.heights[(y-1)*s.nx+x];if(z>front)quad(point(x0,y0,front),point(x1,y0,front),point(x1,y0,z),point(x0,y0,z));
   if(z<s.top){
    quad(point(x0,y0,s.top),point(x1,y0,s.top),point(x1,y1,s.top),point(x0,y1,s.top),removedVertices);
    quad(point(x0,y1,z),point(x1,y1,z),point(x1,y0,z),point(x0,y0,z),removedVertices);
    const r=x===s.nx-1?s.top:s.heights[y*s.nx+x+1];if(r>z)quad(point(x1,y0,z),point(x1,y1,z),point(x1,y1,r),point(x1,y0,r),removedVertices);
    const l=x===0?s.top:s.heights[y*s.nx+x-1];if(l>z)quad(point(x0,y1,z),point(x0,y0,z),point(x0,y0,l),point(x0,y1,l),removedVertices);
    const b=y===s.ny-1?s.top:s.heights[(y+1)*s.nx+x];if(b>z)quad(point(x1,y1,z),point(x0,y1,z),point(x0,y1,b),point(x1,y1,b),removedVertices);
    const f=y===0?s.top:s.heights[(y-1)*s.nx+x];if(f>z)quad(point(x0,y0,z),point(x1,y0,z),point(x1,y0,f),point(x0,y0,f),removedVertices);
   }
  }
  quad(point(s.minX,s.maxY,s.bottom),point(s.maxX,s.maxY,s.bottom),point(s.maxX,s.minY,s.bottom),point(s.minX,s.minY,s.bottom));
  const scene=new THREE.Scene();scene.background=new THREE.Color('#111827');const camera=new THREE.PerspectiveCamera(45,1,0.01,100);camera.up.set(0,0,1);camera.position.set(2.8,-3.3,2.7);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));element.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);controls.update();scene.add(new THREE.HemisphereLight(0xffffff,0x3a4850,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,-3,4);scene.add(light);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();const material=new THREE.MeshStandardMaterial({color:'#596e79',roughness:.8,metalness:.05,side:THREE.DoubleSide});const remaining=new THREE.Mesh(geometry,material);scene.add(remaining);
  const removedGeometry=new THREE.BufferGeometry();removedGeometry.setAttribute('position',new THREE.Float32BufferAttribute(removedVertices,3));removedGeometry.computeVertexNormals();const removedMaterial=new THREE.MeshStandardMaterial({color:'#c9cfd3',roughness:.4,metalness:.25,side:THREE.DoubleSide});const removed=new THREE.Mesh(removedGeometry,removedMaterial);scene.add(removed);
  const outlineGeometry=new THREE.BufferGeometry(),outlineMaterial=new THREE.LineBasicMaterial({color:'#8ffff0',depthTest:false});
  const outline=new THREE.LineSegments(outlineGeometry,outlineMaterial);outline.renderOrder=3;outline.visible=false;scene.add(outline);
  let outlinedKind:'remaining'|'removed'|null=null;
  let remainingFinder:FacePatchFinder|undefined,removedFinder:FacePatchFinder|undefined;
  const render=()=>{
   const width=element.clientWidth,height=element.clientHeight;if(!width||!height)return;
   const inverse=camera.quaternion.clone().invert();
   for(const [axis,direction] of [['x',new THREE.Vector3(1,0,0)],['y',new THREE.Vector3(0,1,0)],['z',new THREE.Vector3(0,0,1)]] as const){
    direction.applyQuaternion(inverse);
    const x=45+direction.x*25,y=45-direction.y*25;
    const line=axisSvg.current?.querySelector(`[data-axis-line="${axis}"]`);
    const label=axisSvg.current?.querySelector(`[data-axis-label="${axis}"]`);
    line?.setAttribute('x2',String(x));line?.setAttribute('y2',String(y));
    label?.setAttribute('x',String(45+direction.x*34));label?.setAttribute('y',String(45-direction.y*34));
   }
   renderer.setScissorTest(true);
   const draw=(x:number,y:number,w:number,h:number,showRemaining:boolean)=>{
    if(!w||!h)return;
    remaining.visible=showRemaining;removed.visible=!showRemaining;outline.visible=outlinedKind===(showRemaining?'remaining':'removed');
    camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setViewport(x,y,w,h);renderer.setScissor(x,y,w,h);renderer.render(scene,camera);
   };
   if(viewMode.current==='both'){
    if(width<500){const half=Math.floor(height/2);draw(0,half,width,height-half,true);draw(0,0,width,half,false);}
    else {const half=Math.floor(width/2);draw(0,0,half,height,true);draw(half,0,width-half,height,false);}
   }else draw(0,0,width,height,viewMode.current==='remaining');
  };controls.addEventListener('change',render);
  viewer.current={render,clearFace:()=>{outlinedKind=null;render();}};
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let press:{x:number;y:number}|null=null;
  const inspect=(event:PointerEvent)=>{
   if(!expandedRef.current)return;
   if(event.pointerType==='mouse'&&event.buttons)return;
   const bounds=renderer.domElement.getBoundingClientRect(),width=bounds.width,height=bounds.height;
   let x=event.clientX-bounds.left,y=event.clientY-bounds.top,w=width,h=height;
   let kind:'remaining'|'removed'=viewMode.current==='remaining'?'remaining':'removed';
   if(viewMode.current==='both'){
    if(width<500){h=Math.floor(height/2);kind=y<height-h?'remaining':'removed';if(kind==='removed')y-=height-h;else h=height-h;}
    else {w=Math.floor(width/2);kind=x<w?'remaining':'removed';if(kind==='removed'){x-=w;w=width-w;}}
   }
   if(!w||!h)return;
   pointer.set(x/w*2-1,1-y/h*2);camera.aspect=w/h;camera.updateProjectionMatrix();raycaster.setFromCamera(pointer,camera);
   const mesh=kind==='remaining'?remaining:removed;
   const hit=raycaster.intersectObject(mesh,false)[0];
   if(!hit){if(event.type==='pointerup'&&press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)<5){outlinedKind=null;setFaceSelection(null);render();}setInspection(null);return;}
   const cellIndex=kind==='removed'&&hit.faceIndex!=null?removedFaces[hit.faceIndex]:undefined;
   const region=cellIndex===undefined?undefined:regions[cellRegion[cellIndex]];
   const edgeIndex=cellIndex===undefined?-1:s.cellEdges[cellIndex];
   const segment=edgeIndex>=0 && result.edgeSegments && result.cuts ? result.cuts[result.edgeSegments[edgeIndex]] : undefined;
   setInspection({kind,x:hit.point.x/scale+cx,y:hit.point.y/scale+cy,z:hit.point.z/scale+cz,region,segment});
   if(event.type==='pointerup' && press && Math.hypot(event.clientX-press.x,event.clientY-press.y)<5 && hit.faceIndex!=null){
    const finder=kind==='removed'?(removedFinder??=new FacePatchFinder(removedGeometry)):(remainingFinder??=new FacePatchFinder(geometry));
    const patch=finder.find(hit.faceIndex);
    if(patch){outline.geometry.setAttribute('position',new THREE.BufferAttribute(patch.outline,3));outline.geometry.computeBoundingSphere();outlinedKind=kind;render();
     const size=patch.bounds.getSize(new THREE.Vector3()).divideScalar(scale);
     setFaceSelection({x:Math.max(2,Math.min(75,(event.clientX-bounds.left)/width*100)),y:Math.max(2,Math.min(70,(event.clientY-bounds.top)/height*100)),width:size.x,length:size.y,height:size.z,kind,segment});
    }
   }
   if(event.type==='pointerup')press=null;
  };
  const down=(event:PointerEvent)=>{press={x:event.clientX,y:event.clientY};};
  renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',inspect);renderer.domElement.addEventListener('pointerup',inspect);
  const resize=()=>{const width=element.clientWidth,height=element.clientHeight;if(!width||!height)return;renderer.setSize(width,height);render();};const observer=new ResizeObserver(resize);observer.observe(element);resize();
  return ()=>{viewer.current=null;observer.disconnect();renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointermove',inspect);renderer.domElement.removeEventListener('pointerup',inspect);controls.dispose();geometry.dispose();removedGeometry.dispose();outlineGeometry.dispose();outlineMaterial.dispose();material.dispose();removedMaterial.dispose();renderer.dispose();renderer.domElement.remove();};
 },[result]);
 useEffect(()=>{viewMode.current=stockView;setInspection(null);setFaceSelection(null);viewer.current?.clearFace();},[stockView,result]);
 const preview=result?.preview;
 const overallRemoved=useMemo(()=>{
  if(!result?.preview.ok)return null;
  const regions=findRemovedRegions(result.preview.stock).regions;if(!regions.length)return null;
  return regions.reduce((a,b)=>({minX:Math.min(a.minX,b.minX),maxX:Math.max(a.maxX,b.maxX),minY:Math.min(a.minY,b.minY),maxY:Math.max(a.maxY,b.maxY),minZ:Math.min(a.minZ,b.minZ),maxZ:Math.max(a.maxZ,b.maxZ)}));
 },[result]);
 return <section className={`stock-preview ${expanded?'stock-preview-expanded':''}`} aria-label="선택 구간의 예시 가공 형상">
  <div className="stock-preview-head"><div><strong>예시 가공 형상</strong><small>{stockView==='removed'?'가공한 부품':stockView==='remaining'?'남은 소재':'나란히 비교'}</small></div><button className="stock-expand" onClick={()=>setExpanded(!expanded)} aria-label={expanded?'형상 미리보기 닫기':'형상 미리보기 확대'}>{expanded?'닫기 ✕':'확대 ⤢'}</button></div>
  {preview?.ok ? <div className={`stock-comparison ${stockView==='both'?'compare-both':''}`}><div ref={host} className="stock-canvas" aria-label="선택 구간의 가상 소재 3D 형상"/><svg ref={axisSvg} className="stock-axis" viewBox="0 0 90 90" role="img" aria-label="형상의 X, Y, Z 양의 방향"><circle cx="45" cy="45" r="2.5" fill="#e9f4f1"/>{(['x','y','z'] as const).map(axis=><g key={axis} className={`stock-axis-${axis}`}><line data-axis-line={axis} x1="45" y1="45" x2="45" y2="45"/><text data-axis-label={axis} x="45" y="45" textAnchor="middle" dominantBaseline="central">{axis.toUpperCase()}</text></g>)}</svg>{stockView==='both'&&<div className="stock-compare-labels"><span>남은 소재</span><span>가공한 부품</span></div>}{expanded&&faceSelection&&<div className="stock-face-popup" role="region" aria-label="선택한 면의 치수" style={{left:`min(${faceSelection.x}%, calc(100% - min(220px, 65%)))`,top:`${faceSelection.y}%`}}><div className="stock-face-head"><strong>선택한 면 · 예시</strong><button onClick={()=>{setFaceSelection(null);viewer.current?.clearFace();}} aria-label="면 치수 닫기">✕</button></div><p>{faceAxisDimensions({x:faceSelection.width,y:faceSelection.length,z:faceSelection.height}).map(dimension=><span key={dimension.axis} className="stock-face-dimension">{dimension.axis} 방향 길이 <b>{format(dimension.length)}</b></span>)}</p><small>단위: {result?.unit}<br/>색으로 표시한 면의 축 방향 범위입니다. 격자 근사값입니다.</small>{faceSelection.segment&&<button className="stock-face-link" onClick={()=>{onSelectSegment(faceSelection.segment!);setExpanded(false);setFaceSelection(null);}}>관련 NC {faceSelection.segment.sourceLine}행과 경로 보기</button>}</div>}{overallRemoved&&<div className="stock-dimensions" aria-label="가공한 부품 전체 치수"><span>가공한 부품 전체 범위 · 예시</span><strong>가로 {format(overallRemoved.maxX-overallRemoved.minX)} · 세로 {format(overallRemoved.maxY-overallRemoved.minY)} · 높이 {format(overallRemoved.maxZ-overallRemoved.minZ)} {result?.unit}</strong></div>}</div> : <p className="stock-preview-empty" role="status">{busy?'예시 형상 계산 중…':preview?.message??'경로를 확인하고 있습니다.'}</p>}
  <div className="stock-preview-footer"><span>가상 소재 · 실제 결과 아님</span>{!expanded&&<span>확대해 자세히 보기</span>}</div>
  {expanded&&<div className="stock-preview-details">
   {preview?.ok&&<fieldset className="stock-view-options"><legend>형상 표시</legend><label><input type="radio" name="stock-view" checked={stockView==='removed'} onChange={()=>setStockView('removed')}/> 가공한 부품</label><label><input type="radio" name="stock-view" checked={stockView==='both'} onChange={()=>setStockView('both')}/> 나란히 비교</label><label><input type="radio" name="stock-view" checked={stockView==='remaining'} onChange={()=>setStockView('remaining')}/> 남은 소재</label></fieldset>}
   {preview?.ok&&<div className="stock-inspection" aria-label="예시 형상 치수">
    <strong>예시 형상 치수</strong>
    {overallRemoved&&<p>가공한 부품 전체 범위 · 가로(X) {format(overallRemoved.maxX-overallRemoved.minX)} · 세로(Y) {format(overallRemoved.maxY-overallRemoved.minY)} · 높이(Z) {format(overallRemoved.maxZ-overallRemoved.minZ)} {result?.unit}</p>}
    {inspection ? <><p>{inspection.kind==='removed'?'가공한 부품':'남은 소재'} 표면 좌표 · X {format(inspection.x)} · Y {format(inspection.y)} · Z {format(inspection.z)} {result?.unit}</p>{inspection.region&&<p>연결된 가공 영역 범위 · 가로(X) {format(inspection.region.maxX-inspection.region.minX)} · 세로(Y) {format(inspection.region.maxY-inspection.region.minY)} · 높이(Z) {format(inspection.region.maxZ-inspection.region.minZ)} {result?.unit}</p>}</> : <p>형상에 마우스를 올리거나 터치하면 표면 좌표와 가공 영역의 치수가 표시됩니다.</p>}
    {inspection?.segment&&<div className="stock-source"><button className="button secondary" onClick={()=>{onSelectSegment(inspection.segment!);setExpanded(false);}}>관련 NC {inspection.segment.sourceLine}행과 경로 보기</button><p>이 격자에서 가장 깊게 계산된 대표 경로입니다. 다른 경로도 영향을 줄 수 있습니다.</p>{warnings.filter(w=>w.sourceLine===inspection.segment!.sourceLine).map(w=><p className="stock-caution" key={w.id}>? {w.message}</p>)}</div>}
    <small>연결 영역은 격자 기준의 근사 범위이며 실제 개별 부품이나 설계 치수가 아닙니다.</small>
   </div>}
   <p>현재 선택한 {groupDescription}의 직선·원호 절삭 경로와 가상의 알루미늄 소재, 수직 평엔드밀을 사용한 예시입니다. 가공한 부품은 제거된 부피를 시각화한 추정 형상이며 실제 완성품을 뜻하지 않습니다.</p>
   <p className="stock-caution">회전 전후 구간은 합치지 않습니다. 공구 교환·보정, 구멍 사이클, 급속 이동, 선반·측면·아래쪽 가공과 미확인 이동은 계산하지 않습니다. 실제 완성 형상이나 충돌·가공 안전 판정이 아닙니다.</p>
   <p role="status">{preview?.ok?`예시 소재 ${format(preview.stock.maxX-preview.stock.minX)} × ${format(preview.stock.maxY-preview.stock.minY)} × ${format(preview.stock.top-preview.stock.bottom)} ${result?.unit} · 가상 공구 지름 ${format(preview.stock.diameter)} · 바뀐 격자 ${preview.stock.changedCells}개${result?.excluded ? ` · 생략한 사이클 구간 ${result.excluded}개` : ''}`:''}</p>
   <p>형상을 클릭하면 면의 치수를 확인하고 관련 NC 행으로 이동할 수 있습니다. 드래그로 회전하고 스크롤로 확대합니다. 비교 화면은 같은 시점으로 움직입니다. 격자는 최대 96 × 96칸입니다.</p>
  </div>}
 </section>;
}
