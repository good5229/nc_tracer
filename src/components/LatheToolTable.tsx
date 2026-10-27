export type ToolDraft={diameter:string;orientation:string;offsetX:string;offsetZ:string};
type Props={tools:Record<string,ToolDraft>;onChange:(tools:Record<string,ToolDraft>)=>void};
import {useState} from 'react';

export default function LatheToolTable({tools,onChange}:Props){
 const [newTool,setNewTool]=useState('');
 const canAdd=/^[1-9]\d{0,3}$/.test(newTool)&&!Object.hasOwn(tools,newTool)&&Object.keys(tools).length<100;
 return <details className="tool-table"><summary>선반 공구표 편집</summary><p>공구 지름과 X/Z 오프셋은 mm, 방향은 LinuxCNC Q 번호입니다. 공구표를 변경한 뒤 다시 해석해야 적용됩니다. 공구 교환 위치는 고정이고 G54는 0으로 가정합니다.</p>
  {Object.entries(tools).sort(([a],[b])=>Number(a)-Number(b)).map(([id,tool])=><fieldset key={id}><legend>T{id}</legend><div className="stock-controls tool-dimensions">{([['diameter','지름'],['orientation','방향 Q'],['offsetX','X 오프셋'],['offsetZ','Z 오프셋']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={`T${id} ${label}`} type="number" step={key==='orientation'?'1':'any'} value={tool[key]} onChange={event=>onChange({...tools,[id]:{...tool,[key]:event.target.value}})}/></label>)}<button type="button" className="button secondary" aria-label={`T${id} 삭제`} onClick={()=>{const next={...tools};delete next[id];onChange(next);}}>삭제</button></div></fieldset>)}
  <div className="stock-controls"><label>추가 공구 번호 <input aria-label="추가 공구 번호" type="number" min="1" max="9999" step="1" value={newTool} onChange={event=>setNewTool(event.target.value)}/></label><button type="button" className="button secondary" disabled={!canAdd} onClick={()=>{onChange({...tools,[newTool]:{diameter:'0.4',orientation:'2',offsetX:'0',offsetZ:'0'}});setNewTool('');}}>공구 추가</button></div>
 </details>;
}
