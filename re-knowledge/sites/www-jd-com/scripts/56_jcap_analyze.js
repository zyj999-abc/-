#!/usr/bin/env node
/**
 * jcap 验证码图片解析 + OCR + 旋转
 *
 * jcap UI: 174x174 主图 + 48x48 旋转滑块
 * 任务: 拖动滑块使旋转图旋转到正（旋转滑块验证码）
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { spawnSync } = require('child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
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

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('jcap') && url.includes('/api/')) {
      try {
        const txt = await resp.text();
        respLog.push({ url, body: txt });
      } catch (e) {}
    }
  });

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('jcap') || t.includes('verify') || t.includes('vt')) {
      console.log('  [console]', t.slice(0, 200));
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', 'jd_test_789@163.com', { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  await page.click('.login-btn');
  await sleep(10000);

  // 找 jcap 主图和滑块
  const jcapUI = await page.evaluate(() => {
    // 主图 - 174x174
    const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.offsetWidth > 100 && i.offsetWidth < 250);
    const slider = document.querySelector('#slider-div, [class*=slider]');
    const tip = document.querySelector('.tip_text');
    return {
      mainImg: imgs[0] ? { src: imgs[0].src.slice(0, 100), w: imgs[0].offsetWidth, h: imgs[0].offsetHeight, id: imgs[0].id } : null,
      slider: slider ? { id: slider.id, w: slider.offsetWidth, h: slider.offsetHeight, src: slider.src ? slider.src.slice(0, 100) : null, cls: slider.className, style: slider.getAttribute('style') } : null,
      tipText: tip ? tip.innerText : null,
    };
  });
  console.log('\njcap UI:');
  console.log('  mainImg:', JSON.stringify(jcapUI.mainImg));
  console.log('  slider:', JSON.stringify(jcapUI.slider));
  console.log('  tipText:', JSON.stringify(jcapUI.tipText));

  // 保存主图和滑块
  if (jcapUI.mainImg && jcapUI.mainImg.src.startsWith('data:')) {
    const b64 = jcapUI.mainImg.src.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync('/tmp/jd_track/jcap_main.png', Buffer.from(b64, 'base64'));
    console.log(`  → main.png saved (${(b64.length * 3/4 / 1024).toFixed(1)} KB)`);
  }
  if (jcapUI.slider && jcapUI.slider.src && jcapUI.slider.src.startsWith('data:')) {
    const b64 = jcapUI.slider.src.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync('/tmp/jd_track/jcap_slider.png', Buffer.from(b64, 'base64'));
    console.log(`  → slider.png saved (${(b64.length * 3/4 / 1024).toFixed(1)} KB)`);
  }

  // 看 jcap 容器结构
  const jcapContainer = await page.evaluate(() => {
    const main = document.querySelector('#cpc_img, [class*=cpc], .jcap_xxxx');
    return main ? main.outerHTML.slice(0, 1500) : 'not found';
  });
  console.log('\njcap 容器 HTML:', jcapContainer);

  // 找 jcap 拖动条
  const dragBar = await page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll('[class*=slide], [class*=drag], [id*=slide]'));
    return bars.map(b => ({
      tag: b.tagName,
      cls: b.className,
      id: b.id,
      w: b.offsetWidth,
      h: b.offsetHeight,
      outer: b.outerHTML.slice(0, 200),
    })).filter(b => b.w > 50);
  });
  console.log('\n拖动条:');
  for (const b of dragBar) {
    console.log(' ', JSON.stringify(b));
  }

  await page.screenshot({ path: '/tmp/jd_track/jcap_v2_full.png', fullPage: true });

  await browser.close();
})();
