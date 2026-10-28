import {simulatePathStock} from '../simulation/pathStockPreview';
self.onmessage=(event:MessageEvent<{edges:Float64Array}>)=>{
 try{const result=simulatePathStock(event.data.edges);if(result.ok)self.postMessage(result,{transfer:[result.stock.heights.buffer,result.stock.cellEdges.buffer]});else self.postMessage(result);}
 catch{self.postMessage({ok:false,message:'예시 형상 계산에 실패했습니다.'});}
};
