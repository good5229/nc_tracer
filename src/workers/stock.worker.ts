import { simulateNcStock } from '../simulation/ncStock';
import type { ParserOptions } from '../parser/gcode';
self.onmessage = (event:MessageEvent<{source:string;profile:ParserOptions['controllerProfile']}>) => {
  try {
    const result=simulateNcStock(event.data.source,event.data.profile);
    if(result.ok) self.postMessage(result,{transfer:[result.remaining.buffer]}); else self.postMessage(result);
  } catch { self.postMessage({ok:false,message:'예제 소재 계산에 실패했습니다.'}); }
};
