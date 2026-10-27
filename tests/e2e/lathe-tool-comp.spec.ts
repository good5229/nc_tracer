import {expect,test} from '@playwright/test';
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
