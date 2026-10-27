import { expect, test } from '@playwright/test';

test('built-in LinuxCNC demos load their originals and report unsupported boundaries', async ({ page }) => {
  await page.goto('/nc_tracer/');
  const demos = page.getByLabel('LinuxCNC 데모');
  for (const [name, line] of [
    ['useful-subroutines.ngc', '행 14'],
    ['lathe_g70_71_demo.ngc', '행 1'],
    ['lathe-g76.ngc', '행 8'],
  ]) {
    await demos.selectOption(name);
    await expect(page.locator('.file-name')).toHaveText(name);
    await expect(page.locator('.status')).toHaveText(/UNSUPPORTED/);
    await expect(page.getByRole('region', { name: '해석 진단' })).toContainText(line);
    await expect(page.locator('.counter')).toHaveText('0 / 0');
  }
});
