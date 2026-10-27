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
