import {test,expect} from '@playwright/test';
test('reference milling shape is restricted to the original demo',async({page})=>{
 await page.goto('/');const region=page.getByRole('region',{name:'LinuxCNC 밀링 참조 형상'});
 await expect(region.getByRole('button',{name:'밀링 참조 형상 계산'})).toBeDisabled();
 await region.getByRole('button',{name:'밀링 데모 선택'}).click();
 await region.getByRole('button',{name:'밀링 참조 형상 계산'}).click();
 await expect(region.getByRole('status')).toContainText('예상 형상 · 제거된 격자');
 await expect(region.getByLabel('밀링 데모 참조 형상 3D 표시')).toBeVisible();
 await page.getByLabel('LinuxCNC 데모').selectOption('lathe-g76.ngc');
 await expect(region.getByRole('button',{name:'밀링 참조 형상 계산'})).toBeDisabled();
 await expect(region.getByLabel('밀링 데모 참조 형상 3D 표시')).toHaveCount(0);
});
