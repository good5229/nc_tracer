import {expect,test} from '@playwright/test';
test('shows an automatically sized stock cut by the selected path',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'preview.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G17\nG0 X0 Y0 Z5\nG1 Z0 F100\nG1 X20 Y0\nG1 X20 Y10\nM30')});
 const panel=page.getByRole('region',{name:'선택 구간의 예시 가공 형상'});
 await expect(panel.locator('canvas')).toBeVisible();
 await expect(panel).toContainText('가공한 부품');
 await expect(panel.getByLabel('가공한 부품 전체 치수')).toContainText('가로');
 await expect(panel.getByLabel('가공한 부품 전체 치수')).toContainText('세로');
 await expect(panel.getByLabel('가공한 부품 전체 치수')).toContainText('높이');
 await expect(panel.locator('..')).toHaveClass(/viewport/);
 await panel.getByRole('button',{name:'형상 미리보기 확대'}).click();
 await expect(panel.getByRole('radio',{name:'가공한 부품'})).toBeChecked();
 const inspection=panel.getByLabel('예시 형상 치수');
 await expect(inspection).toContainText('가공한 부품 전체 범위');
 const imageData=await panel.locator('canvas').screenshot();
 const hit=await page.evaluate(async base64=>{
  const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;
  for(let y=Math.floor(image.height*.3);y<image.height*.7;y++)for(let x=Math.floor(image.width*.3);x<image.width*.7;x++){
   const orange=(xx:number,yy:number)=>{const i=(yy*image.width+xx)*4;return data[i]>90&&Math.abs(data[i]-data[i+1])<25&&Math.abs(data[i+1]-data[i+2])<25};if(orange(x,y)&&orange(x-3,y)&&orange(x+3,y)&&orange(x,y-3)&&orange(x,y+3))return {x:x/image.width,y:y/image.height};
  }return null;
 },imageData.toString('base64'));
 expect(hit).not.toBeNull();
 const box=await panel.locator('canvas').boundingBox();
 await page.mouse.move(box!.x+box!.width*hit!.x,box!.y+box!.height*hit!.y);
 await expect(inspection).toContainText('표면 좌표');
 await expect(inspection).toContainText('연결된 가공 영역 범위');
 const link=inspection.getByRole('button',{name:/관련 NC .*행과 경로 보기/});
 await expect(link).toBeVisible();
 const line=(await link.textContent())!.match(/NC (\d+)행/)![1];
 const selectedCanvas=await panel.locator('canvas').boundingBox();
 await page.mouse.click(selectedCanvas!.x+selectedCanvas!.width*hit!.x,selectedCanvas!.y+selectedCanvas!.height*hit!.y);
 await expect(panel.getByLabel('선택한 면의 치수').locator('.stock-face-dimension')).toHaveCount(2);
 await expect(panel.getByLabel('선택한 면의 치수')).toContainText('방향 길이');
 await expect(panel.getByLabel('선택한 면의 치수')).not.toContainText('세로(Y) 0');
 await panel.getByLabel('선택한 면의 치수').getByRole('button',{name:/관련 NC .*행과 경로 보기/}).click();
 await expect(panel.getByRole('button',{name:'형상 미리보기 확대'})).toBeVisible();
 await expect(page.locator('.code-line.selected').first()).toContainText(line);
 await panel.getByRole('button',{name:'형상 미리보기 확대'}).click();
 await expect(panel.getByRole('status')).toContainText('바뀐 격자');
 await panel.getByLabel('나란히 비교').check();
 await expect(panel.locator('canvas')).toBeVisible();
 await expect(panel).toContainText('실제 완성 형상이나 충돌·가공 안전 판정이 아닙니다');
 await expect(panel.getByLabel('나란히 비교')).toBeChecked();
 await expect(panel).toContainText('가공한 부품은 제거된 부피를 시각화한 추정 형상이며 실제 완성품을 뜻하지 않습니다');
 const canvas=panel.locator('canvas');
 const both=await canvas.screenshot();
 await panel.getByLabel('남은 소재').check();
 const remaining=await canvas.screenshot();
 await panel.getByRole('radio',{name:'가공한 부품'}).check();
 const removed=await canvas.screenshot();
 expect(both.equals(remaining)).toBe(false);
 expect(removed.equals(remaining)).toBe(false);
 await page.keyboard.press('Escape');
 await expect(panel.getByRole('button',{name:'형상 미리보기 확대'})).toBeVisible();
});

test('labels assumed units and omits canned-cycle moves from an illustrative shape',async({page})=>{
 await page.goto('/nc_tracer/');await page.getByLabel('컨트롤러 프로파일').selectOption('fanuc');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'preview-fanuc.nc',mimeType:'text/plain',buffer:Buffer.from('G54\nG90 G17 G0 X0 Y0 Z4\nG1 Z-1\nG84 Z-3 R1\nG80\nG90 G0 X0 Y0 Z4\nG1 X4')});
 const panel=page.getByRole('region',{name:'선택 구간의 예시 가공 형상'});
 await expect(panel.locator('canvas')).toBeVisible();
 await panel.getByRole('button',{name:'형상 미리보기 확대'}).click();
 await expect(panel.getByRole('status')).toContainText('원본 단위 (mm로 가정)');
 await expect(panel.getByRole('status')).toContainText('생략한 사이클 구간');
 await expect(panel.locator('canvas')).toBeVisible();
});


test('small screens can expand the preview and compare shapes',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/nc_tracer/');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'preview.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G17\nG0 X0 Y0 Z5\nG1 Z0 F100\nG1 X20 Y0\nG1 X20 Y10\nM30')});
 const panel=page.getByRole('region',{name:'선택 구간의 예시 가공 형상'});
 await expect(panel.locator('canvas')).toBeVisible();
 await panel.getByRole('button',{name:'형상 미리보기 확대'}).click();
 await panel.getByLabel('나란히 비교').check();
 await expect(panel.locator('.stock-compare-labels')).toContainText('남은 소재');
 await expect(panel.locator('.stock-compare-labels')).toContainText('가공한 부품');
 await panel.getByRole('button',{name:'형상 미리보기 닫기'}).click();
 await expect(panel.getByRole('button',{name:'형상 미리보기 확대'})).toBeVisible();
});


test('warning entries navigate to code without fabricating a path, and playback follows code',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'review.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G17\nG0 X0 Y0 Z5\nG1 Z0 F100\nG1 X20 Y0\nG999\nG1 X20 Y10\nM30')});
 const warnings=page.locator('.path-review-warnings');await expect(warnings).toBeVisible();
 await warnings.locator('summary').click();
 const entry=warnings.getByRole('button',{name:/5행/});await expect(entry).toBeVisible();await entry.click();
 await expect(page.locator('.code-line.selected').first()).toContainText('G999');
 await page.getByRole('button',{name:'처음으로'}).click();
 const before=await page.locator('.code-line.selected').first().innerText();
 await page.getByRole('button',{name:'다음 블록'}).click();
 await expect(page.locator('.code-line.selected').first()).not.toHaveText(before);
 const step=await page.locator('.code-line.selected').first().innerText();
 await page.getByRole('button',{name:'재생',exact:true}).click();
 await expect(page.locator('.code-line.selected').first()).not.toHaveText(step,{timeout:3000});
 await page.getByRole('button',{name:'일시정지',exact:true}).click();
});

test('shows the orientation axes and rotates them with the 3D preview',async({page})=>{
 await page.goto('/nc_tracer/');
 await page.locator('.topbar input[type=file]').setInputFiles({name:'axis.nc',mimeType:'text/plain',buffer:Buffer.from('G21 G90 G17\nG0 X0 Y0 Z5\nG1 Z0 F100\nG1 X20 Y0\nG1 X20 Y10\nM30')});
 const panel=page.getByRole('region',{name:'선택 구간의 예시 가공 형상'});
 const axes=panel.getByRole('img',{name:'형상의 X, Y, Z 양의 방향'});
 await expect(axes).toBeVisible();await expect(axes).toContainText('X');await expect(axes).toContainText('Y');await expect(axes).toContainText('Z');
 await panel.getByRole('button',{name:'형상 미리보기 확대'}).click();
 const line=axes.locator('[data-axis-line="x"]');
 const before={x:await line.getAttribute('x2'),y:await line.getAttribute('y2')};
 const box=await panel.locator('canvas').boundingBox();
 await page.mouse.move(box!.x+box!.width*.75,box!.y+box!.height*.4);await page.mouse.down();
 await page.mouse.move(box!.x+box!.width*.65,box!.y+box!.height*.55,{steps:8});await page.mouse.up();
 const after={x:await line.getAttribute('x2'),y:await line.getAttribute('y2')};
 expect(after).not.toEqual(before);
});
