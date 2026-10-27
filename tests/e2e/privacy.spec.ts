import { test, expect } from '@playwright/test';

test('file and paste stay in memory during load, playback and replacement', async ({page}) => {
 await page.goto('/nc_tracer/');
 const requests: {url:string;method:string;body:string}[]=[];
 page.on('request', request => requests.push({url:request.url(),method:request.method(),body:request.postData() ?? ''}));
 const input=page.locator('input[type=file]');
 await input.setInputFiles({name:'private-check.nc',mimeType:'text/plain',buffer:Buffer.from('(private-marker-42)\nG21 G90 G00 X0 Y0 Z0\nG01 X123.456\nM30')});
 await expect(page.locator('.metrics')).toContainText('X 123.456');
 await page.getByRole('button',{name:'재생',exact:true}).click();
 await page.getByText('텍스트 붙여넣기 / 초기 설정').click();
 await page.getByLabel('NC 텍스트').fill('G21 G90 G00 X0 Y0 Z0\nG01 X15\nM30');
 await page.getByRole('button',{name:'텍스트 해석'}).click();
 await expect(page.locator('.metrics')).toContainText('X 15');
 expect(requests.filter(r=>r.method!=='GET' || /private-marker-42|private-check|123\.456/.test(r.url+r.body))).toEqual([]);
 const storage=await page.evaluate(async()=>({local:{...localStorage},session:{...sessionStorage},databases:await indexedDB.databases(),caches:await caches.keys()}));
 expect(JSON.stringify(storage)).not.toMatch(/private-marker-42|private-check|123\.456/);
 expect(storage.databases).toEqual([]);
 expect(storage.caches).toEqual([]);
});

test('rejects malformed UTF-8 and supports keyboard controls on mobile', async ({page}) => {
 await page.setViewportSize({width:390,height:844});
 await page.goto('/nc_tracer/');
 await page.locator('input[type=file]').setInputFiles({name:'bad.nc',mimeType:'text/plain',buffer:Buffer.from([0xc3,0x28])});
 await expect(page.getByText(/UTF-8로 읽을 수 없습니다/)).toBeVisible();
 await page.getByRole('button',{name:'예제 불러오기'}).focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('.metrics')).toContainText('행 4');
 await page.getByRole('button',{name:'다음 블록'}).focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('.metrics')).toContainText('행 5');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('replacing a large file while it is being parsed keeps only the newest data', async ({page}) => {
 await page.goto('/nc_tracer/');
 const input=page.locator('input[type=file]');
 const huge='G21 G90 G00 X0 Y0 Z0\n'+Array.from({length:100000},(_,i)=>`G01 X${i%2+1}`).join('\n');
 await input.setInputFiles({name:'old.nc',mimeType:'text/plain',buffer:Buffer.from(huge)});
 await input.setInputFiles({name:'new.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G00 X0 Y0 Z0\nG01 X42\nM30')});
 await expect(page.locator('.metrics')).toContainText('X 42');
 await expect(page.locator('.file-name')).toHaveText('new.nc');
 await expect(page.locator('.code-list')).not.toContainText('X2');
 await page.waitForTimeout(300);
 await expect(page.locator('.metrics')).toContainText('X 42');
});
