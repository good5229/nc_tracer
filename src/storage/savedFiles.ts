const DB_NAME='nc-viewer-saved-files';
const STORE='files';
export const MAX_SAVED_FILES=3;
export type SavedFileInfo={id:number;name:string;size:number;savedAt:number;lastModified:number;type:string};
type SavedFile=SavedFileInfo & {data:Blob};

function openDatabase():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(new Error('브라우저 저장소를 사용할 수 없습니다.'));return;}
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});
  request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(new Error('다른 탭이 저장소를 사용하고 있습니다. 다른 탭을 닫고 다시 시도해 주세요.'));
 });
}

export async function listSavedFiles():Promise<SavedFileInfo[]>{
 const db=await openDatabase();
 try{return await new Promise((resolve,reject)=>{
  const transaction=db.transaction(STORE,'readonly');const request=transaction.objectStore(STORE).getAll();
  transaction.oncomplete=()=>resolve((request.result as SavedFile[]).map(({id,name,size,savedAt,lastModified,type})=>({id,name,size,savedAt,lastModified,type})).sort((a,b)=>b.savedAt-a.savedAt||b.id-a.id));
  transaction.onabort=()=>reject(transaction.error);transaction.onerror=()=>reject(transaction.error);
 });}finally{db.close();}
}

export async function saveFile(file:File):Promise<void>{
 const db=await openDatabase();
 try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),count=store.count();let full=false;
  count.onsuccess=()=>{if(count.result>=MAX_SAVED_FILES){full=true;tx.abort();return;}store.add({name:file.name,size:file.size,savedAt:Date.now(),lastModified:file.lastModified,type:file.type,data:file.slice(0,file.size,file.type)});};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(full?new Error('최대 3개까지 저장할 수 있습니다. 기존 파일을 삭제한 뒤 다시 시도해 주세요.'):tx.error);tx.onerror=()=>{};
 });}finally{db.close();}
}

export async function readSavedFile(id:number):Promise<File>{
 const db=await openDatabase();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).get(id);
  tx.oncomplete=()=>{const item=request.result as SavedFile|undefined;if(!item){reject(new Error('저장된 파일을 찾을 수 없습니다. 목록을 새로 확인해 주세요.'));return;}resolve(new File([item.data],item.name,{type:item.type,lastModified:item.lastModified}));};
  tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
 });}finally{db.close();}
}

export async function deleteSavedFile(id:number):Promise<void>{
 const db=await openDatabase();
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
