import { expect, test } from '@playwright/test';

test('stock example responds to tool diameter and stops on rapid contact', async ({page}) => {
  await page.goto('/');
  const sample = page.getByRole('region', {name:'절삭 예제'});
  await expect(sample.getByText('목표보다 남은 셀:')).toContainText('0');
  await sample.getByLabel('공구 지름').selectOption('2');
  await expect(sample.getByRole('status')).toContainText('목표보다 남은 셀: 96');
  await sample.getByLabel('첫 급속 이동을 원재료 안으로 설정').check();
  await expect(sample.getByRole('status')).toContainText('접촉 시뮬레이션 중단');
});
