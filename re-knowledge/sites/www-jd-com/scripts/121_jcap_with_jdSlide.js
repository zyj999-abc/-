#!/usr/bin/env node
/**
 * 121_jcap_with_jdSlide.js
 *
 * 触发 jcap 后，引入 jdSlide SDK 替代 jcap 进行滑块验证
 * 看 jdSlide 的 patch/bg 跟 jcap 的 img 是不是同一张图
 */

const puppeteer = require('puppeteer-core');
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

  // 加载 jdSlide
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    req.continue();
  });

  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  const respLog = [];
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes('/cgi-bin/api/') || e.request.url.includes('slide/') || e.request.url.includes('iv.jd.com')) {
      respLog.push({ requestId: e.requestId, url: e.request.url, postData: e.request.postData || '' });
    }
  });
  cdp.on('Network.loadingFinished', async (e) => {
    const r = respLog.find(r => r.requestId === e.requestId);
    if (!r) return;
    try {
      const resp = await cdp.send('Network.getResponseBody', { requestId: e.requestId });
      r.body = resp.body || '';
    } catch (e) {}
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

  const ts = Date.now().toString().slice(-8);
  async function humanInput(sel, text) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    await page.mouse.click(box.x + 30, box.y + box.height / 2, { clickCount: 3 });
    await sleep(150);
    for (const ch of text) await page.keyboard.type(ch, { delay: 80 + Math.random() * 80 });
  }
  async function humanClick(sel) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    await page.mouse.click(box.x + 10 + Math.random() * (box.width - 20), box.y + 5 + Math.random() * (box.height - 10));
  }

  await humanInput('#loginname', 'jdtest_' + ts + '@163.com');
  await sleep(500);
  await humanInput('#nloginpwd', 'Pwd!@#abc1234');
  await sleep(800);

  for (let i = 1; i <= 4; i++) {
    await humanClick('.login-btn');
    await sleep(8000);
    try {
      const r = await page.$('#cpc_img, #curve_main_img, #main_img');
      if (r) { console.log('触发 click=' + i); break; }
    } catch (e) {}
  }
  await sleep(3000);

  // 在 jcap 弹窗中尝试加载 jdSlide
  const jdSlideTest = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://ivs.jd.com/slide/js/jdSlide.1.0.min.js';
      script.onload = () => {
        if (typeof window.jdSlide === 'function') {
          window.jdSlide({
            config: { appId: '1000803', scene: 'login', product: 'passport', lang: 'zh-CN' },
            onSuccess: (data) => resolve({ ok: true, data }),
            onFailed: (err) => resolve({ ok: false, err }),
          });
        } else {
          resolve({ ok: false, err: 'jdSlide not loaded' });
        }
      };
      script.onerror = () => resolve({ ok: false, err: 'script load failed' });
      document.head.appendChild(script);
      setTimeout(() => resolve({ ok: false, err: 'timeout' }), 10000);
    });
  });
  console.log('jdSlide test:', JSON.stringify(jdSlideTest));

  await sleep(8000);

  // 输出所有响应
  for (const r of respLog) {
    const ep = r.url.split('/').slice(-3).join('/');
    let j = null;
    try { j = JSON.parse(r.body); } catch (e) {}
    if (j) {
      const short = {};
      for (const k of ['code', 'msg', 'tp', 'st', 'vt', 'fp', 'token', 'data']) {
        if (k in j) short[k] = j[k] === '' ? '""' : (typeof j[k] === 'string' ? j[k].substring(0, 60) : j[k]);
      }
      console.log(`${ep}: ${JSON.stringify(short)}`);
    } else {
      console.log(`${ep}: ${r.body.substring(0, 200)}`);
    }
  }

  await browser.close();
})();
