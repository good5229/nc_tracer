import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';
test('shows an explicitly approximate revolved stock after the supported sample',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByRole('button',{name:'선반 보정 예제 열기'}).click();
 await expect(page.locator('.status')).toHaveText('SUPPORTED');const region=page.getByRole('region',{name:'선반 예제 소재 형상'});
 await region.getByRole('button',{name:'선반 소재 형상 계산'}).click();await expect(region.getByRole('status')).toContainText('예상 형상 · 제거된 단면 격자');await expect(region.getByLabel('선반 예제 소재 3D 표시')).toBeVisible();
 await page.getByLabel('LinuxCNC 데모').selectOption('lathe-g76.ngc');await page.getByLabel('선반 예제 공구표 사용').check();await page.getByRole('button',{name:'예제 공구표로 다시 해석'}).click();await expect(page.locator('.status')).toHaveText('PARTIAL');
 await region.getByRole('button',{name:'선반 소재 형상 계산'}).click();await expect(region.getByRole('status')).toContainText('완성 형상 계산을 중단');await expect(region.getByLabel('선반 예제 소재 3D 표시')).toHaveCount(0);
 await region.getByRole('button',{name:'중단 전 형상 계산'}).click();await expect(region.getByRole('status')).toContainText('중단 전 예상 형상 (완성 형상 아님)');await expect(region.getByLabel('선반 예제 소재 3D 표시')).toBeVisible();
});
test('renders stock removal for a supported G70 cycle with the example tool table',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');
 await page.getByLabel('선반 예제 공구표 사용').check();
 const source=`T1 M6\n${readFileSync('tests/fixtures/g70_single.ngc','utf8')}`;
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-tool.ngc',mimeType:'text/plain',buffer:Buffer.from(source)});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');
 const region=page.getByRole('region',{name:'선반 예제 소재 형상'});
 await region.getByRole('button',{name:'선반 소재 형상 계산'}).click();
 await expect(region.getByRole('status')).toContainText('예상 형상 · 제거된 단면 격자');
 await expect(region.getByLabel('선반 예제 소재 3D 표시')).toBeVisible();
});
test('renders stock removal for a compensated single-pass G70',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');
 await page.getByLabel('선반 예제 공구표 사용').check();
 const source=readFileSync('tests/fixtures/g70_comp_straight.ngc','utf8').replace('G1 X8 Z-5','G1 X11 Z-5');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-comp.ngc',mimeType:'text/plain',buffer:Buffer.from(source)});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');
 const region=page.getByRole('region',{name:'선반 예제 소재 형상'});
 await region.getByRole('button',{name:'선반 소재 형상 계산'}).click();
 await expect(region.getByRole('status')).toContainText('예상 형상 · 제거된 단면 격자');
 await expect(region.getByLabel('선반 예제 소재 3D 표시')).toBeVisible();
});
test('stops example-stock calculation at a compensated G70 rapid collision',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');
 await page.getByLabel('선반 예제 공구표 사용').check();
 await page.locator('.topbar input[type=file]').setInputFiles({name:'g70-comp-multi.ngc',mimeType:'text/plain',buffer:readFileSync('tests/fixtures/g70_comp_multi.ngc')});
 await expect(page.locator('.status')).toHaveText('SUPPORTED');
 const region=page.getByRole('region',{name:'선반 예제 소재 형상'});
 await region.getByRole('button',{name:'선반 소재 형상 계산'}).click();
 await expect(region.getByRole('status')).toContainText('급속 이동 중');
 await expect(region.getByLabel('선반 예제 소재 3D 표시')).toHaveCount(0);
});
test('switches between the round nose and the example insert section',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByLabel('선반 예제 공구표 사용').check();
 const source='G21 G90 G18 G8\nT1 M6\nG0 X12 Z0\nG0 Z-3\nG1 X8 F100\nG0 X12\nM2';
 await page.locator('.topbar input[type=file]').setInputFiles({name:'insert.ngc',mimeType:'text/plain',buffer:Buffer.from(source)});await expect(page.locator('.status')).toHaveText('SUPPORTED');
 const region=page.getByRole('region',{name:'선반 예제 소재 형상'});await region.getByRole('button',{name:'선반 소재 형상 계산'}).click();
 await expect(region.getByRole('status')).toContainText('예상 형상');const round=await region.getByRole('status').textContent();
 await region.getByLabel('예제 공구 형상').selectOption('example-insert');await expect(region.getByRole('status')).toContainText('예상 형상');
 await expect(region.getByRole('status')).not.toHaveText(round!);await expect(region.getByLabel('선반 예제 소재 3D 표시')).toBeVisible();
});
test('renders an angular 3D stock for an example G76 thread',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByRole('button',{name:'선반 나사 예제 열기'}).click();
 await expect(page.locator('.file-name')).toHaveText('선반 나사 예제');await expect(page.locator('.status')).toHaveText('SUPPORTED');
 const region=page.getByRole('region',{name:'선반 예제 소재 형상'});await region.getByRole('button',{name:'선반 소재 형상 계산'}).click();
 await expect(region.getByRole('status')).toContainText('제거된 3D 격자');await expect(region.getByLabel('선반 예제 소재 3D 표시')).toBeVisible();
});
test('selects visibly labelled stock assumptions for the original demos',async({page})=>{
 await page.goto('/');await page.getByLabel('LinuxCNC 데모').selectOption('lathe-g76.ngc');
 let region=page.getByRole('region',{name:'선반 예제 소재 형상'});await expect(region.getByLabel('예제 소재')).toHaveValue('thread-demo');await expect(region).toContainText('반경 3.175mm');
 await page.getByLabel('LinuxCNC 데모').selectOption('lathe_g70_71_demo.ngc');region=page.getByRole('region',{name:'선반 예제 소재 형상'});await expect(region.getByLabel('예제 소재')).toHaveValue('pawn-demo');await expect(region).toContainText('반경 15mm');
});
test('shows the original pawn reference until its first example-stock collision',async({page})=>{
 await page.goto('/');await page.getByLabel('LinuxCNC 데모').selectOption('lathe_g70_71_demo.ngc');
 await page.getByLabel('선반 예제 공구표 사용').check();await page.getByRole('button',{name:'예제 공구표로 다시 해석'}).click();
 await expect(page.locator('.status')).toHaveText('PARTIAL');await expect(page.locator('.profile-info')).toContainText('내부 윤곽 재현');
 await expect(page.getByRole('region',{name:'해석 진단'})).toContainText('파고들어');
 const region=page.getByRole('region',{name:'선반 예제 소재 형상'});await region.getByRole('button',{name:'중단 전 형상 계산'}).click();
 await expect(region.getByRole('status')).toContainText('중단 전 예상 형상 (완성 형상 아님)');await expect(region.getByRole('status')).toContainText('급속 이동');
 await expect(region.getByLabel('선반 예제 소재 3D 표시')).toBeVisible();
});
test('shows the complete original G76 path with an explicitly different physical tool assumption',async({page})=>{
 await page.goto('/');await page.getByLabel('LinuxCNC 데모').selectOption('lathe-g76.ngc');
 await expect(page.locator('.status')).toHaveText('SUPPORTED');const region=page.getByRole('region',{name:'선반 예제 소재 형상'});
 await expect(region).toContainText('공구표와 물리 공구가 다르므로');await expect(region).toContainText('폭 1mm·길이 2mm');
 await region.getByRole('button',{name:'점 공구 경로의 가상 형상 계산'}).click();
 await expect(region.getByRole('status')).toContainText('공구표 반경 0 경로의 가상 예상 형상 (안전 미검증)');
 await expect(region).toContainText('격자 기준으로 소재가 2개로 분리');await expect(region).toContainText('어느 쪽이 제품인지는 고정 방식에 따라 결정됩니다');
 await expect(region.getByLabel('선반 예제 소재 3D 표시')).toBeVisible();
 const canvas=region.getByLabel('선반 예제 소재 3D 표시').locator('canvas'),both=await canvas.screenshot(),previous=await canvas.elementHandle();
 await region.getByLabel('표시할 소재').selectOption('2');await previous!.waitForElementState('hidden');
 const selected=await canvas.screenshot();expect(selected.equals(both)).toBe(false);
 await region.getByLabel('표시할 소재').selectOption('0');await expect(region.getByLabel('표시할 소재')).toHaveValue('0');
});
