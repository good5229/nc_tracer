import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';
test('example lathe tool table displays compensated paths and detects the real demo entry issue',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');
 await page.getByRole('button',{name:'선반 보정 예제 열기'}).click();
 await expect(page.locator('.status')).toHaveText('SUPPORTED');
 await expect(page.locator('.profile-info')).toContainText('선반 예제 공구표');
 await expect(page.locator('.counter')).toContainText('/ 7');
 await page.getByLabel('LinuxCNC 데모').selectOption('lathe-g76.ngc');
 await page.getByLabel('선반 예제 공구표 사용').check();
 await page.getByRole('button',{name:'예제 공구표로 다시 해석'}).click();
 await expect(page.locator('.status')).toHaveText('PARTIAL');
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('진입 이동');
});

test('shows a compensated multipass cycle ending with M2',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-m2.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_multi_end_m2.ngc')});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');await expect(page.getByRole('region',{name:'해석 진단'})).toHaveCount(0);
 await expect(page.locator('.counter')).not.toContainText('/ 0');
});
test('shows multipass G70 following a prior compensated move',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-prior.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_pre_move.ngc')});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');await expect(page.locator('.counter')).toContainText('/ 11');
 await expect(page.getByRole('region',{name:'해석 진단'})).toHaveCount(0);
});
test('stops a prior-compensation G70 that LinuxCNC reports as gouging',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-gouging.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_pre_right_x11.ngc')});
 await expect(page.locator('.status')).toHaveText('PARTIAL');await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('파고들어');
 await expect(page.locator('.counter')).toContainText('/ 2');
});
test('explains the unsupported queued arc while keeping its verified prefix',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-prior-arc.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_pre_arc_left_cw.ngc')});
 await expect(page.locator('.status')).toHaveText('PARTIAL');await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('직전 보정 원호');await expect(page.locator('.counter')).toContainText('/ 3');
});
test('explains the invalid compensated arc reported by LinuxCNC',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-invalid-arc.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_arc_anchor_left_ccw.ngc')});
 await expect(page.locator('.status')).toHaveText('PARTIAL');await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('원호의 반지름이 맞지 않아');
});
test('renders G70 with a supported queued compensated arc',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-arc-anchor.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_arc_anchor_left_cw.ngc')});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');await expect(page.locator('.counter')).toContainText('/ 15');await expect(page.getByRole('region',{name:'해석 진단'})).toHaveCount(0);
});
test('renders a queued compensated arc after repositioning to another point on it',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-arc-top.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_arc_on_top.ngc')});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');await expect(page.locator('.counter')).toContainText('/ 16');await expect(page.getByRole('region',{name:'해석 진단'})).toHaveCount(0);
});
test('renders compensated low-anchor G70 with allowance after a prior move',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-lowallow.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_lowallow_right_prior.ngc')});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');await expect(page.locator('.counter')).toContainText('/ 12');await expect(page.getByRole('region',{name:'해석 진단'})).toHaveCount(0);
});
test('renders a verified full queued arc after two G70 start rapids',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-low-arc.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_arc_low_other.ngc')});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');await expect(page.locator('.counter')).toContainText('/ 17');await expect(page.getByRole('region',{name:'해석 진단'})).toHaveCount(0);
});
test('applies entered tool offsets to the displayed physical path',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.getByText('선반 공구표 편집').click();await page.getByLabel('T1 X 오프셋').fill('2');await page.getByLabel('T1 Z 오프셋').fill('3');
 await page.getByText('텍스트 붙여넣기 / 초기 설정').click();await page.getByLabel('시작 좌표 직접 지정 (mm)').check();await page.getByLabel('시작 X').fill('20');await page.getByLabel('시작 Z').fill('10');
 const source='G18 G8 G21 G90\nT1 M6\nG0 X10 Z10\nG43\nG1 X5 F100\nG91 G1 Z-2\nG90\nG49\nG1 Z0\nM2';
 await page.locator('.topbar input[type=file]').setInputFiles({name:'tool-offset.ngc',mimeType:'text/plain',buffer:Buffer.from(source)});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');await expect(page.locator('.metrics')).toContainText('18, 0, 7');await page.getByRole('button',{name:/G1 X5 F100/}).click();await expect(page.locator('.metrics')).toContainText('X 5');await expect(page.locator('.metrics')).toContainText('Z 7');
 await page.getByRole('button',{name:/G1 Z0/}).click();await expect(page.locator('.metrics')).toContainText('Z -3');
 await page.getByLabel('추가 공구 번호').fill('11');await page.getByRole('button',{name:'공구 추가'}).click();await expect(page.getByLabel('T11 지름')).toHaveValue('0.4');await page.getByRole('button',{name:'T11 삭제'}).click();await expect(page.getByLabel('T11 지름')).toHaveCount(0);
});
