#!/usr/bin/env node
/**
 * jcap 完整分析 + OCR 旋转角度
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

  page.on('console', (msg) => {
    const t = msg.text();
    if (!t.includes('JDAS') && !t.includes('spm')) {
      console.log('  [console]', t.slice(0, 200));
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', 'jd_test_xyz2@163.com', { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  await page.click('.login-btn');
  await sleep(12000);

  // 完整 jcap DOM
  const jcapDom = await page.evaluate(() => {
    // 找 jcap 顶层
    const top = document.querySelector('#cpc_img') ? document.querySelector('#cpc_img').closest('[class*=cpc], [class*=jcap], [id*=cpc], [id*=jcap]') : null;
    if (!top) return null;
    return top.outerHTML;
  });
  console.log('jcap top HTML:');
  console.log(jcapDom);

  // 找 #cpc_img 和拖动条
  const detail = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    const slider = document.querySelector('#slider-div');
    const slidePath = document.querySelector('#slide_path');
    const dragBox = document.querySelector('.drag-box');
    return {
      cpcImg: cpc ? { src: cpc.src.slice(0, 100), w: cpc.offsetWidth, h: cpc.offsetHeight, transform: getComputedStyle(cpc).transform, style: cpc.getAttribute('style') } : null,
      slider: slider ? { w: slider.offsetWidth, h: slider.offsetHeight, transform: getComputedStyle(slider).transform, style: slider.getAttribute('style') } : null,
      slidePath: slidePath ? { w: slidePath.offsetWidth, h: slidePath.offsetHeight, style: slidePath.getAttribute('style') } : null,
      dragBox: dragBox ? { w: dragBox.offsetWidth, h: dragBox.offsetHeight, style: dragBox.getAttribute('style') } : null,
    };
  });
  console.log('\nDetail:', JSON.stringify(detail, null, 2));

  // 保存 #cpc_img
  if (detail.cpcImg && detail.cpcImg.src.startsWith('data:')) {
    const b64 = detail.cpcImg.src.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync('/tmp/jd_track/cpc_img.jpg', Buffer.from(b64, 'base64'));
    console.log('cpc_img saved');
  }
  if (detail.slider && detail.slider.src && detail.slider.src.startsWith('data:')) {
    const b64 = detail.slider.src.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync('/tmp/jd_track/cpc_slider.png', Buffer.from(b64, 'base64'));
    console.log('cpc_slider saved');
  }

  // 看 cpc_img transform
  await page.screenshot({ path: '/tmp/jd_track/jcap_v4.png', fullPage: true });

  await browser.close();
})();
