import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';
test('bounded G70 and G71.2 fixtures load with the explicit point reference',async({page})=>{
 await page.goto('/');
 await page.getByLabel('컨트롤러 프로파일').selectOption('linuxcnc');
 await page.getByLabel('이후 파일에 가상 점 공구 설정 사용').check();
 for(const name of ['g70_single','g71_2_pocket']){
  await page.locator('.topbar input[type=file]').setInputFiles({name:`${name}.ngc`,mimeType:'text/plain',buffer:readFileSync(`tests/fixtures/${name}.ngc`)});
  await expect(page.locator('.file-name')).toHaveText(`${name}.ngc`);
  await expect(page.locator('.status')).toHaveText('SUPPORTED');
  await expect(page.locator('.profile-info')).toContainText('점 공구 참조');
 }
});
