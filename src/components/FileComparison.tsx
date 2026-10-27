import { useEffect, useMemo, useRef, useState } from 'react';
import type { ParseResult, ParserOptions } from '../parser/gcode';
import type { GcodeWorkerResponse } from '../workers/gcode.worker';

type Props = { source: string; result: ParseResult | null; options: ParserOptions };

/** Comparison stays in this component's memory and never changes the active program. */
export default function FileComparison({ source, result, options }: Props) {
 const [otherName, setOtherName] = useState('');
 const [otherSource, setOtherSource] = useState('');
 const [other, setOther] = useState<ParseResult | null>(null);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const worker = useRef<Worker | null>(null);
 const version = useRef(0);
 const input = useRef<HTMLInputElement>(null);
 const clear = () => { version.current++; worker.current?.terminate(); worker.current=null; setOtherName(''); setOtherSource(''); setOther(null); setError(''); setBusy(false); if(input.current) input.current.value=''; };
 useEffect(() => { clear(); }, [source]);
 useEffect(() => () => { version.current++; worker.current?.terminate(); }, []);
 const load = async (file: File | undefined) => {
  if (!file) return;
  clear(); const id=++version.current; setBusy(true);
  try {
   const text = new TextDecoder('utf-8', {fatal:true}).decode(await file.arrayBuffer());
   if(id!==version.current) return;
   const w = new Worker(new URL('../workers/gcode.worker.ts', import.meta.url), {type:'module'}); worker.current=w;
   w.onmessage=(event:MessageEvent<GcodeWorkerResponse>) => {
    if(id!==version.current)return;
    setOtherName(file.name);setOtherSource(text);setOther(event.data.result);setBusy(false);w.terminate();if(worker.current===w)worker.current=null;
   };
   w.onerror=()=>{if(id!==version.current)return;setError('비교 파일을 해석할 수 없습니다.');setBusy(false);w.terminate();};
   w.postMessage({type:'parse',text,options});
  } catch { if(id===version.current){setError('비교 파일을 UTF-8로 읽을 수 없습니다.');setBusy(false);} }
 };
 const summary=useMemo(()=>{
  if(!other)return null;
  const left=source.split(/\r?\n/),right=otherSource.split(/\r?\n/); let changed=0;
  for(let i=0;i<Math.max(left.length,right.length);i++)if(left[i]!==right[i])changed++;
  return {leftLines:left.length,rightLines:right.length,changed};
 },[source,otherSource,other]);
 return <details className="comparison"><summary>파일 비교 <span>브라우저 메모리에서만</span></summary><div className="comparison-body">
  <p>현재 파일과 다른 NC 파일의 행 및 해석 결과를 비교합니다. 행 번호 기준 비교이며 가공 동등성을 판정하지 않습니다.</p>
  <button className="button secondary" disabled={!result || busy} onClick={()=>input.current?.click()}>비교 파일 열기</button>{other && <button className="button secondary" onClick={clear}>비교 닫기</button>}
  <input ref={input} type="file" accept=".nc,.ngc,.tap,.gcode,.txt" hidden onChange={e=>void load(e.target.files?.[0])}/>
  {busy && <p role="status">비교 파일 해석 중…</p>}{error && <p role="alert">{error}</p>}
  {other && summary && <div className="comparison-result" aria-live="polite"><strong>{otherName}</strong><span>현재 / 비교</span><span>행 수 {summary.leftLines.toLocaleString()} / {summary.rightLines.toLocaleString()}</span><span>서로 다른 행 위치 {summary.changed.toLocaleString()}</span><span>모션 블록 {result?.segments.length.toLocaleString()} / {other.segments.length.toLocaleString()}</span><span>결과 {result?.status} / {other.status} · 경고 {result?.warnings.length} / {other.warnings.length}</span></div>}
 </div></details>;
}
