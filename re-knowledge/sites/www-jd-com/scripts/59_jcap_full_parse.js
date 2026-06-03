#!/usr/bin/env node
/**
 * 解析 jcap b1 真实图片 + 看完整验证码 UI
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
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

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', 'jd_test_final@163.com', { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  await page.click('.login-btn');
  await sleep(15000);

  // 看完整 jcap UI
  const allInfo = await page.evaluate(() => {
    const result = {};
    // 找 jcap 顶层 - 找 cpc 容器
    const cpcContainer = document.querySelector('[class*=cpc-img-container], [class*=captcha-container]');
    if (cpcContainer) {
      result.cpcContainer = {
        html: cpcContainer.outerHTML,
        rect: cpcContainer.getBoundingClientRect(),
      };
    }
    // 找 #cpc-main, .cpc-main
    const main = document.querySelector('#cpc-main, .cpc-main, [class*=cpc]');
    result.allCpcClasses = Array.from(document.querySelectorAll('[class*=cpc]')).map(c => c.className);

    // 找所有 tip
    result.tips = Array.from(document.querySelectorAll('.tip_text, .tips-inner, [class*=tip]')).map(t => ({
      cls: t.className,
      text: t.innerText && t.innerText.trim() || null,
    })).filter(t => t.text);

    // 找所有 image
    result.images = Array.from(document.querySelectorAll('img')).filter(i => i.offsetWidth > 50).map(i => ({
      src: i.src.slice(0, 100),
      w: i.offsetWidth,
      h: i.offsetHeight,
      id: i.id,
      cls: i.className,
    }));

    // 找所有 drag 相关
    result.drags = Array.from(document.querySelectorAll('[class*=drag], [id*=drag], [class*=slide], [id*=slide]')).map(d => ({
      tag: d.tagName,
      cls: d.className,
      id: d.id,
      w: d.offsetWidth,
      h: d.offsetHeight,
      html: d.outerHTML.slice(0, 200),
    })).filter(d => d.w > 50 || d.h > 30);

    return result;
  });
  console.log('allCpcClasses:', JSON.stringify(allInfo.allCpcClasses, null, 2));
  console.log('\ntips:', JSON.stringify(allInfo.tips, null, 2));
  console.log('\nimages:', JSON.stringify(allInfo.images, null, 2));
  console.log('\ndrags:', JSON.stringify(allInfo.drags, null, 2));

  // 解析 respLog 中的 b1 img
  for (let i = 0; i < respLog.length; i++) {
    const r = respLog[i];
    if (r.body.includes('"b1"')) {
      // 用 browser 解析 img 字段
      const parsed = await page.evaluate((body) => {
        try {
          const obj = JSON.parse(body);
          if (obj.img) {
            const imgObj = JSON.parse(obj.img);
            return Object.keys(imgObj).map(k => ({ k, type: typeof imgObj[k], len: imgObj[k].length }));
          }
        } catch (e) { return null; }
        return null;
      }, r.body);
      console.log(`\n[respLog ${i}] img keys:`, JSON.stringify(parsed, null, 2));

      if (parsed) {
        for (const { k, type, len } of parsed) {
          if (k.startsWith('b') || k.includes('img') || k.includes('cap')) {
            // 提取真实图片
            const b64 = await page.evaluate((body, k) => {
              try {
                const obj = JSON.parse(body);
                if (obj.img) {
                  const imgObj = JSON.parse(obj.img);
                  return imgObj[k];
                }
              } catch (e) { return null; }
            }, r.body, k);
            if (b64 && b64.startsWith('data:image/')) {
              const data = b64.replace(/^data:image\/\w+;base64,/, '');
              fs.writeFileSync(`/tmp/jd_track/jcap_real_${i}_${k}.png`, Buffer.from(data, 'base64'));
              console.log(`  → ${k} saved (${(data.length * 3/4 / 1024).toFixed(1)} KB)`);
            }
          }
        }
      }
    }
  }

  await page.screenshot({ path: '/tmp/jd_track/jcap_real.png', fullPage: true });
  await browser.close();
})();
