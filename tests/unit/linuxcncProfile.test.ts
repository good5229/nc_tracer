import {expect,it} from 'vitest';
import demo from '../../demo/lathe_g70_71_demo.ngc?raw';
import {findLinuxCncSubroutine} from '../../src/parser/linuxcncMacro';
import {resolveLinuxCncProfile} from '../../src/parser/linuxcncProfile';
it('resolves the public G71 profile and preserves the fillet and original rows',()=>{
 const routine=findLinuxCncSubroutine(demo,100)!;const result=resolveLinuxCncProfile(routine,{x:15,z:3.041});
 expect(result.ok).toBe(true);if(!result.ok)return;
 expect(result.profile[0]).toMatchObject({sourceLine:5,motion:'G00',end:{x:0.202,z:3.041}});
 expect(result.profile[1]).toMatchObject({sourceLine:6,motion:'G02',center:{x:3.202,z:3.041}});
 expect(result.profile.find(segment=>segment.sourceLine===17)?.corner).toEqual({kind:'fillet',amount:0.2});
});

it('does not create a corner on an unchanged profile endpoint',()=>{
 const routine=findLinuxCncSubroutine('O100 SUB\nG1 X4\nG1 X4 A1\nG1 Z-10\nG1 X10\nO100 ENDSUB',100)!;
 const result=resolveLinuxCncProfile(routine,{x:10,z:1});expect(result.ok).toBe(true);if(!result.ok)return;
 expect(result.profile).toHaveLength(3);expect(result.profile.every(segment=>!segment.corner)).toBe(true);
});
