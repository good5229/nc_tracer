import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

export type ViewerPoint = { x: number | null; y: number | null; z: number | null };
export type ViewerMotion = 'G00' | 'G01' | 'G02' | 'G03';
export type ViewerSegment = {
  id: string;
  sourceLine: number;
  nBlock?: string;
  rawCode: string;
  motion: ViewerMotion;
  start: ViewerPoint;
  end: ViewerPoint;
  /** Optional ordered tessellation points for a validated arc move, including start/end. */
  vertices?: ViewerPoint[] | Float32Array | Float64Array;
};
export type ViewerPlane = 'XY' | 'XZ' | 'YZ';

export interface Viewer3DProps {
  segments: ViewerSegment[];
  packedPositions?: Float32Array | null;
  segmentIndices?: ReadonlyMap<string, number>;
  selectedSegmentId?: string | null;
  onSelectSegment?: (segment: ViewerSegment) => void;
  showRapid?: boolean;
  showLinear?: boolean;
  showNodes?: boolean;
  /** Draw movement blocks strictly before this segment in source order. */
  progressSegmentId?: string | null;
  /** Reports progressive large-path rendering so playback can pause during rasterization. */
  onRenderingChange?: (rendering: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}

type RenderedSegment = { source: ViewerSegment; a: THREE.Vector3; b: THREE.Vector3; points: THREE.Vector3[] };
type LineBatch = { line: LineSegments2; played: LineSegments2; count: number };

const finitePoint = (p: ViewerPoint): p is { x: number; y: number; z: number } =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** Three.js toolpath viewport. Segments with any unknown coordinate are deliberately omitted. */
export default function Viewer3D({
  segments,
  packedPositions,
  segmentIndices,
  selectedSegmentId = null,
  onSelectSegment,
  showRapid: rapidProp = true,
  showLinear: linearProp = true,
  showNodes = true,
  progressSegmentId = selectedSegmentId,
  onRenderingChange,
  className,
  style,
}: Viewer3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    rapid: LineSegments2;
    linear: LineSegments2;
    highlight: LineSegments2;
    playedRapid: LineSegments2;
    playedLinear: LineSegments2;
    nodes: THREE.Points;
    materials: LineMaterial[];
    raycaster: THREE.Raycaster;
    resizeObserver: ResizeObserver;
    largePaths: boolean;
    rapidBatches: LineBatch[];
    linearBatches: LineBatch[];
    renderProgressively: () => void;
    requestRender: () => void;
  } | null>(null);
  const renderedRef = useRef<RenderedSegment[]>([]);
  const nodeSourcesRef = useRef<RenderedSegment[]>([]);
  const renderedById = useRef(new Map<string, RenderedSegment>());
  const selectRef = useRef(onSelectSegment);
  const [showRapid, setShowRapid] = useState(rapidProp);
  const [showLinear, setShowLinear] = useState(linearProp);
  const [showNodesState, setShowNodesState] = useState(showNodes);
  const [nodeDensity, setNodeDensity] = useState(30);
  const [lineWidth, setLineWidth] = useState(2.5);
  const [plane, setPlane] = useState<ViewerPlane>('XY');
  const [ready, setReady] = useState(false);
  const [renderingLargePath, setRenderingLargePath] = useState(false);
  const renderingLargePathRef = useRef(false);
  const onRenderingChangeRef = useRef(onRenderingChange);

  useEffect(() => { selectRef.current = onSelectSegment; }, [onSelectSegment]);
  useEffect(() => { onRenderingChangeRef.current = onRenderingChange; }, [onRenderingChange]);
  useEffect(() => setShowRapid(rapidProp), [rapidProp]);
  useEffect(() => setShowLinear(linearProp), [linearProp]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#111827');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e9);
    camera.position.set(120, -150, 140);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    const basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(basePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);

    const grid = new THREE.GridHelper(200, 20, '#536477', '#344152');
    grid.name = 'toolpath-grid';
    scene.add(grid);
    const axes = new THREE.AxesHelper(100);
    axes.name = 'toolpath-axes';
    scene.add(axes);

    const makeLineMaterial = (color: string, opacity: number, width: number) => new LineMaterial({
      color, linewidth: width, transparent: opacity < 1, opacity, resolution: new THREE.Vector2(1, 1),
    });
    const rapidMaterial = makeLineMaterial('#f4a340', 0.38, lineWidth);
    const linearMaterial = makeLineMaterial('#38c8a0', 0.38, lineWidth);
    const playedRapidMaterial = makeLineMaterial('#ffcb79', 0.95, lineWidth);
    const playedLinearMaterial = makeLineMaterial('#7fffd4', 0.95, lineWidth);
    const highlightMaterial = makeLineMaterial('#fff36d', 1, lineWidth + 3);
    highlightMaterial.depthTest = false;
    const rapid = new LineSegments2(new LineSegmentsGeometry(), rapidMaterial);
    const linear = new LineSegments2(new LineSegmentsGeometry(), linearMaterial);
    const highlight = new LineSegments2(new LineSegmentsGeometry(), highlightMaterial);
    const playedRapid = new LineSegments2(new LineSegmentsGeometry(), playedRapidMaterial);
    const playedLinear = new LineSegments2(new LineSegmentsGeometry(), playedLinearMaterial);
    const materials = [rapidMaterial, linearMaterial, playedRapidMaterial, playedLinearMaterial, highlightMaterial];
    const nodes = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#e6f4ef', size: 4, sizeAttenuation: false, transparent: true, opacity: 1, depthTest: false }));
    highlight.renderOrder = 2;
    playedRapid.renderOrder = 1;
    playedLinear.renderOrder = 1;
    nodes.renderOrder = 1;
    scene.add(rapid, linear, playedRapid, playedLinear, nodes, highlight);
    const raycaster = new THREE.Raycaster();

    let frame = 0;
    let progressiveToken = 0;
    const requestRender = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const currentEngine = engineRef.current;
      if (currentEngine?.largePaths) {
        currentEngine.renderProgressively();
        return;
      }
      progressiveToken += 1;
      if (renderingLargePathRef.current) {
        renderingLargePathRef.current = false;
        setRenderingLargePath(false);
        onRenderingChangeRef.current?.(false);
      }
      rapid.visible = showRapidRef.current;
      linear.visible = showLinearRef.current;
      playedRapid.visible = showRapidRef.current;
      playedLinear.visible = showLinearRef.current;
      nodes.visible = showNodesRef.current;
      highlight.visible = true;
      renderer.autoClear = true;
      renderer.autoClearColor = true;
      renderer.autoClearDepth = true;
      scene.background = new THREE.Color('#111827');
      frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera); });
    };
    controls.addEventListener('change', requestRender);
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      materials.forEach((material) => material.resolution.set(width, height));
      requestRender();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const currentEngine = engineRef.current;
      const visible = currentEngine?.largePaths
        ? [...(showRapidRef.current ? currentEngine.rapidBatches.map((batch) => batch.line) : []), ...(showLinearRef.current ? currentEngine.linearBatches.map((batch) => batch.line) : [])]
        : [showRapidRef.current ? rapid : null, showLinearRef.current ? linear : null].filter(Boolean) as THREE.Object3D[];
      if (showNodesRef.current) visible.push(nodes);
      const hit = raycaster.intersectObjects(visible, false)[0];
      if (!hit) return;
      if (hit.object === nodes) {
        const item = nodeSourcesRef.current[hit.index ?? -1];
        if (item) selectRef.current?.(item.source);
        return;
      }
      const index = hit.faceIndex ?? -1;
      const object = hit.object as LineSegments2;
      const bucket = (object.userData.primitiveSources as ViewerSegment[] | undefined)
        ?? (object === rapid ? rapidPrimitiveSources.current : linearPrimitiveSources.current);
      const item = bucket[index];
      if (item) selectRef.current?.(item);
    };
    renderer.domElement.addEventListener('click', handleClick);
    const engine: NonNullable<typeof engineRef.current> = { renderer, scene, camera, controls, rapid, linear, highlight, playedRapid, playedLinear, nodes, materials, raycaster, resizeObserver, largePaths: false, rapidBatches: [], linearBatches: [], renderProgressively: () => {}, requestRender };
    engineRef.current = engine;
    engine.renderProgressively = () => {
      const token = ++progressiveToken;
      if (frame) cancelAnimationFrame(frame);
      if (!renderingLargePathRef.current) {
        renderingLargePathRef.current = true;
        setRenderingLargePath(true);
        onRenderingChangeRef.current?.(true);
      }
      const rapidChunks = showRapidRef.current ? engine.rapidBatches : [];
      const linearChunks = showLinearRef.current ? engine.linearBatches : [];
      const rapidPlayed = showRapidRef.current ? engine.rapidBatches.filter((batch) => batch.played.geometry.instanceCount > 0) : [];
      const linearPlayed = showLinearRef.current ? engine.linearBatches.filter((batch) => batch.played.geometry.instanceCount > 0) : [];
      const drawList = [...rapidChunks.map((batch) => batch.line), ...linearChunks.map((batch) => batch.line), ...rapidPlayed.map((batch) => batch.played), ...linearPlayed.map((batch) => batch.played)];
      const allChunks = [...engine.rapidBatches, ...engine.linearBatches];
      allChunks.forEach((batch) => { batch.line.visible = false; batch.played.visible = false; });
      engine.rapid.visible = false;
      engine.linear.visible = false;
      engine.playedRapid.visible = false;
      engine.playedLinear.visible = false;
      engine.nodes.visible = false;
      engine.highlight.visible = false;
      renderer.autoClear = true;
      renderer.autoClearColor = true;
      renderer.autoClearDepth = true;
      scene.background = new THREE.Color('#111827');
      frame = requestAnimationFrame(() => {
        if (token !== progressiveToken) return;
        renderer.render(scene, camera);
        scene.background = null;
        renderer.autoClear = false;
        renderer.autoClearColor = false;
        renderer.autoClearDepth = false;
        let index = 0;
        const drawNext = () => {
          if (token !== progressiveToken) return;
          if (index < drawList.length) {
            const object = drawList[index++];
            object.visible = true;
            renderer.render(scene, camera);
            object.visible = false;
            frame = requestAnimationFrame(drawNext);
            return;
          }
          engine.nodes.visible = showNodesRef.current;
          engine.highlight.visible = true;
          renderer.render(scene, camera);
          frame = 0;
          if (renderingLargePathRef.current) {
            renderingLargePathRef.current = false;
            setRenderingLargePath(false);
            onRenderingChangeRef.current?.(false);
          }
        };
        frame = requestAnimationFrame(drawNext);
      });
    };
    setReady(true);

    return () => {
      setReady(false);
      cancelAnimationFrame(frame);
      progressiveToken += 1;
      if (renderingLargePathRef.current) {
        renderingLargePathRef.current = false;
        onRenderingChangeRef.current?.(false);
      }
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('click', handleClick);
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof LineSegments2 || object instanceof THREE.Points) {
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
  const rapidPrimitiveSources = useRef<ViewerSegment[]>([]);
  const linearPrimitiveSources = useRef<ViewerSegment[]>([]);
  const progressCounts = useRef(new Map<string, { rapid: number; linear: number }>());
  const showRapidRef = useRef(showRapid);
  const showLinearRef = useRef(showLinear);
  const showNodesRef = useRef(showNodesState);
  useEffect(() => { showRapidRef.current = showRapid; if (engineRef.current) { engineRef.current.rapid.visible = showRapid; engineRef.current.playedRapid.visible = showRapid; engineRef.current.requestRender(); } }, [showRapid]);
  useEffect(() => { showLinearRef.current = showLinear; if (engineRef.current) { engineRef.current.linear.visible = showLinear; engineRef.current.playedLinear.visible = showLinear; engineRef.current.requestRender(); } }, [showLinear]);
  useEffect(() => { setShowNodesState(showNodes); }, [showNodes]);
  useEffect(() => { showNodesRef.current = showNodesState; if (engineRef.current) { engineRef.current.nodes.visible = showNodesState; engineRef.current.requestRender(); } }, [showNodesState]);
  useEffect(() => { updateNodes(); }, [nodeDensity, ready]);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.materials.forEach((material, index) => { material.linewidth = index === 4 ? lineWidth + 3 : lineWidth; });
    engine.requestRender();
  }, [lineWidth, ready]);

  useEffect(() => {
    const engine = engineRef.current;
    const valid: RenderedSegment[] = [];
    const box = new THREE.Box3();
    for (const segment of segments) {
      if (!finitePoint(segment.start) || !finitePoint(segment.end)) continue;
      let path: ViewerPoint[];
      if ((segment.vertices instanceof Float32Array || segment.vertices instanceof Float64Array)) {
        if (segment.vertices.length < 6 || segment.vertices.length % 3 !== 0) continue;
        path = [];
        for (let i = 0; i < segment.vertices.length; i += 3) {
          path.push({ x: segment.vertices[i], y: segment.vertices[i + 1], z: segment.vertices[i + 2] });
        }
      } else if (segment.vertices?.length) {
        path = segment.vertices;
      } else {
        const index = segmentIndices?.get(segment.id);
        const offset = index === undefined ? -1 : index * 6;
        path = packedPositions && offset >= 0 && offset + 5 < packedPositions.length
          ? [{x:packedPositions[offset],y:packedPositions[offset+1],z:packedPositions[offset+2]}, {x:packedPositions[offset+3],y:packedPositions[offset+4],z:packedPositions[offset+5]}]
          : [segment.start, segment.end];
      }
      if (path.some((point) => !finitePoint(point))) continue;
      const points = (path as Array<{ x: number; y: number; z: number }>).map((point) => new THREE.Vector3(point.x, point.y, point.z));
      points.forEach((point) => box.expandByPoint(point));
      const a = points[0];
      const b = points[points.length - 1];
      if (points.length > 1 && points.some((point, index) => index > 0 && point.distanceToSquared(points[index - 1]) > 0)) {
        valid.push({ source: segment, a, b, points });
      }
    }
    renderedRef.current = valid;
    renderedById.current = new Map(valid.map(item => [item.source.id, item]));
    rapidRef.current = valid.filter((item) => item.source.motion === 'G00');
    linearRef.current = valid.filter((item) => item.source.motion !== 'G00');
    progressCounts.current.clear();
    let rapidProgress = 0;
    let linearProgress = 0;
    const seenRapid = new Set<string>();
    const seenLinear = new Set<string>();
    const float32Key = (value: number) => {
      const rounded = Math.fround(value);
      return Object.is(rounded, -0) ? '-0' : String(rounded);
    };
    const primitiveKey = (a: THREE.Vector3, b: THREE.Vector3) => {
      const start = `${float32Key(a.x)},${float32Key(a.y)},${float32Key(a.z)}`;
      const end = `${float32Key(b.x)},${float32Key(b.y)},${float32Key(b.z)}`;
      return start <= end ? `${start}|${end}` : `${end}|${start}`;
    };
    const rapidCapacity = rapidRef.current.reduce((count, item) => count + item.points.length - 1, 0);
    const linearCapacity = linearRef.current.reduce((count, item) => count + item.points.length - 1, 0);
    const rapidPositions = new Float32Array(rapidCapacity * 6);
    const linearPositions = new Float32Array(linearCapacity * 6);
    let rapidOffset = 0;
    let linearOffset = 0;
    rapidPrimitiveSources.current.length = 0;
    linearPrimitiveSources.current.length = 0;
    valid.forEach((item) => {
      progressCounts.current.set(item.source.id, { rapid: rapidProgress, linear: linearProgress });
      const rapidMove = item.source.motion === 'G00';
      const seen = rapidMove ? seenRapid : seenLinear;
      const positions = rapidMove ? rapidPositions : linearPositions;
      const sources = rapidMove ? rapidPrimitiveSources.current : linearPrimitiveSources.current;
      for (let i = 1; i < item.points.length; i += 1) {
        const start = item.points[i - 1];
        const end = item.points[i];
        const key = primitiveKey(start, end);
        if (seen.has(key)) continue;
        seen.add(key);
        positions.set([start.x, start.y, start.z, end.x, end.y, end.z], rapidMove ? rapidOffset : linearOffset);
        if (rapidMove) { rapidOffset += 6; rapidProgress += 1; }
        else { linearOffset += 6; linearProgress += 1; }
        sources.push(item.source);
      }
    });
    progressCounts.current.set('__end__', { rapid: rapidProgress, linear: linearProgress });
    if (!engine) return;

    const setGeometry = (line: LineSegments2, positions: Float32Array, primitiveCount: number) => {
      line.geometry.dispose();
      const geometry = new LineSegmentsGeometry();
      const compactPositions = positions.slice(0, primitiveCount * 6);
      const instanceBuffer = new THREE.InstancedInterleavedBuffer(compactPositions, 6, 1);
      geometry.setAttribute('instanceStart', new THREE.InterleavedBufferAttribute(instanceBuffer, 3, 0));
      geometry.setAttribute('instanceEnd', new THREE.InterleavedBufferAttribute(instanceBuffer, 3, 3));
      geometry.instanceCount = primitiveCount;
      // setPositions recomputes bounds by scanning every endpoint. The path bounds
      // were already collected while validating the input, so reuse them here.
      geometry.boundingBox = box.clone();
      geometry.boundingSphere = new THREE.Sphere(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()).length() / 2);
      line.geometry = geometry;
    };
    setGeometry(engine.rapid, rapidPositions, rapidOffset / 6);
    setGeometry(engine.linear, linearPositions, linearOffset / 6);
    const makeBatches = (line: LineSegments2, played: LineSegments2, positions: Float32Array, sources: ViewerSegment[], count: number) => {
      const previous = line === engine.rapid ? engine.rapidBatches : engine.linearBatches;
      previous.forEach((batch) => {
        engine.scene.remove(batch.line, batch.played);
        batch.line.geometry.dispose();
        batch.played.geometry.dispose();
      });
      previous.length = 0;
      if (!engine.largePaths) return;
      const batchSize = 10000;
      for (let first = 0; first < count; first += batchSize) {
        const size = Math.min(batchSize, count - first);
        const geometry = new LineSegmentsGeometry();
        const array = positions.subarray(first * 6, (first + size) * 6);
        const buffer = new THREE.InstancedInterleavedBuffer(array, 6, 1);
        geometry.setAttribute('instanceStart', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
        geometry.setAttribute('instanceEnd', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
        geometry.instanceCount = size;
        geometry.boundingBox = box.clone();
        geometry.boundingSphere = line.geometry.boundingSphere;
        const chunk = new LineSegments2(geometry, line.material);
        chunk.renderOrder = line.renderOrder;
        chunk.userData.primitiveSources = sources.slice(first, first + size);
        chunk.visible = false;
        const playedGeometry = new LineSegmentsGeometry();
        playedGeometry.setAttribute('instanceStart', geometry.getAttribute('instanceStart'));
        playedGeometry.setAttribute('instanceEnd', geometry.getAttribute('instanceEnd'));
        playedGeometry.instanceCount = size;
        playedGeometry.boundingBox = geometry.boundingBox;
        playedGeometry.boundingSphere = geometry.boundingSphere;
        const playedChunk = new LineSegments2(playedGeometry, played.material);
        playedChunk.renderOrder = played.renderOrder;
        playedChunk.visible = false;
        engine.scene.add(chunk, playedChunk);
        previous.push({ line: chunk, played: playedChunk, count: size });
      }
    };
    engine.largePaths = (rapidOffset + linearOffset) / 6 >= 50000;
    engine.rapid.visible = !engine.largePaths && showRapidRef.current;
    engine.linear.visible = !engine.largePaths && showLinearRef.current;
    engine.playedRapid.visible = !engine.largePaths && showRapidRef.current;
    engine.playedLinear.visible = !engine.largePaths && showLinearRef.current;
    makeBatches(engine.rapid, engine.playedRapid, rapidPositions, rapidPrimitiveSources.current, rapidOffset / 6);
    makeBatches(engine.linear, engine.playedLinear, linearPositions, linearPrimitiveSources.current, linearOffset / 6);
    const bindProgressGeometry = (played: LineSegments2, source: LineSegments2) => {
      played.geometry.dispose();
      played.geometry = new LineSegmentsGeometry();
      played.geometry.setAttribute('instanceStart', source.geometry.getAttribute('instanceStart'));
      played.geometry.setAttribute('instanceEnd', source.geometry.getAttribute('instanceEnd'));
      played.geometry.instanceCount = 0;
      played.geometry.boundingSphere = source.geometry.boundingSphere;
    };
    bindProgressGeometry(engine.playedRapid, engine.rapid);
    bindProgressGeometry(engine.playedLinear, engine.linear);
    updateNodes();

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
    if (valid.length) {
      const span = Math.max(size.length(), 1);
      engine.controls.target.copy(center);
      engine.camera.up.set(0, 0, 1);
      engine.camera.position.set(center.x + span * 1.2, center.y - span * 1.4, center.z + span * 1.2);
      engine.camera.lookAt(center);
      engine.camera.updateProjectionMatrix();
      engine.controls.update();
    }
    engine.requestRender();
  }, [segments, packedPositions, segmentIndices]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const counts = progressSegmentId ? progressCounts.current.get(progressSegmentId) : undefined;
    engine.playedRapid.geometry.instanceCount = counts?.rapid ?? 0;
    engine.playedLinear.geometry.instanceCount = counts?.linear ?? 0;
    const updateBatchProgress = (batches: LineBatch[], count: number) => {
      let remaining = count;
      batches.forEach((batch) => {
        batch.played.geometry.instanceCount = Math.min(remaining, batch.count);
        remaining = Math.max(0, remaining - batch.count);
      });
    };
    updateBatchProgress(engine.rapidBatches, counts?.rapid ?? 0);
    updateBatchProgress(engine.linearBatches, counts?.linear ?? 0);
    engine.requestRender();
  }, [progressSegmentId, ready, segments]);

  function updateNodes() {
    const engine = engineRef.current;
    if (!engine) return;
    const items = renderedRef.current;
    const stride = Math.max(1, Math.round(100 / nodeDensity));
    const visible: RenderedSegment[] = [];
    for (let i = 0; i < items.length; i += stride) visible.push(items[i]);
    if (items.length > 0 && visible[visible.length - 1] !== items[items.length - 1]) visible.push(items[items.length - 1]);
    const positions = new Float32Array(visible.length * 3);
    visible.forEach((item, i) => positions.set([item.b.x, item.b.y, item.b.z], i * 3));
    nodeSourcesRef.current = visible;
    engine.nodes.geometry.dispose();
    engine.nodes.geometry = new THREE.BufferGeometry();
    engine.nodes.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    engine.nodes.geometry.computeBoundingSphere();
    engine.nodes.visible = showNodesState;
    engine.requestRender();
  }

  function frameSelection() {
    const engine = engineRef.current;
    if (!engine) return;
    const selected = selectedSegmentId ? renderedById.current.get(selectedSegmentId) : undefined;
    engine.highlight.geometry.dispose();
    const geo = new LineSegmentsGeometry();
    if (selected) {
      const positions = new Float32Array((selected.points.length - 1) * 6);
      for (let i = 1; i < selected.points.length; i += 1) {
        const a = selected.points[i - 1];
        const b = selected.points[i];
        positions.set([a.x, a.y, a.z, b.x, b.y, b.z], (i - 1) * 6);
      }
      geo.setPositions(positions);
    }
    engine.highlight.geometry = geo;
    engine.requestRender();
  }

  useEffect(() => { frameSelection(); }, [selectedSegmentId, ready]);

  const setView = (view: ViewerPlane) => {
    setPlane(view);
    const engine = engineRef.current;
    if (!engine) return;
    const target = engine.controls.target;
    const box = new THREE.Box3();
    renderedRef.current.forEach((item) => item.points.forEach((point) => box.expandByPoint(point)));
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
    renderedRef.current.forEach((item) => item.points.forEach((point) => box.expandByPoint(point)));
    if (box.isEmpty()) { engine.controls.target.set(0, 0, 0); engine.camera.position.set(120, -150, 140); engine.camera.up.set(0, 0, 1); }
    else {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.length(), 1);
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
        <label style={toggleStyle}><input type="checkbox" checked={showLinear} onChange={(e) => setShowLinear(e.target.checked)} /> G01/G02/G03 경로</label>
        <label style={toggleStyle}><input type="checkbox" checked={showNodesState} onChange={(e) => setShowNodesState(e.target.checked)} /> 점 표시</label>
        <label style={rangeStyle} title="표시할 이동 지점의 밀도를 조절합니다.">점 밀도 <input aria-label="점 밀도" type="range" min="5" max="100" step="5" value={nodeDensity} onChange={(e) => setNodeDensity(Number(e.target.value))} /><span>{nodeDensity}%</span></label>
        <label style={rangeStyle} title="경로 선 두께를 화면 픽셀 단위로 조절합니다.">선 두께 <input aria-label="선 두께" type="range" min="1" max="8" step="0.5" value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value))} /><span>{lineWidth}px</span></label>
        <span style={{ marginLeft: 'auto', color: '#9ca3af' }}>G00 <span style={{ color: '#f4a340' }}>━</span> G01 <span style={{ color: '#38c8a0' }}>━</span></span>
      </div>
      <div ref={hostRef} style={{ position: 'relative', flex: 1, minHeight: 200, cursor: 'crosshair' }}>
        {segments.length === 0 && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#9ca3af', pointerEvents: 'none', font: '14px system-ui, sans-serif' }}>표시할 경로가 없습니다</div>}
      </div>
      <div style={{ padding: '4px 10px 8px', color: '#9ca3af', font: '11px system-ui, sans-serif' }}>XYZ 단위: mm · 실제 가공 형상이나 충돌 검증 결과가 아닌 프로그램 경로입니다.{renderingLargePath && ' · 경로를 나누어 그리는 중…'}</div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = { border: '1px solid #475569', borderRadius: 4, padding: '4px 9px', color: '#e5e7eb', background: '#1f2937', cursor: 'pointer' };
const toggleStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' };
const rangeStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, color: '#9ca3af', whiteSpace: 'nowrap' };
