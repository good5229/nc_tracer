import {describe,expect,it} from 'vitest';
import {parseGcode} from '../../src/parser/gcode';
const fanuc={controllerProfile:'fanuc' as const};
describe('bounded FANUC work-coordinate preview',()=>{
 it('does not treat an N-labelled trailing delimiter as a motion after M30',()=>{
  const r=parseGcode('G21 G90 G0 X0 Y0 Z0\nG1 X1\nM30\nN10 (종료)\nN11 %',fanuc);
  expect(r.warnings.some(w=>w.code==='CODE_AFTER_PROGRAM_END')).toBe(false);
  const extra=parseGcode('G21 G90 G0 X0 Y0 Z0\nM30\nN11 %\nN12 G1 X9',fanuc);
  expect(extra.warnings.some(w=>w.code==='CODE_AFTER_PROGRAM_END'&&w.sourceLine===4)).toBe(true);
 });
 it('treats sequence numbers as labels without changing arc geometry or warnings',()=>{
  const blocks=['G54','G90 G17 G0 X1 Y0 Z0','G03 X0 Y1 I-1 J0','G03 X-1.0005 Y0 I0 J-1'];
  const plain=parseGcode(blocks.join('\n'),fanuc);
  const numbered=parseGcode(blocks.map((line,i)=>`N${i+1} ${line}`).join('\n'),fanuc);
  expect(numbered.warnings.map(w=>[w.sourceLine,w.code])).toEqual(plain.warnings.map(w=>[w.sourceLine,w.code]));
  expect(numbered.segments.map(s=>[s.motion,s.start,s.end,Array.from(s.vertices??[])])).toEqual(plain.segments.map(s=>[s.motion,s.start,s.end,Array.from(s.vertices??[])]));
  expect(numbered.segments.map(s=>s.nBlock)).toEqual(['3','4']);
  expect(numbered.warnings.some(w=>w.code==='APPROXIMATE_ARC')).toBe(true);
 });
 it('leaves an unknown home movement disconnected and resumes at known absolute coordinates',()=>{
  const r=parseGcode('%\nO0001\nG54\nG21 G90 G0 X1 Y2 Z3\nG1 X4\nG91 G28 Z0.\nG90 G0 X10 Y20 Z30\nG1 X40',fanuc);
  expect(r.status).toBe('PARTIAL');expect(r.segments).toHaveLength(2);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([5,8]);
  expect(r.segments[1].start).toEqual({x:10,y:20,z:30});
  expect(r.warnings).toContainEqual(expect.objectContaining({code:'UNKNOWN_MACHINE_HOME',sourceLine:6}));
 });
 it('breaks the path at tool changes and does not draw an invented repositioning move',()=>{
  const r=parseGcode('G21 G90 G0 X1 Y2 Z3\nG1 X4\nT2 M6\nG0 X5 Y6 Z7\nG1 Z8',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([2,5]);expect(r.segments[1].start).toEqual({x:5,y:6,z:7});
  expect(r.warnings).toContainEqual(expect.objectContaining({code:'UNKNOWN_TOOL_CHANGE',sourceLine:3}));
 });
 it('does not join a machine-coordinate rapid to the following work-coordinate move',()=>{
  const r=parseGcode('G21 G90 G0 X1 Y2 Z3\nG1 X4\nG90 G53 G0 X-50\nG90 G0 X5 Y6 Z7\nG1 Z8',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([2,5]);expect(r.segments[1].start).toEqual({x:5,y:6,z:7});
  expect(r.warnings).toContainEqual(expect.objectContaining({code:'UNKNOWN_MACHINE_POSITION',sourceLine:3}));
 });
 it('stops instead of guessing a nonzero G28 intermediate move',()=>{
  const r=parseGcode('G21 G90 G0 X1 Y2 Z3\nG91 G28 Z1',fanuc);
  expect(r.warnings.at(-1)?.code).toBe('UNSUPPORTED_G28');
 });
 it('can display programmed coordinates in one work frame when unit and positions are provided by the code',()=>{
  const r=parseGcode('G54\nG21 G90 G0 X1 Y2 Z3\nG1 X4',fanuc);
  expect(r.status).toBe('PARTIAL');expect(r.segments).toHaveLength(1);expect(r.segments[0].end).toEqual({x:4,y:2,z:3});
  expect(r.warnings.some(w=>w.code==='UNKNOWN_WORK_ORIGIN')).toBe(true);
 });
 it('separates different work frames without joining coordinates',()=>{
  const r=parseGcode('G54\nG21 G90 G0 X1 Y2 Z3\nG1 X4\nG55\nG0 X10 Y20 Z30\nG1 X11',fanuc);
  expect(r.status).toBe('PARTIAL');expect(r.segments).toHaveLength(2);
  expect(r.segments.map(s=>s.workFrame)).toEqual([54,55]);expect(r.segments[1].start).toEqual({x:10,y:20,z:30});
  expect(r.warnings.some(w=>w.code==='UNKNOWN_WORK_OFFSET')).toBe(true);
 });
 it('renders unscaled programmed coordinates after unknown machine commands and marks their boundaries',()=>{
  const r=parseGcode('G54\nG91 G28 Z0\nT1 M6\nM200\nG05 P10000\nG90 G00 X0 Y0\nG43 Z5 H1\nM03\nG01 Z-1\nG01 X2',fanuc);
  expect(r.status).toBe('PARTIAL');expect(r.segments.map(s=>s.sourceLine)).toEqual([9,10]);
  expect(r.segments[0].unit).toBe('native');expect(r.segments[0].start).toEqual({x:0,y:0,z:5});
  expect(r.warnings.map(w=>w.code)).toContain('UNCERTAIN_FANUC_BOUNDARY');
  expect(r.warnings.map(w=>w.code)).toContain('UNKNOWN_FANUC_TOOL_OFFSET');
 });
 it('breaks position after an unverified machine command and only resumes with known coordinates',()=>{
  const r=parseGcode('G54\nG90 G0 X0 Y0 Z1\nG1 X1\nM200\nX2\nG1 X3\nG90 G0 X4 Y5 Z6\nG1 X7',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([3,8]);expect(r.segments[1].start).toEqual({x:4,y:5,z:6});
  expect(r.warnings.some(w=>w.code==='UNCERTAIN_FANUC_BOUNDARY')).toBe(true);
 });
 it('retains explicitly programmed modal plane for a preview after a machine command',()=>{
  const r=parseGcode('G54\nG17 G90 G0 X0 Y0 Z5\nM132\nZ0\nG1 X0 Y0\nG3 X1 Y1 I0 J1',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([6]);
  expect(r.segments[0].plane).toBe('XY');
  expect(r.warnings.some(w=>w.code==='UNCERTAIN_FANUC_BOUNDARY' && w.sourceLine===3)).toBe(true);
 });
 it('does not connect or overlay separate rotary-command groups',()=>{
  const r=parseGcode('G54\nG90 G0 X0 Y0 Z0\nG1 X1\nG90 G0 X2 Y0 B20\nG0 Z1\nG1 X3',fanuc);
  expect(r.segments.map(s=>s.rotaryGroup)).toEqual([0,1]);expect(r.segments[1].start).toEqual({x:2,y:0,z:1});
  expect(r.warnings.some(w=>w.code==='UNKNOWN_ROTARY_AXIS')).toBe(true);
  expect(r.rotaryCommands?.[1]).toEqual({sourceLine:4,command:'B20°',mode:'absolute'});
 });
 it('records rotary commands as commands, including a known incremental mode',()=>{
  const r=parseGcode('G54\nG91\nG0 B10 C-20\nG90 G0 X0 Y0 Z0\nG1 X1\nG68.2 I0 J0 K0\nG90 G0 X0 Y0 Z0\nG1 X2',fanuc);
  expect(r.rotaryCommands?.[1]).toEqual({sourceLine:3,command:'B10° · C-20°',mode:'incremental'});
  expect(r.rotaryCommands?.[2]).toBeUndefined();
 });
 it('resumes after a rotary G91/G01 block without inventing its simultaneous movement',()=>{
  const r=parseGcode('G54\nG90 G0 X0 Y0 Z0\nG1 X1\nG91 G1 B15 X2 F50\nG1 X1\nG90 G0 X10 Y20 Z30\nG1 X11',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([3,7]);
  expect(r.segments[1].start).toEqual({x:10,y:20,z:30});
  expect(r.rotaryCommands?.[1]).toEqual({sourceLine:4,command:'B15°',mode:'incremental'});
  expect(r.warnings.some(w=>w.code==='UNKNOWN_ROTARY_AXIS')).toBe(true);
  expect(r.warnings.some(w=>w.code==='UNSUPPORTED_ROTARY_AXIS')).toBe(false);
 });
 it('keeps rotary groups separate even when no work coordinate system is specified',()=>{
  const r=parseGcode('G90 G17 G0 X0 Y0 Z5\nG1 X1\nG0 B20\nG0 X2 Y0 Z5\nG1 X3\nG84 Z-2 R1\nG80',fanuc);
  expect(r.segments.map(s=>s.rotaryGroup)).toEqual([0,1,1,1,1]);
  expect(r.segments.every(s=>s.workFrame===undefined)).toBe(true);
  expect(r.rotaryCommands?.[1]).toMatchObject({sourceLine:3,command:'B20°'});
 });
 it('omits unsupported drilling cycles and resumes only after G80 and a new anchor',()=>{
  const r=parseGcode('G54\nG90 G0 X0 Y0 Z1\nG1 X1\nG84 X2 Z-2 R1 Q.5\nX3\nG80\nG90 G0 X4 Y5 Z6\nG1 X7',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([3,8]);expect(r.segments[1].start).toEqual({x:4,y:5,z:6});
  expect(r.warnings.some(w=>w.code==='UNCERTAIN_FANUC_CYCLE')).toBe(true);
 });
 it('shows the G83 depth range and known approach and final return at each hole',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nG94 G83 G98 Z-4 R1 Q2\nX3 Y4\nG80\nG90 G0 X10 Y10 Z5\nG1 X11',fanuc);
  const spans=r.segments.filter(s=>s.drillSpan);
  expect(spans.map(s=>[s.sourceLine,s.start,s.end])).toEqual([
   [3,{x:1,y:2,z:5},{x:1,y:2,z:1}],
   [3,{x:1,y:2,z:1},{x:1,y:2,z:-1}],
   [3,{x:1,y:2,z:-1},{x:1,y:2,z:-3}],
   [3,{x:1,y:2,z:-3},{x:1,y:2,z:-4}],
   [3,{x:1,y:2,z:-4},{x:1,y:2,z:1}],
   [3,{x:1,y:2,z:1},{x:1,y:2,z:5}],
   [4,{x:3,y:4,z:5},{x:3,y:4,z:1}],
   [4,{x:3,y:4,z:1},{x:3,y:4,z:-1}],
   [4,{x:3,y:4,z:-1},{x:3,y:4,z:-3}],
   [4,{x:3,y:4,z:-3},{x:3,y:4,z:-4}],
   [4,{x:3,y:4,z:-4},{x:3,y:4,z:1}],
   [4,{x:3,y:4,z:1},{x:3,y:4,z:5}],
  ]);
  expect(spans.every(s=>s.status==='PARTIAL' && s.warningIds.length>0)).toBe(true);
  expect(spans.filter(s=>s.sourceLine===3 && s.drillPhase==='in').map(s=>s.drillPeck)).toEqual([{index:1,total:3},{index:2,total:3},{index:3,total:3}]);
  expect(r.segments.at(-1)?.sourceLine).toBe(7);
 });
 it('bounds the G83 peck expansion and falls back to a marked depth range',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nG83 Z-4 R1 Q0.001\nG80',fanuc);
  const drill=r.segments.filter(s=>s.sourceLine===3);
  expect(drill.map(s=>s.drillPhase??'depth')).toEqual(['approach','depth','return']);
  expect(drill.every(s=>s.status==='PARTIAL')).toBe(true);
 });
 it('does not invent G83 intermediate re-entry or G98 height when unknown',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nG83 G99 Z-4 R1 Q2\nX3 Y4\nG80',fanuc);
  const a=r.segments.filter(s=>s.sourceLine===3),b=r.segments.filter(s=>s.sourceLine===4);
  expect(a.map(s=>s.drillPhase??'depth')).toEqual(['approach','in','in','in','return']);
  expect(b.map(s=>s.drillPhase??'depth')).toEqual(['in','in','in','return']);
  expect(a.every(s=>s.status==='PARTIAL')).toBe(true);
  expect(r.warnings.find(w=>w.sourceLine===3)?.message).toContain('중간 후퇴·재진입');
 });
 it('shows G84 tapping depth at each known programmed hole after M29',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG94 G84 G98 Z-4 R1 F40\nX3 Y4\nG80',fanuc);
  expect(r.segments.filter(s=>s.drillSpan==='G84').map(s=>[s.sourceLine,s.start,s.end])).toEqual([
   [4,{x:1,y:2,z:5},{x:1,y:2,z:1}],
   [4,{x:1,y:2,z:1},{x:1,y:2,z:-4}],
   [4,{x:1,y:2,z:-4},{x:1,y:2,z:1}],
   [4,{x:1,y:2,z:1},{x:1,y:2,z:5}],
   [5,{x:3,y:4,z:5},{x:3,y:4,z:1}],
   [5,{x:3,y:4,z:1},{x:3,y:4,z:-4}],
   [5,{x:3,y:4,z:-4},{x:3,y:4,z:1}],
   [5,{x:3,y:4,z:1},{x:3,y:4,z:5}],
  ]);
  expect(r.warnings.some(w=>w.code==='UNCERTAIN_RIGID_TAPPING')).toBe(true);
  expect(r.segments.filter(s=>s.drillSpan==='G84').map(s=>s.tappingPitch)).toEqual([0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4]);
 });
 it('adds a G98 clearance only when the initial height is known and above R',()=>{
  const code=(mode:string,start:string)=>`G54\nG90 G17 G0 X1 Y2 ${start}\nM29 S100\nG94 G84 ${mode} Z-4 R1 Q2 F40`;
  const g98=parseGcode(code('G98','Z5'),fanuc);
  const clearance=g98.segments.find(s=>s.tapPhase==='clearance');
  expect(clearance).toMatchObject({motion:'G00',start:{x:1,y:2,z:1},end:{x:1,y:2,z:5},status:'PARTIAL'});
  for(const [mode,start] of [['G99','Z5'],['G98',''],['G98','Z0']]){
   expect(parseGcode(code(mode,start),fanuc).segments.some(s=>s.tapPhase==='clearance')).toBe(false);
  }
 });
 it('accepts a return mode before G84, including between M29 and the cycle',()=>{
  for(const before of ['G98\nM29 S100','M29 S100\nG98','M29 S100\nG94 F40\nG98']){
   const r=parseGcode(`G54\nG90 G17 G0 X1 Y2 Z5\n${before}\nG84 Z-4 R1 F40\nG80`,fanuc);
   expect(r.segments.find(s=>s.tapPhase==='clearance')).toMatchObject({start:{x:1,y:2,z:1},end:{x:1,y:2,z:5}});
   expect(r.warnings.some(w=>w.code==='UNSUPPORTED_GCODE')).toBe(false);
  }
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nG98\nG99\nM29 S100\nG84 Z-4 R1\nG80',fanuc);
  expect(r.segments.some(s=>s.tapPhase==='clearance')).toBe(false);
  expect(parseGcode('G98 G99',fanuc).warnings.at(-1)?.code).toBe('CONFLICTING_MODAL');
 });
 it('does not preserve the pre-M29 position over an intervening motion',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG0 X3\nG98\nG84 Z-4 R1',fanuc);
  expect(r.segments.some(s=>s.drillSpan==='G84')).toBe(false);
 });
 it('only approaches R from a known previous cycle height',()=>{
  const code=(mode:string,start:string)=>`G54\nG90 G17 G0 X1 Y2 ${start}\nM29 S100\nG84 ${mode} Z-4 R1\nX3 Y4`;
  expect(parseGcode(code('G98','Z5'),fanuc).segments.filter(s=>s.tapPhase==='approach')).toHaveLength(2);
  expect(parseGcode(code('G99','Z5'),fanuc).segments.filter(s=>s.tapPhase==='approach')).toHaveLength(1);
  expect(parseGcode(code('','Z5'),fanuc).segments.filter(s=>s.tapPhase==='approach')).toHaveLength(1);
  expect(parseGcode(code('G98',''),fanuc).segments.filter(s=>s.tapPhase==='approach')).toHaveLength(0);
 });
 it('does not repeat tapping for feed-only or return-mode-only blocks',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG94 G84 G98 Z-4 R1 F40\nF50\nG99\nX3 Y4\nG80',fanuc);
  expect(r.segments.filter(s=>s.drillSpan==='G84').map(s=>s.sourceLine)).toEqual([4,4,4,4,7,7,7]);
  expect(r.segments.filter(s=>s.sourceLine===7 && s.drillSpan==='G84').every(s=>s.tappingPitch===0.5)).toBe(true);
  expect(r.segments.filter(s=>s.sourceLine===7).some(s=>s.tapPhase==='clearance')).toBe(false);
 });
 it('does not repeat a G83 depth range for a feed-only block',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nG83 Z-4 R1 Q2 F40\nF50\nX3\nG80',fanuc);
  expect([...new Set(r.segments.filter(s=>s.drillSpan==='G83').map(s=>s.sourceLine))]).toEqual([3,5]);
 });
 it('waits for coordinates after a standalone G84 or G83 selection',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG94 G98 G84 F40\nF50\nZ-4 R1 Q2\nG80',fanuc);
  const moves=r.segments.filter(s=>s.drillSpan==='G84');
  expect(moves.map(s=>s.sourceLine)).toEqual([6,6,6,6,6,6]);
  expect(moves[0]).toMatchObject({tapPhase:'approach',start:{x:1,y:2,z:5},end:{x:1,y:2,z:1},tappingPitch:0.5});
  expect(moves.at(-1)?.tapPhase).toBe('clearance');
  const drill=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nG83\nZ-4 R1 Q2\nG80',fanuc);
  expect([...new Set(drill.segments.filter(s=>s.drillSpan==='G83').map(s=>s.sourceLine))]).toEqual([4]);
  const cancel=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nG84\nG80\nG90 G0 X2 Y3 Z4\nG1 X5',fanuc);
  expect(cancel.segments.map(s=>s.sourceLine)).toEqual([6]);
 });
 it('cancels a canned cycle on an ordinary motion without connecting the unknown return',()=>{
  for(const cycle of ['G84 Z-4 R1','G84','G83 Z-4 R1 Q2']){
   const r=parseGcode(`G54\nG90 G17 G0 X1 Y2 Z5\n${cycle}\nG90 G0 X10 Y20 Z30\nG1 X11`,fanuc);
   expect(r.segments.at(-1)).toMatchObject({sourceLine:5,start:{x:10,y:20,z:30},end:{x:11,y:20,z:30}});
   expect(r.segments.some(s=>s.sourceLine===4)).toBe(false);
   expect(r.warnings.some(w=>w.code==='UNCERTAIN_CYCLE_END' && w.sourceLine===4)).toBe(true);
  }
 });
 it('resumes after an unsupported cycle is cancelled by ordinary motion',()=>{
  const r=parseGcode('G54\nG90 G0 X1 Y2 Z5\nG84 Z-4 R1\nG90 G0 X10 Y20 Z30\nG1 X11',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([5]);
  expect(r.segments[0].start).toEqual({x:10,y:20,z:30});
 });
 it('does not calculate a tapping pitch when the feed mode or spindle speed is unknown',()=>{
  for(const setup of ['M29 S100\nG84 Z-4 R1 F40','G94 G84 Z-4 R1 F40']){
   const r=parseGcode(`G54\nG90 G17 G0 X1 Y2 Z5\n${setup}`,fanuc);
   expect(r.segments.find(s=>s.drillSpan==='G84')?.tappingPitch).toBeUndefined();
  }
 });
 it('does not reuse a tapping spindle speed after G80 cancellation',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG94 G84 Z-4 R1 F40\nG80\nG90 G0 X1 Y2 Z5\nG84 Z-4 R1 F40',fanuc);
  expect(r.segments.filter(s=>s.sourceLine===4)[0].tappingPitch).toBe(0.4);
  expect(r.segments.filter(s=>s.sourceLine===7)[0].tappingPitch).toBeUndefined();
 });
 it('clears the pre-M29 position and spindle when a selected G84 is cancelled before drilling',()=>{
  const prefix='G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG94 G84 F40\nG80\n';
  const missingPosition=parseGcode(prefix+'G84 Z-4 R1 F40',fanuc);
  expect(missingPosition.segments.some(s=>s.drillSpan==='G84')).toBe(false);
  const explicitPosition=parseGcode(prefix+'G84 X3 Y4 Z-4 R1 F40',fanuc);
  const moves=explicitPosition.segments.filter(s=>s.drillSpan==='G84');
  expect(moves.map(s=>s.tapPhase)).toEqual(['in','out']);
  expect(moves.every(s=>s.tappingPitch===undefined)).toBe(true);
 });
 it('shows Q-depth tapping passes and final return without inventing intermediate retractions',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG94 G84 Z-4 R1 Q2 F40\nG80',fanuc);
  const moves=r.segments.filter(s=>s.drillSpan==='G84');
  expect(moves.map(s=>[s.start.z,s.end.z,s.tapPhase])).toEqual([[5,1,'approach'],[1,-1,'in'],[-1,-3,'in'],[-3,-4,'in'],[-4,1,'out']]);
  expect(moves.slice(1,4).map(s=>s.tapPeck?.index)).toEqual([1,2,3]);
  expect(r.warnings.some(w=>w.message.includes('중간 후퇴·재진입'))).toBe(true);
 });
 it('keeps very large Q cycles as a depth range rather than allocating unlimited steps',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nG84 Z-100 R1 Q0.001',fanuc);
  expect(r.segments.filter(s=>s.drillSpan==='G84')).toHaveLength(2);
  expect(r.segments[1].tapPhase).toBeUndefined();
 });
 it('treats G84 Q0 as a simple non-peck tapping preview',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nG84 Z-4 R1 Q0',fanuc);
  expect(r.segments.map(s=>s.tapPhase)).toEqual(['approach','in','out']);
 });
 it('does not join ordinary moves across M29',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X1 Y2 Z5\nG1 X2\nM29 S100\nG1 X3\nG0 X4 Y5 Z6\nG1 X7',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([3,7]);
 });
 it('does not infer drilling range without a known plane or positive peck',()=>{
  for(const block of ['G90 G0 X1 Y2 Z5\nG83 Z-4 R1 Q2','G90 G17 G0 X1 Y2 Z5\nG83 Z-4 R1 Q0']){
   const r=parseGcode(block,fanuc);
   expect(r.segments.some(s=>s.drillSpan)).toBe(false);
   expect(r.warnings.some(w=>w.code==='UNCERTAIN_FANUC_CYCLE')).toBe(true);
  }
 });
 it('keeps untransformed coordinates in separate rotation groups',()=>{
  const r=parseGcode('G54\nG90 G0 X0 Y0 Z1\nG1 X1\nG68.2 X0 Y0 Z0 I0 J90 K0\nG53.1\nG0 X4 Y5 Z6\nG1 X7',fanuc);
  expect(r.segments.map(s=>s.rotaryGroup)).toEqual([0,2]);expect(r.segments[1].start).toEqual({x:4,y:5,z:6});
  expect(r.warnings.filter(w=>w.code==='UNKNOWN_ROTARY_TRANSFORM')).toHaveLength(2);
 });
 it('optionally previews FANUC Euler work coordinates without claiming machine motion',()=>{
  const code='G54\nG90 G17 G0 X0 Y0 Z1\nG68.2 X10 Y20 Z30 I90 J90 K0\nG53.1\nG90 G0 X0 Y0 Z0\nG1 X1\nG69\nG90 G0 X0 Y0 Z0\nG1 X1';
  const r=parseGcode(code,{...fanuc,fanucEulerPreview:true});
  expect(r.segments).toHaveLength(2);
  expect(r.segments[0].start.x).toBeCloseTo(10);expect(r.segments[0].start.y).toBeCloseTo(20);expect(r.segments[0].start.z).toBeCloseTo(30);
  expect(r.segments[0].end.x).toBeCloseTo(10);expect(r.segments[0].end.y).toBeCloseTo(21);expect(r.segments[0].end.z).toBeCloseTo(30);
  expect(r.segments[1].end).toEqual({x:1,y:0,z:0});
  expect(r.segments[0].eulerTransformed).toBe(true);expect(r.segments[1].eulerTransformed).toBeUndefined();
  expect(r.warnings.some(w=>w.message.includes('실제 회전축 이동과 장비 설정은 미확인'))).toBe(true);
 });
 it('uses zero for omitted G68.2 origin axes in the optional FANUC preview',()=>{
  const r=parseGcode('G54\nG68.2 I90 J0 K0\nG53.1\nG90 G0 X0 Y0 Z0\nG1 X1',{...fanuc,fanucEulerPreview:true});
  expect(r.segments[0].end.x).toBeCloseTo(0);expect(r.segments[0].end.y).toBeCloseTo(1);
 });
 it('records the G43 H identifier without inventing the offset value',()=>{
  const r=parseGcode('G54\nG90 G0 X0 Y0\nG43 Z5 H7\nG1 X1\nG91 G28 Z0 G49\nG90 G0 X0 Y0 Z5\nG1 X2',fanuc);
  expect(r.segments[0].toolLengthOffset).toBe(7);
  expect(r.segments.at(-1)?.toolLengthOffset).toBeUndefined();
 });
 it('recovers an explicitly commanded absolute endpoint after an arc with unknown plane',()=>{
  const r=parseGcode('G54\nG90 G0 X0 Y0 Z0\nG2 X1 Y1 I0 J1\nG1 X2',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([4]);
  expect(r.segments[0].start).toEqual({x:1,y:1,z:0});
  expect(r.warnings.some(w=>w.code==='UNKNOWN_ARC_PLANE' && w.sourceLine===3)).toBe(true);
 });
 it('skips an inconsistent arc and resumes at its programmed endpoint',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X0 Y0 Z0\nG3 X2 Y0 I0 J1\nG1 X3',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([4]);expect(r.segments[0].start).toEqual({x:2,y:0,z:0});
  expect(r.warnings.some(w=>w.code==='UNCERTAIN_ARC')).toBe(true);
 });
 it('previews a nearly circular arc with a warning while preserving both commanded endpoints',()=>{
  const r=parseGcode('G54\nG90 G17 G0 X0 Y0 Z0\nG3 X1.0002 Y1 I0 J1\nG1 X2',fanuc);
  expect(r.segments.map(s=>s.sourceLine)).toEqual([3,4]);
  expect(r.segments[0].start).toEqual({x:0,y:0,z:0});
  expect(r.segments[0].end).toEqual({x:1.0002,y:1,z:0});
  expect(r.segments[0].status).toBe('PARTIAL');
  expect(r.warnings.find(w=>w.code==='APPROXIMATE_ARC' && w.sourceLine===3)?.message).toContain('0.0002 원본 단위');
 });
 it('reports the radius difference in internal millimeters for inch programs',()=>{
  const r=parseGcode('G54\nG20 G90 G17 G0 X0 Y0 Z0\nG3 X1.00001 Y1 I0 J1',fanuc);
  expect(r.warnings.find(w=>w.code==='APPROXIMATE_ARC')?.message).toContain('0.000254 mm');
 });
 it.each([['M200','M200'],['G05 P10000','G5']])('marks the unverified command %s', (block, command)=>{
  const r=parseGcode(block,fanuc);expect(r.warnings.at(-1)?.message).toContain(command);
 });
 it('does not assume a unit, machine-specific command, or tool-length offset',()=>{
  for(const code of ['G54\nG90 G0 X1 Y2 Z3','G54\nM200','G54\nG43 Z1 H1']){
   const r=parseGcode(code,fanuc);expect(r.segments).toHaveLength(0);expect(r.warnings.length).toBeGreaterThan(0);
  }
 });
});
