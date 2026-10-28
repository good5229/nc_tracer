import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('loads locally selected demo files, including extensionless NC, without uploading', async ({page}) => {
 const directory=await mkdtemp(join(tmpdir(),'nc-local-demo-'));
 try {
  await writeFile(join(directory,'sample.nc'),'G21 G90 G00 X0 Y0 Z0\nG01 X10\nM30');
  await writeFile(join(directory,'O0001'),'G21 G90 G00 X0 Y0 Z0\nG01 X20\nM30');
  const outgoing:string[]=[];
  page.on('request',request=>{if(request.method()!=='GET')outgoing.push(request.url());});
  await page.goto('/nc_tracer/');
  await page.locator('input[webkitdirectory]').setInputFiles(directory);
  const demos=page.getByLabel('폴더의 파일');
  await expect(demos.locator('option')).toHaveCount(3);
  await demos.selectOption('0');
  await expect(page.locator('.file-name')).toHaveText('O0001');
  await expect(page.locator('.metrics')).toContainText('X 20');
  await demos.selectOption('1');
  await expect(page.locator('.file-name')).toHaveText('sample.nc');
  await expect(page.locator('.metrics')).toContainText('X 10');
  expect(outgoing).toEqual([]);
 } finally { await rm(directory,{recursive:true,force:true}); }
});

test('shows the unknown home movement and resumes from known coordinates',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'sample.nc',mimeType:'text/plain',buffer:Buffer.from('O0001\nG54\nG21 G90 G0 X0 Y0 Z1\nG1 X2\nG91 G28 Z0\nG90 G0 X5 Y0 Z10\nG1 X6')});
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('행 5');
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('원점 복귀');
 await expect(page.locator('.counter')).toHaveText('1 / 2');
});

test('shows the selected warning even when the diagnostics list is truncated',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 const code=['G54',...Array(110).fill('M200'),'G90 G0 X0 Y0 Z0','G1 X1'].join('\n');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'many-warnings.nc',mimeType:'text/plain',buffer:Buffer.from(code)});
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('앞 99개와 마지막 항목');
 await page.getByLabel('행으로 이동').fill('105');
 await page.getByRole('button',{name:'이동',exact:true}).click();
 await expect(page.getByRole('region',{name:'선택 행 진단'})).toContainText('선택한 105행');
 await expect(page.getByRole('region',{name:'선택 행 진단'})).toContainText('M200');
 await page.getByLabel('행으로 이동').fill('113');
 await page.getByRole('button',{name:'이동',exact:true}).click();
 await expect(page.getByRole('region',{name:'선택 행 진단'})).toHaveCount(0);
});

test('marks unverified operations and separates raw work-coordinate views',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'sample.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nM200\nG05 P10000\nG90 G0 X0 Y0\nG43 Z5 H1\nG1 Z-1\nG1 X2\nG55\nG0 X10 Y0 Z5\nG1 X11')});
 await expect(page.locator('.status')).toContainText('PARTIAL');
 await expect(page.locator('.counter')).toHaveText('1 / 3');
 await expect(page.getByText('원본 지령 좌표 미리보기이며 실제 공구 이동과 다를 수 있습니다.',{exact:false})).toBeVisible();
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('M200');
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('G5');
 await expect(page.locator('.code-line').filter({hasText:'M200'})).toContainText('?');
 await page.getByRole('button',{name:'다음 ? 행'}).click();
 await expect(page.locator('.code-line.selected')).toContainText('G55');
 await expect(page.getByText('원본 단위 미확인').first()).toBeVisible();
 const frames=page.getByLabel('표시할 좌표계·회전 구간');
 await expect(frames.locator('option')).toHaveCount(2);
 await frames.selectOption('55:0');
 await expect(page.locator('.metrics')).toContainText('X 11');
});

test('identifies the rotary command for the selected group without claiming an actual position',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'rotary.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG90 G0 X0 Y0 Z0\nG1 X1\nG0 X2 Y0 B20 C30\nG0 Z1\nG1 X3')});
 const frames=page.getByLabel('표시할 좌표계·회전 구간');
 await frames.selectOption('54:1');
 await expect(page.getByText('이 구간의 회전축 지령:',{exact:false})).toContainText('B20° · C30°');
 await expect(page.getByText('이 구간의 회전축 지령:',{exact:false})).toContainText('실제 회전 위치는 미확인');
 await frames.selectOption('54:0');
 await expect(page.getByText('이 구간의 회전축 지령:',{exact:false})).toHaveCount(0);
});

test('separates rotary groups when no work coordinate system was specified',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'rotary-no-frame.nc',mimeType:'text/plain',buffer:Buffer.from('G90 G0 X0 Y0 Z0\nG1 X1\nG0 B20\nG0 X2 Y0 Z0\nG1 X3')});
 const frames=page.getByLabel('표시할 좌표계·회전 구간');
 await expect(frames.locator('option')).toHaveCount(2);
 await expect(frames.locator('option').first()).toContainText('작업 좌표계 미확인');
 await frames.selectOption('?:1');
 await expect(page.getByText('이 구간의 회전축 지령:',{exact:false})).toContainText('B20°');
 await expect(page.locator('.metrics')).toContainText('X 3');
});

test('resumes after an incremental rotary feed without connecting the unknown motion',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'incremental-rotary.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG90 G0 X0 Y0 Z0\nG1 X1\nG91 G1 B15 X2 F50\nG1 X1\nG90 G0 X10 Y20 Z30\nG1 X11')});
 await expect(page.locator('.counter').first()).toHaveText('1 / 2');
 await page.getByLabel('표시할 좌표계·회전 구간').selectOption('54:1');
 await expect(page.getByText('이 구간의 회전축 지령:',{exact:false})).toContainText('증분 지령');
 await expect(page.locator('.metrics')).toContainText('X 11');
 await page.getByLabel('행으로 이동').fill('4');
 await page.getByRole('button',{name:'이동',exact:true}).click();
 await expect(page.getByRole('region',{name:'선택 행 진단'})).toContainText('실제 회전 이동은 표시하지 않습니다');
});

test('detects a FANUC-style file and reparses it when the profile changes',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'sample.nc',mimeType:'text/plain',buffer:Buffer.from('%\nG54\n(Postprocessor : Fanuc-M08M200)\nG90 G0 X0 Y0\nG43 Z5 H1\nG1 X2')});
 await expect(page.getByLabel('컨트롤러 프로파일')).toHaveValue('fanuc');
 await expect(page.getByText('파일 형식에 따라 FANUC 좌표 미리보기를 자동 선택했습니다.',{exact:false})).toBeVisible();
 await expect(page.locator('.counter')).toHaveText('1 / 1');
 await page.getByLabel('컨트롤러 프로파일').selectOption('generic');
 await expect(page.locator('.status')).toContainText('UNSUPPORTED');
 await expect(page.locator('.counter')).toHaveText('0 / 0');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await expect(page.locator('.counter')).toHaveText('1 / 1');
});

test('identifies a drilling depth range as incomplete rather than a complete cycle',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'drill.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG90 G17 G0 X1 Y2 Z5\nG94 G83 G98 Z-4 R1 Q2\nG80')});
 await expect(page.locator('.counter')).toHaveText('1 / 1');
 await expect(page.locator('.metrics')).toContainText('G83 깊이 범위 (왕복 생략)');
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('반복 이송·후퇴');
});

test('reinterprets a tilted program in the optional Euler preview',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'tilt.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG68.2 X10 Y20 Z30 I90 J90 K0\nG53.1\nG90 G17 G0 X0 Y0 Z0\nG1 X1')});
 await expect(page.locator('.counter')).toHaveText('1 / 1');
 await expect(page.locator('.metrics')).toContainText('X 1');
 await page.getByLabel('G68.2 FANUC 오일러 좌표 미리보기 (실제 기계 회전 아님)').check();
 await expect(page.locator('.metrics')).toContainText('X 10');
 await expect(page.locator('.metrics')).toContainText('21');
 await expect(page.locator('.uncertain-summary')).toContainText('오일러 좌표 변환 미리보기가 켜져 있습니다.');
});

test('overlays only Euler-transformed groups from the selected work frame',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 const code='G54\nG90 G17 G0 X0 Y0 Z0\nG1 X1\nG68.2 X0 Y0 Z0 I90 J90 K0\nG53.1\nG0 X0 Y0 Z0\nG1 X1\nG69\nG68.2 X0 Y0 Z0 I0 J90 K0\nG53.1\nG0 X0 Y0 Z0\nG1 X1\nG69\nG55\nG68.2 X0 Y0 Z0 I0 J90 K0\nG53.1\nG0 X0 Y0 Z0\nG1 X1';
 await page.locator('.topbar input[type=file]').setInputFiles({name:'frames.nc',mimeType:'text/plain',buffer:Buffer.from(code)});
 await expect(page.locator('.counter')).toHaveText('1 / 4');
 await page.getByLabel('G68.2 FANUC 오일러 좌표 미리보기 (실제 기계 회전 아님)').check();
 const overlay=page.getByLabel('같은 작업 좌표계의 변환된 회전 구간 함께 보기');
 await overlay.check();
 await expect(page.getByText('2개 이동 블록',{exact:true})).toBeVisible();
 await expect(page.locator('.uncertain-summary')).toContainText('미확인 이동은 연결하지 않습니다');
 await page.getByLabel('표시할 좌표계·회전 구간').selectOption({label:'G55 · 회전 구간 8'});
 await expect(page.getByText('1개 이동 블록',{exact:true})).toBeVisible();
});

test('shows Q tapping passes and final return while noting omitted intermediate retractions',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'tap.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG94 G84 Z-4 R1 Q2 F40\nG80')});
 await expect(page.locator('.counter')).toHaveText('1 / 5');
 await expect(page.locator('.metrics')).toContainText('R면 접근 (미리보기)');
 await page.getByRole('button',{name:'다음 블록'}).click();
 await expect(page.locator('.metrics')).toContainText('1/3 절입 (중간 후퇴 생략)');
 await page.getByRole('button',{name:'다음 블록'}).click();
 await expect(page.locator('.metrics')).toContainText('2/3 절입');
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('중간 후퇴·재진입');
});

test('shows G98 return to the known initial level after tapping',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'tap-g98.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG94 G84 G98 Z-4 R1 Q2 F40\nG80')});
 await expect(page.locator('.counter')).toHaveText('1 / 6');
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'다음 블록'}).click();
 await expect(page.locator('.metrics')).toContainText('G98 시작 높이 복귀');
 await expect(page.locator('.metrics')).toContainText('Z 5');
});

test('shows G98 return when its modal command precedes G84',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'tap-modal-g98.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG98\nG84 Z-4 R1\nG80')});
 await expect(page.locator('.counter').first()).toHaveText('1 / 4');
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'다음 블록'}).click();
 await expect(page.locator('.metrics')).toContainText('G98 시작 높이 복귀');
 await expect(page.locator('.metrics')).toContainText('Z 5');
});

test('shows tapping when the G84 selection and hole coordinates are on separate lines',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'tap-split.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG94 G98 G84 F40\nF50\nZ-4 R1 Q2\nG80')});
 await expect(page.locator('.counter').first()).toHaveText('1 / 6');
 await expect(page.locator('.metrics')).toContainText('R면 접근');
 await expect(page.locator('.metrics')).toContainText('행 6');
 await page.getByRole('button',{name:'다음 블록'}).click();
 await expect(page.locator('.metrics')).toContainText('1/3 절입');
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('중간 후퇴·재진입');
});

test('resumes after a canned cycle is cancelled by a normal motion command',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'tap-cancel-motion.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG90 G17 G0 X1 Y2 Z5\nG84 Z-4 R1\nG90 G0 X10 Y20 Z30\nG1 X11')});
 await expect(page.locator('.counter').first()).toHaveText('1 / 4');
 await page.getByLabel('행으로 이동').fill('5');
 await page.getByRole('button',{name:'이동',exact:true}).click();
 await expect(page.locator('.metrics')).toContainText('X 11');
 await page.getByLabel('행으로 이동').fill('4');
 await page.getByRole('button',{name:'이동',exact:true}).click();
 await expect(page.getByRole('region',{name:'선택 행 진단'})).toContainText('해당 이동은 연결하지 않습니다');
});

test('does not reuse a cancelled pending tapping position',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'cancelled-tap.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG90 G17 G0 X1 Y2 Z5\nM29 S100\nG94 G84 F40\nG80\nG84 Z-4 R1 F40')});
 await expect(page.locator('.counter').first()).toHaveText('0 / 0');
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('위치 또는 지령을 확인할 수 없어');
});

test('shows the nearest preceding tool comment without treating it as compensation',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'comments.nc',mimeType:'text/plain',buffer:Buffer.from('(TN:TOOL-A TD:4 TR:0)\nG90 G0 X0 Y0 Z0\nG1 X1\n(TN:TOOL-B TD:2 TR:0)\nG1 X2')});
 const comment=page.getByText('선택 행 앞의 마지막 공구 관련 주석',{exact:false});
 await expect(comment).toContainText('1행: (TN:TOOL-A TD:4 TR:0)');
 await expect(comment).toContainText('실제 장비의 공구표·보정값은 아닙니다');
 await page.getByRole('button',{name:'다음 블록'}).click();
 await expect(comment).toContainText('4행: (TN:TOOL-B TD:2 TR:0)');
});

test('opens a single file using the NC file button',async({page})=>{
 await page.goto('/nc_tracer/');
 const fileChooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'NC 파일 열기'}).click();
 const chooser=await fileChooser;
 expect(chooser.isMultiple()).toBe(false);
 await chooser.setFiles({name:'one.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G00 X0 Y0 Z0\nG01 X7\nM30')});
 await expect(page.locator('.file-name')).toHaveText('one.nc');
 await expect(page.locator('.metrics')).toContainText('X 7');
});

test('opens the folder picker from the NC folder button',async({page})=>{
 await page.goto('/nc_tracer/');
 const fileChooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'NC 폴더 열기'}).click();
 const chooser=await fileChooser;
 expect(await chooser.element().getAttribute('webkitdirectory')).not.toBeNull();
 await expect(page.getByLabel('폴더의 파일')).toBeDisabled();
});
