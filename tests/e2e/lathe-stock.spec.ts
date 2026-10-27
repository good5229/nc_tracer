import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';
test('shows an explicitly approximate revolved stock after the supported sample',async({page})=>{
 await page.goto('/');await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');await page.getByRole('button',{name:'선반 보정 예제 열기'}).click();
 await expect(page.locator('.status')).toHaveText('SUPPORTED');const region=page.getByRole('region',{name:'선반 예제 소재 형상'});
 await region.getByRole('button',{name:'선반 소재 형상 계산'}).click();await expect(region.getByRole('status')).toContainText('예상 형상 · 제거된 단면 격자');await expect(region.getByLabel('선반 예제 소재 3D 표시')).toBeVisible();
 await page.getByLabel('LinuxCNC 데모').selectOption('lathe-g76.ngc');await page.getByLabel('선반 예제 공구표 사용').check();await page.getByRole('button',{name:'예제 공구표로 다시 해석'}).click();await expect(page.locator('.status')).toHaveText('PARTIAL');
 await region.getByRole('button',{name:'선반 소재 형상 계산'}).click();await expect(region.getByRole('status')).toContainText('완성 형상 계산을 중단');await expect(region.getByLabel('선반 예제 소재 3D 표시')).toHaveCount(0);
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
