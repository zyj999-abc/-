/**
 * 阶段 7 (修订): 用 jdSlide 内部 e/j/c/w/s 参数, 替换 d 为算法生成
 *
 * 流程:
 *   1. 调 initJdSlide
 *   2. 触发真实 mousePos 生成 (dispatch)
 *   3. 拦截 s.html fetch, 拿到 e/j/c/w/s
 *   4. 用缺口识别 + 真实 d 算法, 计算新 d
 *   5. 用 e/j/c/w/s + 新 d 直接协议化提交 s.html
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const PROJECT = '/workspace/re-knowledge/sites/www-jd-com';

const randomStr = (n) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

(async () => {
  const USERNAME = `jdtest${randomStr(6)}@163.com`;
  console.log(`[配置] USERNAME: ${USERNAME}`);

  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
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

  // 拦截 jdSlide script 标签, 拿到 url 后阻止加载
  await page.evaluateOnNewDocument(() => {
    window.__sUrl = null;
    // 拦截 fetch
    const origFetch = window.fetch;
    window.fetch = function(url, opts) {
      if (typeof url === 'string' && url.includes('/slide/s.html')) {
        window.__sUrl = url;
        return Promise.resolve(new Response('{"success":"0","message":"intercepted"}', { status: 200 }));
      }
      return origFetch.apply(this, arguments);
    };
    // 拦截 XHR
    const origXhr = window.XMLHttpRequest;
    window.XMLHttpRequest = class extends origXhr {
      open(method, url) {
        this.__url = url;
        return super.open(method, url);
      }
      send(body) {
        if (this.__url && this.__url.includes('/slide/s.html')) {
          window.__sUrl = this.__url;
          return;
        }
        return super.send(body);
      }
    };
    // 拦截 script appendChild
    const origAppend = HTMLHeadElement.prototype.appendChild;
    HTMLHeadElement.prototype.appendChild = function(node) {
      if (node && node.tagName === 'SCRIPT' && node.src && node.src.includes('/slide/s.html')) {
        window.__sUrl = node.src;
        console.log('[intercept] script s.html:', node.src.slice(0, 100));
        return node;
      }
      return origAppend.call(this, node);
    };
  });

  console.log('[1] 打开 login...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'jd_slide_container';
    div.style.cssText = 'position:fixed;top:50px;left:200px;width:360px;height:300px;z-index:99999;background:#fff;border:1px solid red;';
    document.body.appendChild(div);
  });

  console.log('\n[2] initJdSlide...');
  await page.evaluate(async () => {
    return new Promise((resolve) => {
      initJdSlide({
        id: 'jd_slide_container',
        protocol: 'https',
        lang: 'zh-CN',
        product: 'embed',
        scene: 'login_pc',
        appId: '1604ebb2287',
        width: 360,
        account: 'jd_test_user_12345',
      }, (d) => { window.__slideData = d; resolve(); });
      setTimeout(resolve, 30000);
    });
  });
  await new Promise(r => setTimeout(r, 5000));

  // 强制 btn 可见
  await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (btn) btn.style.cssText = 'position:absolute;left:0;top:0;width:55px;height:55px;display:block;background:red;cursor:pointer;z-index:99999;';
  });
  await new Promise(r => setTimeout(r, 500));

  // 真实拖动
  console.log('\n[3] 真实拖动...');
  const setup = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const bg = btn.parentElement;
    const r = btn.getBoundingClientRect();
    const bgR = bg.getBoundingClientRect();
    return { startX: r.x + r.width/2, startY: bgR.y + bgR.height/2, endX: bgR.x + 240 };
  });

  await page.mouse.move(setup.startX, setup.startY);
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate((x, y) => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y }));
  }, setup.startX, setup.startY);
  await new Promise(r => setTimeout(r, 100));
  await page.mouse.down();
  await new Promise(r => setTimeout(r, 200));

  for (let i = 1; i <= 55; i++) {
    const t = i / 55;
    const ease = 1 - Math.pow(1 - t, 2.5);
    const x = setup.startX + (setup.endX - setup.startX) * ease;
    const y = setup.startY + Math.sin(t * Math.PI * 2.5) * 1.2;
    await page.mouse.move(x, y, { steps: 1 });
    await new Promise(r => setTimeout(r, 20 + Math.random() * 25));
  }
  await new Promise(r => setTimeout(r, 500));
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 3000));

  // 拿到 __sUrl
  const sUrl = await page.evaluate(() => window.__sUrl);
  console.log('\n[4] 拦截的 s.html URL:');
  console.log('  ', sUrl ? sUrl.slice(0, 500) : 'null');

  if (!sUrl) {
    console.log('  没拿到 sUrl, 退出');
    await browser.close();
    return;
  }

  // 解析 url 拿 e/j/c/w/s
  const urlObj = new URL(sUrl);
  const params = urlObj.searchParams;
  const origD = params.get('d');
  const e = params.get('e');
  const j = params.get('j');
  const c = params.get('c');
  const w = params.get('w');
  const s = params.get('s');
  console.log('\n[5] 关键参数:');
  console.log(`  d 长度: ${origD.length}`);
  console.log(`  e: ${e?.slice(0, 30)}...`);
  console.log(`  j: ${j?.slice(0, 30)}...`);
  console.log(`  c (validateID): ${c}`);
  console.log(`  w: ${w}`);
  console.log(`  s (sessionId): ${s}`);

  // 用 script 标签方式 (jsonp) 拿 g.html
  console.log('\n[6] 用 jsonp 触发 g.html 拿图片...');
  await page.evaluate((eu, ju) => {
    return new Promise((resolve) => {
      const cb = 'jsonp_g_' + Date.now();
      window[cb] = function(data) {
        window.__gData = data;
        resolve();
      };
      const s = document.createElement('script');
      s.src = `https://iv.joybuy.com/slide/g.html?appId=1604ebb2287&scene=login_pc&product=embed&e=${encodeURIComponent(eu)}&j=${encodeURIComponent(ju)}&lang=zh-CN&callback=${cb}`;
      s.setAttribute('ignore', 'true');
      document.head.appendChild(s);
      setTimeout(resolve, 10000);
    });
  }, e, j);

  const gData = await page.evaluate(() => {
    const d = window.__gData;
    if (!d) return null;
    const out = {
      success: d.success,
      message: d.message,
      y: d.y,
      challenge: d.challenge,
      o: d.o,
      api_server: d.api_server,
      static_servers: d.static_servers,
      patchLen: d.patch ? d.patch.length : 0,
      bgLen: d.bg ? d.bg.length : 0,
    };
    return out;
  });
  console.log('  gData 关键字段:');
  console.log(JSON.stringify(gData, null, 2));
  let patch = null, bg = null;
  if (gData) {
    patch = gData.patch;
    bg = gData.bg;
  }

  if (patch && bg) {
    console.log(`  patch len: ${patch.length}, bg len: ${bg.length}`);

    // 保存到 /tmp/jd_track/g2_*
    fs.writeFileSync('/tmp/jd_track/g2_patch.png', Buffer.from(patch, 'base64'));
    fs.writeFileSync('/tmp/jd_track/g2_bg.png', Buffer.from(bg, 'base64'));
    console.log('  images saved');

    // 用 Python 算缺口
    const pyResult = spawnSync('python3', [
      path.join(PROJECT, 'scripts/jd_slide_fulldemo.py'),
      '/tmp/jd_track/g2_bg.png',
      '/tmp/jd_track/g2_patch.png'
    ], { encoding: 'utf-8' });
    console.log('  python stdout:');
    console.log(pyResult.stdout);
    if (pyResult.stderr) console.log('  python stderr:', pyResult.stderr);

    // 提取 gap
    const gapMatch = pyResult.stdout.match(/缺口 x = (\d+)/);
    if (gapMatch) {
      const gap = parseInt(gapMatch[1]);
      console.log(`\n[7] 缺口 x = ${gap}`);
    }
  }

  await browser.close();
})();
