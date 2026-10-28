import {useState} from 'react';
import {deleteSavedFile,listSavedFiles,MAX_SAVED_FILES,readSavedFile,saveFile,type SavedFileInfo} from '../storage/savedFiles';

const errorMessage=(error:unknown)=>error instanceof DOMException&&error.name==='QuotaExceededError'?'브라우저 저장 공간이 부족합니다. 공간을 확보한 뒤 다시 시도해 주세요.':error instanceof Error?error.message:'브라우저 저장소를 사용할 수 없습니다. 브라우저 설정을 확인해 주세요.';
const fileSize=(size:number)=>size>=1048576?`${(size/1048576).toFixed(2)} MiB`:`${(size/1024).toFixed(1)} KiB`;

export default function BrowserSavedFiles({currentFile,onOpen}:{currentFile:File|null;onOpen:(file:File)=>void}){
 const [files,setFiles]=useState<SavedFileInfo[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const refresh=async()=>{try{setFiles(await listSavedFiles());}catch(error){setMessage(errorMessage(error));}};
 const save=async()=>{if(!currentFile||busy)return;setBusy(true);setMessage('');try{await saveFile(currentFile);await refresh();setMessage(`${currentFile.name}을 이 브라우저에 저장했습니다.`);}catch(error){setMessage(errorMessage(error));await refresh();}finally{setBusy(false);}};
 const open=async(id:number)=>{if(busy)return;setBusy(true);setMessage('');try{onOpen(await readSavedFile(id));}catch(error){setMessage(errorMessage(error));await refresh();}finally{setBusy(false);}};
 const remove=async(id:number)=>{if(busy)return;setBusy(true);setMessage('');try{await deleteSavedFile(id);await refresh();setMessage('저장된 파일을 삭제했습니다.');}catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}};
 return <details className="saved-files" onToggle={event=>{if(event.currentTarget.open)void refresh();}}>
  <summary>브라우저에 저장한 NC 파일 <span>최대 3개</span></summary>
  <div className="saved-files-body"><p>선택한 NC 파일을 이 기기의 브라우저에만 보관합니다. 사이트 데이터를 지우면 저장된 파일도 삭제될 수 있으므로 원본 파일은 따로 보관해 주세요.</p>
   <button className="button secondary" disabled={!currentFile||busy||files.length>=MAX_SAVED_FILES} onClick={()=>void save()}>현재 NC 파일 저장</button>
   {!currentFile&&<p>먼저 NC 파일을 열어 주세요.</p>}{files.length>=MAX_SAVED_FILES&&<p>3개가 저장되어 있습니다. 새로 저장하려면 기존 파일을 삭제해 주세요.</p>}
   <ul>{files.map(file=><li key={file.id}><div><strong>{file.name}</strong><span>{fileSize(file.size)} · {new Date(file.savedAt).toLocaleString('ko-KR')}</span></div><div className="saved-file-actions"><button className="button secondary" disabled={busy} onClick={()=>void open(file.id)} aria-label={`${file.name} 열기`}>열기</button><button className="button secondary" disabled={busy} onClick={()=>void remove(file.id)} aria-label={`${file.name} 삭제`}>삭제</button></div></li>)}</ul>
   {!files.length&&<p>저장된 NC 파일이 없습니다.</p>}<p role="status" aria-live="polite">{message}</p>
  </div>
 </details>;
}
