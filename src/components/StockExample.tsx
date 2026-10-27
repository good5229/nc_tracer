import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { simulateExample, STOCK } from '../simulation/example';

export default function StockExample() {
  const [diameter, setDiameter] = useState(4);
  const [unsafe, setUnsafe] = useState(false);
  const result = useMemo(() => simulateExample(diameter / 2, unsafe), [diameter, unsafe]);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current; if (!element) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#111827');
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 1000); camera.up.set(0, 0, 1); camera.position.set(38, -20, 32);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(15, 10, 4); controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4850, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(20, -10, 40); scene.add(light);
    const geometry = new THREE.BoxGeometry(.98, .98, .98); const material = new THREE.MeshStandardMaterial({color:'#82b6ae', roughness:.65});
    const count = result.remaining.reduce((a, b) => a + b, 0); const mesh = new THREE.InstancedMesh(geometry, material, count); const matrix = new THREE.Matrix4(); let i = 0;
    for (let z=0;z<STOCK.z;z++) for(let y=0;y<STOCK.y;y++) for(let x=0;x<STOCK.x;x++) if(result.remaining[(z*STOCK.y+y)*STOCK.x+x]) { matrix.makeTranslation(x+.5,y+.5,z+.5); mesh.setMatrixAt(i++,matrix); }
    scene.add(mesh); scene.add(new THREE.AxesHelper(12));
    const render = () => renderer.render(scene, camera); controls.addEventListener('change', render);
    const resize = () => { const w=element.clientWidth,h=element.clientHeight; if(!w||!h)return; camera.aspect=w/h; camera.updateProjectionMatrix();renderer.setSize(w,h);render(); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => { observer.disconnect(); controls.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, [result]);
  return <section className="stock-example" aria-label="절삭 예제"><div className="panel-head"><div><span className="section-tag">03 / EXAMPLE</span><h2>원재료 절삭 예제</h2></div></div><div className="stock-body"><div><p>30 × 20 × 8 mm 원재료에 평평한 끝의 수직 공구로 깊이 2 mm의 둥근 홈을 가공하는 고정 예제입니다. 목표 홈은 공구 지름 4 mm로 정의했습니다. 그림을 끌어 돌리고 스크롤로 확대할 수 있습니다.</p><div className="stock-controls"><label>공구 지름 <select value={diameter} onChange={e=>setDiameter(Number(e.target.value))}><option value={2}>2 mm</option><option value={4}>4 mm</option><option value={6}>6 mm</option></select></label><label><input type="checkbox" checked={unsafe} onChange={e=>setUnsafe(e.target.checked)}/> 첫 급속 이동을 원재료 안으로 설정</label></div><p role="status">{result.rapidContacts.length ? '접촉 시뮬레이션 중단 · ' : <>목표보다 남은 셀: <strong>{result.missed}</strong> · 목표보다 더 깎인 셀: <strong>{result.excess}</strong> · </>} 급속 이동 중 원재료 접촉: <strong>{result.rapidContacts.length ? `${result.rapidContacts.join(', ')}번 이동에서 감지` : '감지되지 않음'}</strong></p><p className="stock-caution">1 mm 격자 중심을 사용하는 근사 예제입니다. 선택한 NC 파일에는 적용되지 않으며, G41/G42 보정·공구 홀더·고정구·기계 충돌·나사는 계산하지 않습니다. 접촉이 감지되지 않아도 실제 가공 안전을 뜻하지 않습니다.</p></div><div ref={host} className="stock-canvas" aria-label="절삭 후 예제 원재료 3D 표시"/></div></section>;
}
