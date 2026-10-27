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
test('renders G70 with a supported queued compensated arc',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-arc-anchor.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_arc_anchor_left_cw.ngc')});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');await expect(page.locator('.counter')).toContainText('/ 15');await expect(page.getByRole('region',{name:'해석 진단'})).toHaveCount(0);
});
