#!/usr/bin/env node
/**
 * 抓 jcap 真实 cpc_img + 解析 b1 字段
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
  await page.type('#loginname', 'jd_test_qwer@163.com', { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  await page.click('.login-btn');
  await sleep(15000);

  // 从 respLog 中提取 b1 真实图片
  for (let i = 0; i < respLog.length; i++) {
    const r = respLog[i];
    if (r.body.includes('"b1":"data:image/')) {
      // 解析 body
      const m = r.body.match(/"img":"(\{.*?\})\s*[,}]/);
      if (m) {
        const imgJson = m[1].replace(/\\"/g, '"');
        try {
          const imgObj = JSON.parse(imgJson);
          for (const [k, v] of Object.entries(imgObj)) {
            if (typeof v === 'string' && v.startsWith('data:image/')) {
              const b64 = v.replace(/^data:image\/\w+;base64,/, '');
              fs.writeFileSync(`/tmp/jd_track/jcap_b1_${i}_${k}.png`, Buffer.from(b64, 'base64'));
              console.log(`[respLog ${i}] b1.${k} saved (${(b64.length * 3/4 / 1024).toFixed(1)} KB)`);
            }
          }
        } catch (e) {
          console.log(`parse err: ${e.message}`);
        }
      } else {
        console.log(`[respLog ${i}] body has b1 but no img field pattern`);
        console.log(`  body: ${r.body.slice(0, 500)}`);
      }
    }
  }

  // 看 cpc_img src
  const cpcSrc = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    return cpc ? { src: cpc.src.slice(0, 100), w: cpc.offsetWidth, h: cpc.offsetHeight } : null;
  });
  console.log('\n#cpc_img:', JSON.stringify(cpcSrc));

  // 看 tip + cpc main 容器
  const dom = await page.evaluate(() => {
    const tip = document.querySelector('.tip_text.local_tip');
    const main = document.querySelector('[class*=cpc]');
    return {
      tip: tip ? tip.innerText : null,
      mainCls: main ? main.className : null,
      mainRect: main ? main.getBoundingClientRect() : null,
    };
  });
  console.log('DOM:', JSON.stringify(dom, null, 2));

  // 多次点击看是否能换验证码类型
  for (let click = 1; click <= 3; click++) {
    console.log(`\n--- 尝试第 ${click} 次点击 .login-btn ---`);
    await page.click('.login-btn');
    await sleep(10000);

    const tip = await page.evaluate(() => {
      const t = document.querySelector('.tip_text.local_tip');
      return t ? t.innerText : null;
    });
    console.log(`  tip: ${JSON.stringify(tip)}`);

    if (tip && tip.includes('拖动滑块')) {
      console.log(`  ✅ 滑块验证码！`);
      break;
    }
  }

  // 等滑块加载
  await sleep(5000);
  const dragInfo = await page.evaluate(() => {
    return {
      cpcImg: (() => {
        const c = document.querySelector('#cpc_img');
        return c ? { w: c.offsetWidth, h: c.offsetHeight } : null;
      })(),
      dragBox: (() => {
        const d = document.querySelector('.drag-box');
        return d ? { w: d.offsetWidth, h: d.offsetHeight, cls: d.className } : null;
      })(),
      slidePath: (() => {
        const s = document.querySelector('#slide_path');
        return s ? { w: s.offsetWidth, h: s.offsetHeight, style: s.getAttribute('style') } : null;
      })(),
      slider: (() => {
        const s = document.querySelector('#slider-div');
        return s ? { w: s.offsetWidth, h: s.offsetHeight, transform: getComputedStyle(s).transform, style: s.getAttribute('style') } : null;
      })(),
    };
  });
  console.log('\n滑块信息:', JSON.stringify(dragInfo, null, 2));

  // 抓最新 cpc_img
  const cpcData = await page.evaluate(() => {
    const c = document.querySelector('#cpc_img');
    return c ? c.src : null;
  });
  if (cpcData && cpcData.startsWith('data:')) {
    const b64 = cpcData.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync('/tmp/jd_track/cpc_real.jpg', Buffer.from(b64, 'base64'));
    console.log(`cpc_real.jpg saved (${(b64.length * 3/4 / 1024).toFixed(1)} KB)`);
  }

  await page.screenshot({ path: '/tmp/jd_track/jcap_slide.png', fullPage: true });
  await browser.close();
})();
