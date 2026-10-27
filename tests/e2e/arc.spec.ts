import { expect, test } from '@playwright/test';

test('full-circle arc stays one playback block and canvas selection maps to its source row', async ({ page }) => {
  await page.goto('/nc_tracer/');
  await page.locator('.topbar input[type=file]').setInputFiles({
    name: 'synthetic-full-circle.nc',
    mimeType: 'text/plain',
    // The rapid establishes a known point. The full circle is one G02 block, followed by one G01 block.
    buffer: Buffer.from('G21 G90 G17 G00 X10 Y0 Z0\nG02 X10 Y0 I-10 J0\nG01 X20 Y0\nM30'),
  });

  const metrics = page.locator('.metrics');
  const counter = page.locator('.counter');
  const canvas = page.locator('.viewport canvas');
  await expect(canvas).toBeVisible();
  await expect(metrics).toContainText('G02 · 행 2');
  await expect(counter).toHaveText('1 / 2');

  await page.getByRole('button', { name: '전체 맞춤' }).click();
  await expect(page.getByRole('button', { name: 'G02 X10 Y0 I-10 J0' })).toHaveClass(/selected/);

  // Playback counts original motion blocks, not the arc's tessellated chords.
  await page.getByRole('button', { name: '다음 블록' }).click();
  await expect(metrics).toContainText('G01 · 행 3');
  await expect(counter).toHaveText('2 / 2');

  // Selecting a source row moves the active block and changes the rendered canvas highlight.
  await page.getByRole('button', { name: 'G02 X10 Y0 I-10 J0' }).click();
  await expect(metrics).toContainText('G02 · 행 2');
  await expect(counter).toHaveText('1 / 2');
  const arcSelected = await canvas.screenshot();
  await page.getByRole('button', { name: 'G01 X20 Y0' }).click();
  await expect(metrics).toContainText('G01 · 행 3');
  const lineSelected = await canvas.screenshot();
  expect(lineSelected.equals(arcSelected)).toBe(false);

  // Project a known point on the full circle into the fitted canvas, then click the rendered curve.
  // The circle center is (0, 0), radius 10, and the selected point is (0, -10, 0).
  const clickPoint = await page.evaluate(() => {
    const canvasElement = document.querySelector<HTMLCanvasElement>('.viewport canvas');
    if (!canvasElement) throw new Error('3D canvas was not mounted');
    const rect = canvasElement.getBoundingClientRect();
    const span = Math.sqrt(30 * 30 + 20 * 20);
    const cameraOffset = { x: span * 1.2, y: -span * 1.4, z: span * 1.2 };
    const distance = Math.hypot(cameraOffset.x, cameraOffset.y, cameraOffset.z);
    const direction = { x: -cameraOffset.x / distance, y: -cameraOffset.y / distance, z: -cameraOffset.z / distance };
    const rightRaw = { x: direction.y, y: -direction.x, z: 0 };
    const rightLength = Math.hypot(rightRaw.x, rightRaw.y);
    const right = { x: rightRaw.x / rightLength, y: rightRaw.y / rightLength, z: 0 };
    const up = {
      x: right.y * direction.z - right.z * direction.y,
      y: right.z * direction.x - right.x * direction.z,
      z: right.x * direction.y - right.y * direction.x,
    };
    const relative = { x: -5, y: -10, z: 0 }; // Circle point (0, -10, 0) relative to target.
    const cameraX = relative.x * right.x + relative.y * right.y + relative.z * right.z;
    const cameraY = relative.x * up.x + relative.y * up.y + relative.z * up.z;
    const cameraDepth = distance + relative.x * direction.x + relative.y * direction.y + relative.z * direction.z;
    const tanHalfFov = Math.tan(45 * Math.PI / 360);
    const ndcX = cameraX / (cameraDepth * tanHalfFov * (rect.width / rect.height));
    const ndcY = cameraY / (cameraDepth * tanHalfFov);
    return { x: rect.left + (ndcX + 1) * rect.width / 2, y: rect.top + (1 - ndcY) * rect.height / 2 };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect(metrics).toContainText('G02 · 행 2');
  await expect(counter).toHaveText('1 / 2');
  await expect(page.getByRole('button', { name: 'G02 X10 Y0 I-10 J0' })).toHaveClass(/selected/);
});

test('filtered current motion keeps earlier visible progress', async ({page}) => {
 await page.goto('/nc_tracer/');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'progress.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G00 X0 Y0 Z0\nG01 X30\nG00 Y20\nG01 X0\nM30')});
 await expect(page.locator('.counter')).toHaveText('1 / 3');
 await page.getByRole('button',{name:'다음 블록'}).click();
 await expect(page.locator('.counter')).toHaveText('2 / 3');
 await page.getByRole('region',{name:'경로 필터 및 통계'}).getByLabel('G00').uncheck();
 await expect(page.locator('.counter')).toHaveText('2 / 3');
 const canvas=page.locator('.viewport canvas');
 const afterFilter=await canvas.screenshot();
 await page.getByRole('button',{name:'이전 블록'}).click();
 await expect(page.locator('.counter')).toHaveText('1 / 3');
 const beforeProgress=await canvas.screenshot();
 expect(afterFilter.equals(beforeProgress)).toBe(false);
});

test('line width and point density change the canvas', async ({page}) => {
 await page.goto('/nc_tracer/');
 await page.getByRole('button',{name:'예제 불러오기'}).click();
 await expect(page.locator('.counter')).toHaveText('1 / 6');
 const canvas=page.locator('.viewport canvas');
 const thin=await canvas.screenshot();
 await page.getByLabel('선 두께').fill('8');
 await expect(page.getByText('8px',{exact:true})).toBeVisible();
 const thick=await canvas.screenshot();
 expect(thick.equals(thin)).toBe(false);
 await page.getByLabel('점 밀도').fill('5');
 await expect(page.getByText('5%',{exact:true})).toBeVisible();
 const sparse=await canvas.screenshot();
 expect(sparse.equals(thick)).toBe(false);
});

test('large paths finish drawing while playback, camera, filters and file replacement remain usable', async ({page}) => {
 test.setTimeout(60000);
 await page.goto('/nc_tracer/');
 const source='G21 G90 G00 X0 Y0 Z0\n'+Array.from({length:100000},(_,i)=>`G01 X${i+1} Y${i%2}`).join('\n');
 const active=page.locator('.topbar input[type=file]');
 await active.setInputFiles({name:'large.nc',mimeType:'text/plain',buffer:Buffer.from(source)});
 const counter=page.locator('.counter').first();
 await expect(counter).toContainText('/ 100000');
 const drawing=page.getByText('경로를 나누어 그리는 중…',{exact:false});
 await expect(drawing).toBeHidden({timeout:30000});
 await page.getByRole('button',{name:'XZ',exact:true}).click();
 await expect(drawing).toBeHidden({timeout:30000});
 await page.getByLabel('재생 속도').selectOption('10');
 await page.getByRole('button',{name:'재생',exact:true}).click();
 await expect(counter).not.toHaveText('1 / 100000',{timeout:15000});
 await page.getByRole('button',{name:'일시정지'}).click();
 await expect(drawing).toBeHidden({timeout:30000});
 await page.getByRole('region',{name:'경로 필터 및 통계'}).getByLabel('G01').uncheck();
 await active.setInputFiles({name:'replacement.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G00 X0 Y0 Z0\nG01 X12\nM30')});
 await expect(page.locator('.metrics')).toContainText('X 12');
 await expect(page.locator('.file-name')).toHaveText('replacement.nc');
 await expect(drawing).toBeHidden({timeout:10000});
});

test('viewer visibility choices survive path filter rebuilds', async ({page}) => {
 await page.goto('/nc_tracer/');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'visibility.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G00 X0 Y0 Z0\nG00 X30\nG01 Y20\nM30')});
 await expect(page.locator('.counter')).toHaveText('1 / 2');
 const rapid=page.getByLabel('G00 급속',{exact:true});
 await rapid.uncheck();
 const canvas=page.locator('.viewport canvas');
 await page.getByRole('region',{name:'경로 필터 및 통계'}).getByLabel('G02').uncheck();
 await expect(rapid).not.toBeChecked();
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const hidden=await canvas.screenshot();
 await rapid.check();
 await expect.poll(async()=> (await canvas.screenshot()).equals(hidden)).toBe(false);
 const visible=await canvas.screenshot();
 await rapid.uncheck();
 await expect.poll(async()=> (await canvas.screenshot()).equals(visible)).toBe(false);
});

test('replacing an interrupted large drawing restores the selection highlight', async ({browser}) => {
 test.setTimeout(60000);
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 const fresh=await browser.newPage({viewport:{width:1280,height:800}});
 try {
  await Promise.all([page.goto('http://127.0.0.1:4174/nc_tracer/'),fresh.goto('http://127.0.0.1:4174/nc_tracer/')]);
  const large='G21 G90 G00 X0 Y0 Z0\n'+Array.from({length:100000},(_,i)=>`G01 X${i+1} Y${i%2}`).join('\n');
  await page.locator('.topbar input[type=file]').setInputFiles({name:'large.nc',mimeType:'text/plain',buffer:Buffer.from(large)});
  await expect(page.getByText('경로를 나누어 그리는 중…',{exact:false})).toBeVisible({timeout:30000});
  const small={name:'small.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G00 X0 Y0 Z0\nG01 X30\nG01 Y20\nM30')};
  await page.locator('.topbar input[type=file]').setInputFiles(small);
  await fresh.locator('.topbar input[type=file]').setInputFiles(small);
  await expect(page.locator('.counter')).toHaveText('1 / 2');
  await expect(fresh.locator('.counter')).toHaveText('1 / 2');
  await page.locator('.viewport canvas').screenshot();
  await fresh.locator('.viewport canvas').screenshot();
  const yellowPixels=async (p:typeof page) => p.locator('.viewport canvas').evaluate((canvas:HTMLCanvasElement) => {
   const gl=canvas.getContext('webgl2') ?? canvas.getContext('webgl'); if(!gl) return 0;
   const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let count=0;
   for(let i=0;i<pixels.length;i+=4) if(pixels[i]>180 && pixels[i+1]>160 && pixels[i+2]<140) count++;
   return count;
  });
  expect(await yellowPixels(page)).toBeGreaterThan(20);
  expect(await yellowPixels(fresh)).toBeGreaterThan(20);
 } finally { await page.close();await fresh.close(); }
});
