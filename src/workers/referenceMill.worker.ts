import { simulateReferenceMill } from '../simulation/referenceMill';
self.onmessage=()=>{try{const result=simulateReferenceMill();if(result.ok)self.postMessage(result,{transfer:[result.remaining.buffer]});else self.postMessage(result);}catch{self.postMessage({ok:false,message:'참조 형상 계산에 실패했습니다.'});}};
