import { expect, test } from '@playwright/test';

test('home and performance pages expose TWR states', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('main').getByRole('heading', { name: '投资仪表盘' })).toBeVisible();
  await expect(page.getByText('累计TWR')).toBeVisible();

  await page.goto('./#/performance');
  await expect(page.getByRole('heading', { name: '收益追踪' })).toBeVisible();
  await expect(page.getByText('累计 TWR')).toBeVisible();
  await expect(page.getByRole('heading', { name: '时间加权收益率（TWR）' })).toBeVisible();
});

test('settings exposes historical TWR backfill action', async ({ page }) => {
  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重算历史TWR' })).toBeVisible();
});
