import {expect,test} from '@playwright/test';

test('stores only on request, reopens after reload, limits to three, and deletes',async({page})=>{
 const outgoing:string[]=[];
 page.on('request',request=>{if(request.method()!=='GET')outgoing.push(request.url());});
 await page.goto('/nc_tracer/');
 const input=page.locator('.topbar input[type=file]'),panel=page.locator('.saved-files');
 const choose=async(name:string,x:number)=>{await input.setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(`(private-marker)\nG21 G90 G00 X0 Y0 Z0\nG01 X${x}\nM30`)});await expect(page.locator('.metrics')).toContainText(`X ${x}`);};
 await choose('one.nc',11);
 expect(await page.evaluate(async()=>await indexedDB.databases())).toEqual([]);
 await panel.locator('summary').click();
 for(const [name,x] of [['one.nc',11],['two.nc',22],['three.nc',33]] as const){
  if(name!=='one.nc')await choose(name,x);
  await panel.getByRole('button',{name:'현재 NC 파일 저장'}).click();
  await expect(panel.getByRole('status')).toContainText('저장했습니다');
 }
 await expect(panel.locator('li')).toHaveCount(3);
 await expect(panel.getByRole('button',{name:'현재 NC 파일 저장'})).toBeDisabled();
 await page.reload();await panel.locator('summary').click();
 await expect(panel.locator('li')).toHaveCount(3);
 await panel.getByRole('button',{name:'one.nc 열기'}).click();
 await expect(page.locator('.file-name')).toHaveText('one.nc');await expect(page.locator('.metrics')).toContainText('X 11');
 await panel.getByRole('button',{name:'two.nc 삭제'}).click();await expect(panel.locator('li')).toHaveCount(2);
 await page.reload();await panel.locator('summary').click();await expect(panel.locator('li')).toHaveCount(2);await expect(panel).not.toContainText('two.nc');
 expect(outgoing).toEqual([]);
});

test('does not save a previous file when a built-in demo replaces it',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'old.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G0 X0 Y0 Z0\nG1 X1')});
 await expect(page.locator('.file-name')).toHaveText('old.nc');
 await page.getByLabel('LinuxCNC 데모').selectOption('lathe-g76.ngc');
 await page.locator('.saved-files summary').click();
 await expect(page.getByRole('button',{name:'현재 NC 파일 저장'})).toBeDisabled();
});

test('enforces the three-file limit across two tabs',async({context,page})=>{
 await page.goto('/nc_tracer/');const panel=page.locator('.saved-files');await panel.locator('summary').click();
 const choose=async(p:typeof page,name:string)=>{await p.locator('.topbar input[type=file]').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from('G21 G90 G0 X0 Y0 Z0\nG1 X2')});await expect(p.locator('.file-name')).toHaveText(name);};
 for(const name of ['one.nc','two.nc']){await choose(page,name);await panel.getByRole('button',{name:'현재 NC 파일 저장'}).click();await expect(panel.getByRole('status')).toContainText('저장했습니다');}
 const second=await context.newPage();await second.goto('/nc_tracer/');const other=second.locator('.saved-files');await other.locator('summary').click();await expect(other.locator('li')).toHaveCount(2);
 await choose(page,'three.nc');await choose(second,'four.nc');
 await Promise.all([panel.getByRole('button',{name:'현재 NC 파일 저장'}).click(),other.getByRole('button',{name:'현재 NC 파일 저장'}).click()]);
 await expect(panel.locator('li')).toHaveCount(3);await expect(other.locator('li')).toHaveCount(3);
 const status=(await panel.getByRole('status').textContent())+' '+(await other.getByRole('status').textContent());
 expect(status).toContain('최대 3개');
 await second.close();
});
