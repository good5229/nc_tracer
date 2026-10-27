import { chromium } from '@playwright/test';

const url = process.env.PAGES_URL;
if (!url || !/^https:\/\/good5229\.github\.io\/nc_tracer\/$/.test(url)) throw new Error('Unexpected Pages URL');
for (const channel of ['chrome', 'msedge']) {
 const browser = await chromium.launch({channel,headless:true});
 try {
  const page = await browser.newPage({viewport:{width:1280,height:800}});
  const response = await page.goto(url, {waitUntil:'networkidle'});
  if (!response?.ok()) throw new Error(`${channel}: page load failed`);
  await page.locator('.topbar input[type=file]').setInputFiles({name:'synthetic.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G00 X0 Y0 Z0\nG01 X10\nG01 Y20\nM30')});
  await page.getByRole('button',{name:/G01 X10/}).click();
  await page.waitForFunction(()=>document.querySelector('.metrics')?.textContent?.includes('X 10'),null,{timeout:15000});
  const canvas=page.locator('.viewport canvas');
  if (!(await canvas.isVisible())) throw new Error(`${channel}: no 3D canvas`);
  const first=await canvas.screenshot();
  await page.getByRole('button',{name:'다음 블록'}).click();
  await page.waitForFunction(()=>document.querySelector('.metrics')?.textContent?.includes('Y 20'),null,{timeout:15000});
  const second=await canvas.screenshot();
  if (first.equals(second)) throw new Error(`${channel}: selected path did not change`);
  await page.reload({waitUntil:'networkidle'});
  if (!(await page.getByRole('button',{name:'예제 불러오기'}).isVisible())) throw new Error(`${channel}: reload failed`);
  console.log(`${channel}: public Pages smoke passed`);
 } finally { await browser.close(); }
}
