import { useMemo } from 'react';
import type { Motion, MotionSegment, Vector3 } from '../parser/gcode';
import './path-stats.css';

export const PATH_MOTIONS: readonly Motion[] = ['G00', 'G01', 'G02', 'G03'];

/** A null tool id means the parser did not identify a tool for that move. */
export interface PathFilters {
  motions: ReadonlySet<Motion>;
  /** null means every discovered tool is visible; a set may contain null for unspecified tool. */
  tools: ReadonlySet<number | null> | null;
}

export interface PathStatsProps {
  segments: readonly MotionSegment[];
  filters: PathFilters;
  onFiltersChange: (filters: PathFilters) => void;
  className?: string;
}

interface Aggregate {
  count: number;
  distanceMm: number;
  unmeasured: number;
}

const isFinitePoint = (point: Vector3): point is { x: number; y: number; z: number } =>
  Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);

function moveDistance(segment: MotionSegment): number | null {
  if (segment.vertices) {
    const vertices = segment.vertices;
    if (vertices.length < 6 || vertices.length % 3 !== 0) return null;
    let distance = 0;
    for (let i = 3; i < vertices.length; i += 3) {
      const x0 = vertices[i - 3], y0 = vertices[i - 2], z0 = vertices[i - 1];
      const x1 = vertices[i], y1 = vertices[i + 1], z1 = vertices[i + 2];
      if (![x0, y0, z0, x1, y1, z1].every(Number.isFinite)) return null;
      distance += Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    }
    return Number.isFinite(distance) ? distance : null;
  }
  const path = [segment.start, segment.end];
  if (path.some((point) => !isFinitePoint(point))) return null;
  let distance = 0;
  for (let i = 1; i < path.length; i += 1) {
    const previous = path[i - 1];
    const current = path[i];
    distance += Math.hypot(current.x! - previous.x!, current.y! - previous.y!, current.z! - previous.z!);
  }
  return Number.isFinite(distance) ? distance : null;
}

/** Apply the same controlled filters used by the statistics panel to a viewer path. */
export function filterPathSegments(segments: readonly MotionSegment[], filters: PathFilters): MotionSegment[] {
  return segments.filter((segment) =>
    filters.motions.has(segment.motion) &&
    (filters.tools === null || filters.tools.has(segment.tool ?? null)),
  );
}

function add(aggregate: Aggregate, distance: number | null) {
  aggregate.count += 1;
  if (distance === null) aggregate.unmeasured += 1;
  else aggregate.distanceMm += distance;
}

function emptyAggregate(): Aggregate {
  return { count: 0, distanceMm: 0, unmeasured: 0 };
}

const toolKey = (tool: number | null) => tool === null ? 'unknown' : `tool-${tool}`;
const toolName = (tool: number | null) => tool === null ? '공구 미지정' : `T${tool}`;
const formatDistance = (distance: number) => distance.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/**
 * Filters and summarizes source motion blocks. Arc distance uses the parser's tessellated
 * vertices, while playback and counts remain one item per original motion block.
 */
export default function PathStats({ segments, filters, onFiltersChange, className }: PathStatsProps) {
  const stats = useMemo(() => {
    const selected = filterPathSegments(segments, filters);
    const total = emptyAggregate();
    const byMotion = new Map<Motion, Aggregate>(PATH_MOTIONS.map((motion) => [motion, emptyAggregate()]));
    const byTool = new Map<number | null, Aggregate>();
    for (const segment of selected) {
      const distance = moveDistance(segment);
      add(total, distance);
      const motionAggregate = byMotion.get(segment.motion);
      if (motionAggregate) add(motionAggregate, distance);
      const tool = segment.tool ?? null;
      let toolAggregate = byTool.get(tool);
      if (!toolAggregate) { toolAggregate = emptyAggregate(); byTool.set(tool, toolAggregate); }
      add(toolAggregate, distance);
    }
    return { total, byMotion, byTool };
  }, [segments, filters.motions, filters.tools]);

  const toolOptions = useMemo(() => {
    const tools = new Set<number | null>();
    segments.forEach((segment) => tools.add(segment.tool ?? null));
    return [...tools].sort((a, b) => a === null ? 1 : b === null ? -1 : a - b);
  }, [segments]);

  const toggleMotion = (motion: Motion) => {
    const next = new Set(filters.motions);
    if (next.has(motion)) next.delete(motion); else next.add(motion);
    onFiltersChange({ ...filters, motions: next });
  };
  const toggleTool = (tool: number | null) => {
    const next = filters.tools === null ? new Set(toolOptions) : new Set(filters.tools);
    if (next.has(tool)) next.delete(tool); else next.add(tool);
    onFiltersChange({ ...filters, tools: next });
  };

  return (
    <section className={`path-stats${className ? ` ${className}` : ''}`} aria-label="경로 필터 및 통계">
      <div className="path-stats__filters">
        <fieldset>
          <legend>이동 유형</legend>
          {PATH_MOTIONS.map((motion) => (
            <label className={`path-stats__filter path-stats__filter--${motion.toLowerCase()}`} key={motion}>
              <input type="checkbox" checked={filters.motions.has(motion)} onChange={() => toggleMotion(motion)} />
              <span>{motion}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>공구</legend>
          {toolOptions.length === 0 ? <span className="path-stats__empty">공구 정보 없음</span> : toolOptions.map((tool) => (
            <label className="path-stats__filter" key={toolKey(tool)}>
              <input type="checkbox" checked={filters.tools === null || filters.tools.has(tool)} onChange={() => toggleTool(tool)} />
              <span>{toolName(tool)}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="path-stats__summary" aria-live="polite">
        <strong>{stats.total.count.toLocaleString()}개 이동 블록</strong>
        <span>이동 거리 <b>{formatDistance(stats.total.distanceMm)} mm</b></span>
        {stats.total.unmeasured > 0 && <span>{stats.total.unmeasured.toLocaleString()}개 블록은 좌표가 불완전해 거리를 계산하지 않았습니다.</span>}
      </div>

      <div className="path-stats__tables">
        <table>
          <caption>이동 유형별 통계</caption>
          <thead><tr><th scope="col">유형</th><th scope="col">블록 수</th><th scope="col">거리 (mm)</th></tr></thead>
          <tbody>{PATH_MOTIONS.map((motion) => {
            const aggregate = stats.byMotion.get(motion)!;
            return <tr key={motion}><th scope="row">{motion}</th><td>{aggregate.count.toLocaleString()}</td><td>{formatDistance(aggregate.distanceMm)}</td></tr>;
          })}</tbody>
        </table>
        <table>
          <caption>공구별 통계</caption>
          <thead><tr><th scope="col">공구</th><th scope="col">블록 수</th><th scope="col">거리 (mm)</th></tr></thead>
          <tbody>{toolOptions.map((tool) => {
            const aggregate = stats.byTool.get(tool) ?? emptyAggregate();
            return <tr key={toolKey(tool)}><th scope="row">{toolName(tool)}</th><td>{aggregate.count.toLocaleString()}</td><td>{formatDistance(aggregate.distanceMm)}</td></tr>;
          })}</tbody>
        </table>
      </div>
      <p className="path-stats__note">원호 거리는 파서가 만든 분할 경로를 따라 합산합니다. 표시된 거리는 프로그램 이동 경로 길이입니다.</p>
    </section>
  );
}
