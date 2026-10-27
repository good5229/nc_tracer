import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ViewerPoint = { x: number | null; y: number | null; z: number | null };
export type ViewerMotion = 'G00' | 'G01';
export type ViewerSegment = {
  id: string;
  sourceLine: number;
  nBlock?: string;
  rawCode: string;
  motion: ViewerMotion;
  start: ViewerPoint;
  end: ViewerPoint;
};
export type ViewerPlane = 'XY' | 'XZ' | 'YZ';

export interface Viewer3DProps {
  segments: ViewerSegment[];
  selectedSegmentId?: string | null;
  onSelectSegment?: (segment: ViewerSegment) => void;
  showRapid?: boolean;
  showLinear?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

type RenderedSegment = { source: ViewerSegment; a: THREE.Vector3; b: THREE.Vector3 };

const finitePoint = (p: ViewerPoint): p is { x: number; y: number; z: number } =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** Three.js toolpath viewport. Segments with any unknown coordinate are deliberately omitted. */
export default function Viewer3D({
  segments,
  selectedSegmentId = null,
  onSelectSegment,
  showRapid: rapidProp = true,
  showLinear: linearProp = true,
  className,
  style,
}: Viewer3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    rapid: THREE.LineSegments;
    linear: THREE.LineSegments;
    highlight: THREE.LineSegments;
    raycaster: THREE.Raycaster;
    resizeObserver: ResizeObserver;
    frame: number;
  } | null>(null);
  const renderedRef = useRef<RenderedSegment[]>([]);
  const selectRef = useRef(onSelectSegment);
  const [showRapid, setShowRapid] = useState(rapidProp);
  const [showLinear, setShowLinear] = useState(linearProp);
  const [plane, setPlane] = useState<ViewerPlane>('XY');
  const [ready, setReady] = useState(false);

  useEffect(() => { selectRef.current = onSelectSegment; }, [onSelectSegment]);
  useEffect(() => setShowRapid(rapidProp), [rapidProp]);
  useEffect(() => setShowLinear(linearProp), [linearProp]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#111827');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e9);
    camera.position.set(120, -150, 140);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);

    const grid = new THREE.GridHelper(200, 20, '#536477', '#344152');
    grid.name = 'toolpath-grid';
    scene.add(grid);
    const axes = new THREE.AxesHelper(100);
    axes.name = 'toolpath-axes';
    scene.add(axes);

    const rapid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#f4a340' }));
    const linear = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#38c8a0' }));
    const highlight = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#fff36d', linewidth: 3, depthTest: false }));
    highlight.renderOrder = 2;
    scene.add(rapid, linear, highlight);
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 1.5 };

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const visible = [showRapidRef.current ? rapid : null, showLinearRef.current ? linear : null].filter(Boolean) as THREE.LineSegments[];
      const hit = raycaster.intersectObjects(visible, false)[0];
      if (!hit) return;
      const index = typeof hit.index === 'number' ? Math.floor(hit.index / 2) : -1;
      const object = hit.object as THREE.LineSegments;
      const bucket = object === rapid ? rapidRef.current : linearRef.current;
      const item = bucket[index];
      if (item) selectRef.current?.(item.source);
    };
    renderer.domElement.addEventListener('click', handleClick);
    engineRef.current = { renderer, scene, camera, controls, rapid, linear, highlight, raycaster, resizeObserver, frame };
    setReady(true);

    return () => {
      setReady(false);
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('click', handleClick);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose()); else material.dispose();
        }
        if (object instanceof THREE.GridHelper || object instanceof THREE.AxesHelper) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      engineRef.current = null;
    };
    // Visibility is read from refs so changing a toggle does not recreate the WebGL context.
  }, []);

  const rapidRef = useRef<RenderedSegment[]>([]);
  const linearRef = useRef<RenderedSegment[]>([]);
  const showRapidRef = useRef(showRapid);
  const showLinearRef = useRef(showLinear);
  useEffect(() => { showRapidRef.current = showRapid; if (engineRef.current) engineRef.current.rapid.visible = showRapid; }, [showRapid]);
  useEffect(() => { showLinearRef.current = showLinear; if (engineRef.current) engineRef.current.linear.visible = showLinear; }, [showLinear]);

  useEffect(() => {
    const engine = engineRef.current;
    const valid: RenderedSegment[] = [];
    for (const segment of segments) {
      if (!finitePoint(segment.start) || !finitePoint(segment.end)) continue;
      const a = new THREE.Vector3(segment.start.x, segment.start.y, segment.start.z);
      const b = new THREE.Vector3(segment.end.x, segment.end.y, segment.end.z);
      // Zero-length moves remain selectable through source data but do not make a visible line.
      if (a.distanceToSquared(b) > 0) valid.push({ source: segment, a, b });
    }
    renderedRef.current = valid;
    rapidRef.current = valid.filter((item) => item.source.motion === 'G00');
    linearRef.current = valid.filter((item) => item.source.motion === 'G01');
    if (!engine) return;

    const setGeometry = (line: THREE.LineSegments, items: RenderedSegment[]) => {
      line.geometry.dispose();
      const positions = new Float32Array(items.length * 6);
      items.forEach(({ a, b }, i) => {
        positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.computeBoundingSphere();
      line.geometry = geometry;
    };
    setGeometry(engine.rapid, rapidRef.current);
    setGeometry(engine.linear, linearRef.current);

    const box = new THREE.Box3();
    valid.forEach(({ a, b }) => { box.expandByPoint(a); box.expandByPoint(b); });
    const center = valid.length ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    engine.controls.target.copy(center);
    const size = valid.length ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(100, 100, 100);
    const span = Math.max(size.x, size.y, size.z, 1);
    const grid = engine.scene.getObjectByName('toolpath-grid') as THREE.GridHelper | undefined;
    if (grid) {
      grid.scale.setScalar(Math.max(1, span / 200));
      grid.position.set(center.x, center.y, center.z);
      grid.rotation.set(plane === 'XY' ? Math.PI / 2 : 0, 0, plane === 'YZ' ? Math.PI / 2 : 0);
    }
    const axes = engine.scene.getObjectByName('toolpath-axes') as THREE.AxesHelper | undefined;
    if (axes) { axes.scale.setScalar(Math.max(0.01, span / 100)); axes.position.set(0, 0, 0); }
    frameSelection();
    if (valid.length) fitAll();
  }, [segments]);

  function frameSelection() {
    const engine = engineRef.current;
    if (!engine) return;
    const selected = renderedRef.current.find((item) => item.source.id === selectedSegmentId);
    engine.highlight.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    if (selected) {
      geo.setAttribute('position', new THREE.Float32BufferAttribute([
        selected.a.x, selected.a.y, selected.a.z, selected.b.x, selected.b.y, selected.b.z,
      ], 3));
    }
    engine.highlight.geometry = geo;
  }

  useEffect(() => { frameSelection(); }, [selectedSegmentId, ready]);

  const setView = (view: ViewerPlane) => {
    setPlane(view);
    const engine = engineRef.current;
    if (!engine) return;
    const target = engine.controls.target;
    const box = new THREE.Box3();
    renderedRef.current.forEach(({ a, b }) => { box.expandByPoint(a); box.expandByPoint(b); });
    const span = renderedRef.current.length ? box.getSize(new THREE.Vector3()).length() : 200;
    const distance = Math.max(100, span * 1.4);
    const grid = engine.scene.getObjectByName('toolpath-grid');
    if (grid) grid.rotation.set(view === 'XY' ? Math.PI / 2 : 0, 0, view === 'YZ' ? Math.PI / 2 : 0);
    if (view === 'XY') {
      engine.camera.up.set(0, 1, 0); engine.camera.position.set(target.x, target.y, target.z + distance);
    } else if (view === 'XZ') {
      engine.camera.up.set(0, 0, 1); engine.camera.position.set(target.x, target.y - distance, target.z);
    } else {
      engine.camera.up.set(0, 0, 1); engine.camera.position.set(target.x + distance, target.y, target.z);
    }
    engine.camera.lookAt(target); engine.camera.updateProjectionMatrix(); engine.controls.update();
  };

  const fitOrigin = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const offset = engine.camera.position.clone().sub(engine.controls.target);
    engine.controls.target.set(0, 0, 0);
    engine.camera.position.copy(offset);
    engine.camera.lookAt(engine.controls.target); engine.controls.update();
  };

  const fitAll = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const box = new THREE.Box3();
    renderedRef.current.forEach(({ a, b }) => { box.expandByPoint(a); box.expandByPoint(b); });
    if (box.isEmpty()) { engine.controls.target.set(0, 0, 0); engine.camera.position.set(120, -150, 140); engine.camera.up.set(0, 0, 1); }
    else {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 1);
      engine.controls.target.copy(center);
      engine.camera.up.set(0, 0, 1);
      engine.camera.position.set(center.x + span * 1.2, center.y - span * 1.4, center.z + span * 1.2);
      const grid = engine.scene.getObjectByName('toolpath-grid');
      if (grid) {
        grid.position.set(center.x, center.y, center.z);
        grid.rotation.set(plane === 'XY' ? Math.PI / 2 : 0, 0, plane === 'YZ' ? Math.PI / 2 : 0);
      }
    }
    engine.camera.lookAt(engine.controls.target); engine.camera.updateProjectionMatrix(); engine.controls.update();
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 240, background: '#111827', color: '#e5e7eb', ...style }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 10px', font: '13px system-ui, sans-serif' }}>
        <button type="button" onClick={fitAll} style={buttonStyle}>전체 맞춤</button>
        <button type="button" onClick={fitOrigin} style={buttonStyle}>원점 맞춤</button>
        {(['XY', 'XZ', 'YZ'] as ViewerPlane[]).map((v) => <button key={v} type="button" aria-pressed={plane === v} onClick={() => setView(v)} style={{ ...buttonStyle, background: plane === v ? '#334155' : '#1f2937' }}>{v}</button>)}
        <label style={toggleStyle}><input type="checkbox" checked={showRapid} onChange={(e) => setShowRapid(e.target.checked)} /> G00 급속</label>
        <label style={toggleStyle}><input type="checkbox" checked={showLinear} onChange={(e) => setShowLinear(e.target.checked)} /> G01 절삭</label>
        <span style={{ marginLeft: 'auto', color: '#9ca3af' }}>G00 <span style={{ color: '#f4a340' }}>━</span> G01 <span style={{ color: '#38c8a0' }}>━</span></span>
      </div>
      <div ref={hostRef} style={{ position: 'relative', flex: 1, minHeight: 200, cursor: 'crosshair' }}>
        {segments.length === 0 && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#9ca3af', pointerEvents: 'none', font: '14px system-ui, sans-serif' }}>표시할 경로가 없습니다</div>}
      </div>
      <div style={{ padding: '4px 10px 8px', color: '#9ca3af', font: '11px system-ui, sans-serif' }}>XYZ 단위: mm · 실제 가공 형상이나 충돌 검증 결과가 아닌 프로그램 경로입니다.</div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = { border: '1px solid #475569', borderRadius: 4, padding: '4px 9px', color: '#e5e7eb', background: '#1f2937', cursor: 'pointer' };
const toggleStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' };
