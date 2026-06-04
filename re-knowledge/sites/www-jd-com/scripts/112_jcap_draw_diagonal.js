#!/usr/bin/env node
/**
 * 112_jcap_draw_diagonal.js
 *
 * jcap 验证码 = 画一条从左下到右上的斜线（带轻微弧度）
 * 起点：左下角光点
 * 终点：右上角光点
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const cdp = await page.target().createCDPSession();
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*jcap_ujb96b.js*', requestStage: 'Response' }],
  });

  await cdp.on('Fetch.requestPaused', async (event) => {
    try {
      const resp = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
      let body = resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf-8') : resp.body;

      const wCreateVariant = 'w=new(a["Cap"+e(533,561)+"aWe"+e(550,536)+e(548,521)+"bly"])(i)';
      if (body.includes(wCreateVariant)) {
        body = body.replace(wCreateVariant, wCreateVariant + ';window.__w=w;');
      }

      // hook tk 输出：拿到 vt
      const tkVariants = [
        'tk:k([a,s,A,JSON.stringify(f)])',
        'tk: k([a, s, A, JSON.stringify(f)])',
        'tk: k([a,s,A,JSON.stringify(f)])',
      ];
      for (const v of tkVariants) {
        if (body.includes(v)) {
          body = body.replace(v, 'tk:((t)=>{try{window.__tkInput=t;var o=k(t);window.__tkLastOut=o;return o}catch(e){throw e}})([a,s,A,JSON.stringify(f)])');
          break;
        }
      }

      const newBody = Buffer.from(body, 'utf-8').toString('base64');
      await cdp.send('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: event.responseHeaders,
        body: newBody,
      });
    } catch (e) {
      try { await cdp.send('Fetch.continueRequest', { requestId: event.requestId }); } catch (_) {}
    }
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/check') || url.includes('/api/verify')) {
      try {
        const txt = await resp.text();
        respLog.push({ url, body: txt });
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

  const ts = Date.now().toString().slice(-8);
  async function humanInput(sel, text) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    const x = box.x + 30;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await sleep(100);
    await page.mouse.click(x, y, { clickCount: 3 });
    await sleep(100);
    for (const ch of text) await page.keyboard.type(ch, { delay: 80 + Math.random() * 80 });
  }
  async function humanClick(sel) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    const x = box.x + 10 + Math.random() * (box.width - 20);
    const y = box.y + 5 + Math.random() * (box.height - 10);
    await page.mouse.move(x, y, { steps: 5 });
    await sleep(150);
    await page.mouse.click(x, y);
  }

  await humanInput('#loginname', 'jdtest_' + ts + '@163.com');
  await sleep(500);
  await humanInput('#nloginpwd', 'Pwd!@#abc1234');
  await sleep(800);

  let triggered = false;
  for (let i = 1; i <= 4; i++) {
    await humanClick('.login-btn');
    for (let w = 0; w < 8; w++) {
      await sleep(2000);
      try {
        const r = await page.$('#cpc_img, #curve_main_img, #main_img');
        if (r) { console.log('触发 click=' + i); triggered = true; break; }
      } catch (e) {}
    }
    if (triggered) break;
    await sleep(3000);
  }
  if (!triggered) { console.log('未触发'); await browser.close(); return; }
  await sleep(3000);

  // 抓 cpc_img 位置
  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc) return null;
    const r = cpc.getBoundingClientRect();
    return { x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
  });
  console.log('imgInfo:', JSON.stringify(imgInfo));
  if (!imgInfo) { console.log('no cpc_img'); await browser.close(); return; }

  // 画从左下到右上的斜线（带轻微弧度）
  // 起点：左下角 (imgInfo.x + 30, imgInfo.y + imgInfo.dh - 30)
  // 终点：右上角 (imgInfo.x + imgInfo.dw - 30, imgInfo.y + 30)
  const startX = imgInfo.x + 30;
  const startY = imgInfo.y + imgInfo.dh - 30;
  const endX = imgInfo.x + imgInfo.dw - 30;
  const endY = imgInfo.y + 30;

  console.log('Drawing from', startX, startY, 'to', endX, endY);

  // 移动到起点
  await page.mouse.move(startX, startY, { steps: 20 });
  await sleep(300);
  await page.mouse.down();
  await sleep(100);

  // 真实轨迹：60 步，x 线性增加，y 线性减少，加微小 jitter
  const N = 80;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    // 慢启动 + 线性 + 慢停止
    const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const x = startX + ease * (endX - startX);
    const y = startY + ease * (endY - startY);
    // 加微小 jitter (像素)
    const jitterX = (Math.random() - 0.5) * 2;
    const jitterY = (Math.random() - 0.5) * 2;
    await page.mouse.move(x + jitterX, y + jitterY);
    // 时间步：开始慢、中间快、结束慢
    let dt;
    if (i < 10) dt = 25 + Math.random() * 15;
    else if (i < N - 10) dt = 15 + Math.random() * 10;
    else dt = 25 + Math.random() * 15;
    await sleep(dt);
  }
  await sleep(200);
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(8000);

  console.log('\n=== /check 响应 ===');
  for (const r of respLog) {
    try {
      const j = JSON.parse(r.body);
      console.log(`  ${r.url.split('/').pop()}: code=${j.code} tp=${j.tp} vt=${j.vt ? 'YES(' + j.vt.substring(0, 30) + '...)' : 'null'} msg=${j.message || j.msg || ''}`);
    } catch (e) {
      console.log(`  ${r.url.split('/').pop()}: ${r.body.substring(0, 200)}`);
    }
  }

  // 抓 vt
  const vtData = await page.evaluate(() => ({
    tkInput: window.__tkInput ? window.__tkInput[0].substring(0, 40) : null,
    tkA: window.__tkInput ? window.__tkInput[2] : null,
    tkOutLen: window.__tkLastOut ? window.__tkLastOut.length : 0,
  }));
  console.log('\ntkA preview:', vtData.tkA ? vtData.tkA.substring(0, 200) : null);
  console.log('tk out len:', vtData.tkOutLen);

  await browser.close();
})();
