import { test, expect } from '@playwright/test';

test('example, code selection and playback stay aligned', async ({page}) => {
 await page.goto('/nc_tracer/');
 await expect(page.getByText('NC TOOLPATH', {exact:true})).toBeVisible();
 await page.getByRole('button', {name:'예제 불러오기'}).click();
 await expect(page.getByRole('button', {name:/G01 X40 Y0/})).toBeVisible();
 await page.getByRole('button', {name:/G01 X40 Y0/}).click();
 await expect(page.locator('.metrics')).toContainText('X 40');
 await expect(page.locator('.metrics')).toContainText('행 5');
 await page.getByRole('button', {name:'다음 블록'}).click();
 await expect(page.locator('.metrics')).toContainText('행 6');
});

test('file replacement and local processing', async ({page}) => {
 const outgoing:string[]=[];
 page.on('request', request => { if (request.method() !== 'GET') outgoing.push(request.url()); });
 await page.goto('/nc_tracer/');
 const file=page.locator('input[type=file]');
 await file.setInputFiles({name:'first.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G00 X0 Y0 Z0\nG01 X10\nM30')});
 await expect(page.locator('.metrics')).toContainText('X 10');
 await file.setInputFiles({name:'second.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G00 X0 Y0 Z0\nG01 X20\nM30')});
 await expect(page.locator('.metrics')).toContainText('X 20');
 await expect(page.locator('.code-list')).not.toContainText('X10');
 expect(outgoing).toEqual([]);
});

test('diagnostics and line jump show the source even without a segment', async ({page}) => {
 await page.goto('/nc_tracer/');
 const file=page.locator('input[type=file]');
 await file.setInputFiles({name:'unsupported.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G00 X0 Y0 Z0\nG01 X10\nG54\nG01 X20')});
 await expect(page.getByRole('region', {name:'해석 진단'})).toContainText('행 3');
 await page.getByRole('button',{name:/행 3/}).click();
 await expect(page.locator('.code-line.selected')).toContainText('G54');
 await page.getByLabel('행으로 이동').fill('4');
 await page.getByRole('button',{name:'이동',exact:true}).click();
 await expect(page.locator('.code-line.selected')).toContainText('G01 X20');
});
