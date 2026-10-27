import {expect,test} from '@playwright/test';
test('an NC file changes the example stock and unsupported code is refused',async({page})=>{
 await page.goto('/');const section=page.getByRole('region',{name:'NC 형상 예측'});
 await section.getByRole('button',{name:'홈 가공 NC 열기'}).click();
 await section.getByRole('button',{name:'불러온 NC로 형상 계산'}).click();
 await expect(section.getByRole('status')).toContainText('예상 형상 · 제거된 격자');
 await expect(section.getByLabel('NC 가공 후 예제 소재 3D 표시')).toBeVisible();
 await page.locator('input[type=file]').first().setInputFiles({name:'unsupported.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G41\nG1 X1\nM30')});
 await section.getByRole('button',{name:'불러온 NC로 형상 계산'}).click();
 await expect(section.getByRole('status')).toContainText('해석할 수 없어');
 await expect(section.getByLabel('NC 가공 후 예제 소재 3D 표시')).toHaveCount(0);
});
