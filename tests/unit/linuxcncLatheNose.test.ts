import {describe,expect,it} from 'vitest';
import {linuxCncLatheNoseEntry} from '../../src/parser/linuxcncLatheNose';
import reference from '../fixtures/linuxcnc-lathe-comp-reference.json';
describe('LinuxCNC lathe nose compensation entry primitive',()=>{
 it('matches a G41.1 L2 entry whose next corner leaves the first endpoint unchanged',()=>{
  const result=linuxCncLatheNoseEntry({x:10,z:1},{x:8,z:1},.4,'left',2);
  expect(result.ok).toBe(true);
  if(result.ok){const actual=reference.lathe_comp_left.moves[1].end;expect(result.toolOrigin.x).toBeCloseTo(actual[0],4);expect(result.toolOrigin.z).toBeCloseTo(actual[1],4);expect(result.programmedEnd).toEqual({x:8,z:1});}
 });
 it('rejects a lead shorter than the nose radius as the reference interpreter does',()=>{
  expect(reference.lathe_comp_entry_fail.entryError).toBe(true);
  expect(linuxCncLatheNoseEntry({x:10,z:1},{x:9.9,z:1},.4,'left',2)).toMatchObject({ok:false,code:'ENTRY_TOO_SHORT'});
 });
 it('rejects missing or invalid geometry instead of inventing tool parameters',()=>{
  expect(linuxCncLatheNoseEntry({x:10,z:1},{x:8,z:1},0,'left',2)).toMatchObject({ok:false,code:'INVALID_TOOL'});
  expect(linuxCncLatheNoseEntry({x:10,z:1},{x:8,z:1},.4,'left',10)).toMatchObject({ok:false,code:'INVALID_TOOL'});
 });
});

import {linuxCncLatheNoseLines} from '../../src/parser/linuxcncLatheNose';
it('matches both left and right compensation, including corner lookahead',()=>{
 const lines=[{end:{x:8,z:1},motion:'G01' as const,sourceLine:5},{end:{x:8,z:-5},motion:'G01' as const,sourceLine:6},{end:{x:10,z:-5},motion:'G01' as const,sourceLine:7}];
 for(const side of ['left','right'] as const){
  const result=linuxCncLatheNoseLines({x:10,z:1},lines,.4,side,2);expect(result.ok).toBe(true);if(!result.ok)continue;
  const expected=reference[side==='left'?'lathe_comp_left':'lathe_comp_right'].moves.slice(1,-1);
  expect(result.moves).toHaveLength(expected.length);
  result.moves.forEach((move,i)=>{const value=expected[i];expect(move.motion).toBe(value.motion);expect(move.end.x).toBeCloseTo(value.end[0],4);expect(move.end.z).toBeCloseTo(value.end[1],4);if('center'in value&&value.center){expect(move.center?.x).toBeCloseTo(value.center[0],4);expect(move.center?.z).toBeCloseTo(value.center[1],4);}});
 }
});

it('rejects a reversal and a concave move too short to contain the cutter',()=>{
 const start={x:10,z:1},first={end:{x:8,z:1},motion:'G01' as const,sourceLine:5};
 const reverse=linuxCncLatheNoseLines(start,[first,{end:{x:10,z:1},motion:'G01',sourceLine:6}],.4,'left',2);
 expect(reverse).toMatchObject({ok:false,code:'REVERSING_CORNER',sourceLine:6});
 const gouge=linuxCncLatheNoseLines(start,[first,{end:{x:8,z:.9},motion:'G01',sourceLine:6}],.4,'right',2);
 expect(gouge).toMatchObject({ok:false,code:'CONCAVE_GOUGING',sourceLine:6});
});
