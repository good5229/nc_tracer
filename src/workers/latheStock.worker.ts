import {simulateLatheStock,type LatheInsertModel,type LatheStockGrid,type PartingToolShape} from '../simulation/latheStock';
import type {ParseResult,ParserOptions} from '../parser/gcode';
self.onmessage=(event:MessageEvent<{result:ParseResult;options:ParserOptions;model:LatheInsertModel;grid:LatheStockGrid;allowPartial:boolean;partingTools?:Record<string,PartingToolShape>}>)=>{
 try{const result=simulateLatheStock(event.data.result,event.data.options,event.data.model,event.data.grid,event.data.allowPartial,event.data.partingTools);if(result.ok)self.postMessage(result,{transfer:[result.remaining.buffer]});else self.postMessage(result);}
 catch{self.postMessage({ok:false,message:'선반 예제 소재 계산에 실패했습니다.'});}
};
