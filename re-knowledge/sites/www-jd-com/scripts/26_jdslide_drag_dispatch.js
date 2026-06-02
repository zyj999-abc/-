/**
 * 阶段 5: 触发 jdSlide 滑块真实拖动 - 修复 slideBtn 尺寸
 *
 * 关键: 在 jdSlide 完全加载后, 主动 trigger mouse 事件到 slideBtn
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');

const randomStr = (n) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
const USERNAME = `jdtest${randomStr(6)}@163.com`;

(async () => {
  console.log(`[配置] USERNAME: ${USERNAME}`);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  console.log('[1] 打开 passport.jd.com ...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'jd_slide_container';
    div.style.cssText = 'position:fixed;top:100px;left:200px;width:360px;height:300px;z-index:99999;background:#fff;border:1px solid red;';
    document.body.appendChild(div);
  });

  // 真实模式: 通过 JD login 流程触发 jdSlide
  // 但更简单: 直接用 initJdSlide + 真实 product=login_pc
  console.log('\n[2] 调 initJdSlide 创建滑块...');
  await page.evaluate(async () => {
    return new Promise((resolve) => {
      const config = {
        id: 'jd_slide_container',
        protocol: 'https',
        lang: 'zh-CN',
        product: 'embed',
        scene: 'login_pc',
        appId: '1604ebb2287',
        width: 360,
        account: 'jd_test_user_12345',
      };
      initJdSlide(config, function(slideData) {
        console.log('  [callback]', JSON.stringify(slideData).slice(0, 500));
        window.__slideData = slideData;
        resolve();
      });
      setTimeout(resolve, 30000);
    });
  });

  await new Promise(r => setTimeout(r, 6000));

  await page.screenshot({ path: '/tmp/jd_track/slide_init.png', fullPage: true });

  // 分析 JDJRV-slide-btn 的实际尺寸和父元素
  const debug = await page.evaluate(() => {
    const wrap = document.querySelector('#jd_slide_container');
    if (!wrap) return { err: 'no container' };
    const result = {
      wrapRect: wrap.getBoundingClientRect(),
      wrapOuter: wrap.outerHTML.slice(0, 800),
      all: [],
    };
    // 收集所有有 class 的元素
    const collect = (el, depth) => {
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      result.all.push({
        depth,
        tag: el.tagName,
        cls: el.className,
        x: r.x, y: r.y, w: r.width, h: r.height,
        display: cs.display,
        visibility: cs.visibility,
        bgImg: cs.backgroundImage.slice(0, 50),
        cursor: cs.cursor,
        position: cs.position,
      });
      for (const c of el.children) collect(c, depth + 1);
    };
    collect(wrap, 0);
    return result;
  });
  console.log('\n[3] 元素尺寸 (filter h>0):');
  for (const e of debug.all) {
    if (e.h > 0) {
      console.log(`  [d=${e.depth}] ${e.tag}.${e.cls} x=${e.x.toFixed(0)} y=${e.y.toFixed(0)} w=${e.w.toFixed(0)} h=${e.h.toFixed(0)} disp=${e.display} cur=${e.cursor}`);
    }
  }
  console.log('\n  === slideBtn 相关 ===');
  const btnEntry = debug.all.find(e => e.cls.includes('JDJRV-slide-btn'));
  if (btnEntry) {
    console.log('  slide-btn:', JSON.stringify(btnEntry));
  } else {
    console.log('  没找到 JDJRV-slide-btn');
  }
  console.log('  wrap outerHTML:');
  console.log('  ', debug.wrapOuter);

  // 直接对 slideBtn 元素触发 mousedown/move/up
  // 用 page.evaluate 直接 dispatchEvent
  console.log('\n[4] 尝试通过 JS 触发 mousedown 到 slideBtn...');
  const dragRes = await page.evaluate(async () => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (!btn) return { err: 'no slide-btn' };
    const r = btn.getBoundingClientRect();
    const startX = r.left + r.width / 2;
    const startY = r.top + r.height / 2;
    if (r.width < 5 || r.height < 5) {
      // 强制重置样式
      btn.style.cssText = 'position:absolute;left:0;top:0;width:40px;height:40px;background:red;cursor:pointer;z-index:99999;';
    }
    return new Promise((resolve) => {
      const newR = btn.getBoundingClientRect();
      const sx = newR.left + newR.width / 2;
      const sy = newR.top + newR.height / 2;
      const fireEvt = (type, x, y) => {
        const e = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y });
        btn.dispatchEvent(e);
      };
      // mousedown
      fireEvt('mousedown', sx, sy);
      // 模拟 30 步 mousemove on document
      const targetX = sx + 250;
      let i = 0;
      const interval = setInterval(() => {
        i++;
        const t = i / 30;
        const x = sx + (targetX - sx) * t;
        const y = sy + Math.sin(t * Math.PI * 1.5) * 2;
        const e = new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y });
        document.dispatchEvent(e);
        if (i >= 30) {
          clearInterval(interval);
          setTimeout(() => {
            const eUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0, clientX: targetX, clientY: sy });
            document.dispatchEvent(eUp);
            resolve({ ok: true, sx, sy, targetX, btnW: newR.width, btnH: newR.height });
          }, 200);
        }
      }, 30);
    });
  });
  console.log('  dragRes:', JSON.stringify(dragRes));

  await new Promise(r => setTimeout(r, 6000));

  await page.screenshot({ path: '/tmp/jd_track/slide_after_drag.png', fullPage: true });

  // 看是否触发了 s.html 请求
  const slideReqs = respLog.filter(r => r.url.includes('iv.jd.com') || r.url.includes('iv.joybuy'));
  console.log(`\n[5] jdSlide 后端响应 (${slideReqs.length} 条):`);
  for (const r of slideReqs) {
    console.log(`  [${r.status}] ${r.url.slice(0, 200)}`);
    console.log(`    body: ${r.body.slice(0, 800)}`);
  }

  // 看 callback
  const cb = await page.evaluate(() => window.__slideData);
  console.log('\n[6] callback 数据:');
  console.log(JSON.stringify(cb, null, 2).slice(0, 2000));

  fs.writeFileSync('/tmp/jd_track/drag3_resps.json', JSON.stringify(respLog, null, 2));
  await browser.close();
})();
