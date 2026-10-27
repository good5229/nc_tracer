import { expect, test } from '@playwright/test';

test('built-in LinuxCNC demos use a visibly labelled point-tool reference', async ({ page }) => {
  await page.goto('/nc_tracer/');
  const demos = page.getByLabel('LinuxCNC 데모');
  for (const [name, status, count] of [
    ['useful-subroutines.ngc', 'SUPPORTED', '1 / 58'],
    ['lathe-g76.ngc', 'SUPPORTED', '1 / 235'],
    ['lathe_g70_71_demo.ngc', 'PARTIAL', '1 / 93'],
  ]) {
    await demos.selectOption(name);
    await expect(page.locator('.file-name')).toHaveText(name);
    await expect(page.locator('.status')).toHaveText(new RegExp(status));
    await expect(page.locator('.counter')).toHaveText(count);
    await expect(page.locator('.profile-info')).toContainText('점 공구 참조');
    await expect(page.getByLabel('이후 파일에 가상 점 공구 설정 사용')).not.toBeChecked();
    if (name==='lathe-g76.ngc') {
      await page.locator('.code-line').filter({hasText:'g76 p.05 z-.5'}).click();
      await expect(page.locator('.metrics')).toContainText('행 102');
      await page.getByRole('button',{name:'다음 블록'}).click();
      await expect(page.locator('.metrics')).toContainText('행 102');
    }
  }
  await expect(page.getByRole('region', { name: '해석 진단' })).toContainText('행 30');
});
