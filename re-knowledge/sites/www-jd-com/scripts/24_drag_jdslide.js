/**
 * 阶段 4-6 最终: 真实模拟拖动 jdSlide 拿 w → 协议化登录
 *
 * 流程:
 * 1. 打开 passport.jd.com
 * 2. 填随机测试账号密码
 * 3. 调 initJdSlide(config, callback) 加载滑块
 * 4. 用 puppeteer 真实拖动滑块
 * 5. callback 触发 → 拿 w
 * 6. 协议化 POST /uc/loginService 带 w
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
const PASSWORD = `Pwd${randomStr(8)}!@#`;

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

  const apiLog = [];
  const respLog = [];
  page.on('request', (req) => {
    if (req.url().match(/loginService|jcap\.m\.jd|ivs\.jd|iv\.jd|iv\.joybuy|jra\.jd|cactus|sgm-|h5speed|geetest/)) {
      apiLog.push({ ts: Date.now(), method: req.method(), url: req.url(), postData: req.postData() });
    }
  });
  page.on('response', async (resp) => {
    if (resp.url().match(/loginService|jcap\.m\.jd|ivs\.jd|iv\.jd|iv\.joybuy|jra\.jd/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url: resp.url(), status: resp.status(), body: txt, setCookie: resp.headers()['set-cookie'] });
      } catch (e) {}
    }
  });

  console.log('[1] 打开 passport.jd.com ...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 抓 form 字段
  const form = await page.evaluate(() => ({
    uuid: $('#uuid').val(),
    eid: $('#eid').val(),
    fp: $('#sessionId').val(),
    eid2: $('#eid2').val(),
    token: $('#token').val(),
    loginType: $('#loginType').val(),
    sa_token: $('#sa_token').val(),
    pubKey: $('#pubKey').val(),
    useSlideAuthCode: $('#useSlideAuthCode').val(),
    firstShowAccountLoginPage: $('#firstShowAccountLoginPage').val(),
    graphicCaptchaStatus: $('#graphicCaptchaStatus').val(),
    graphicCaptchaAppId: $('#graphicCaptchaAppId').val(),
    graphicCaptchaSessionId: $('#graphicCaptchaSessionId').val(),
    graphicCaptchaJwtToken: $('#graphicCaptchaJwtToken').val(),
    expgroup: $('#expgroup').val(),
    pageSource: $('#pageSource').val(),
    pageLocation: $('#pageLocation').val(),
  }));
  console.log(`  uuid: ${form.uuid}`);
  console.log(`  eid: ${form.eid?.slice(0, 30)}...`);
  console.log(`  sa_token: ${form.sa_token?.length} chars`);

  await page.type('#loginname', USERNAME, { delay: 30 });
  await page.type('#nloginpwd', PASSWORD, { delay: 30 });
  await new Promise(r => setTimeout(r, 2000));

  // 创建滑块容器 + 调 initJdSlide
  console.log('\n[2] 创建滑块 + 调 initJdSlide...');
  await page.evaluate(() => {
    // 创建滑块容器
    const div = document.createElement('div');
    div.id = 'slideAuthCode';
    div.style.cssText = 'position:fixed;top:200px;left:200px;width:300px;height:200px;z-index:99999;background:#fff;border:1px solid red;';
    document.body.appendChild(div);
  });

  // 调 initJdSlide, callback 收到 w/tk/vt
  const slideData = await new Promise(async (resolve) => {
    const data = await page.evaluate(async () => {
      return new Promise((resolveInner) => {
        const config = {
          protocol: 'https',
          lang: 'zh-CN',
          productId: '1',
          sceneId: 'login_pc',
          account: 'test_user_12345',
          appId: '1604ebb2287',
        };
        initJdSlide(config, function(slideData) {
          resolveInner(slideData);
        });
        setTimeout(() => resolveInner(null), 30000);
      });
    });
    return data;
  });

  console.log('[3] initJdSlide 加载完成');
  if (slideData) {
    console.log('  实际数据:', JSON.stringify(slideData).slice(0, 500));
  } else {
    console.log('  无数据（30s timeout）');
  }

  // 等滑块 UI 完全加载
  await new Promise(r => setTimeout(r, 3000));

  // 截图看滑块 UI
  await page.screenshot({ path: '/tmp/jd_track/slide_ui.png', fullPage: true });

  // 找滑块元素
  console.log('\n[4] 找滑块元素 ...');
  const slideElements = await page.evaluate(() => {
    // 找 slideAuthCode 内所有元素
    const container = document.querySelector('#slideAuthCode');
    if (!container) return { err: 'no container' };
    const all = container.querySelectorAll('*');
    const result = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width > 10 && r.height > 10) {
        result.push({
          tag: el.tagName,
          cls: el.className,
          id: el.id,
          x: r.x, y: r.y, w: r.width, h: r.height,
        });
      }
    }
    return { container, all: result, count: all.length };
  });
  console.log('  slide elements:', JSON.stringify(slideElements, null, 2).slice(0, 2000));

  // 找具体滑块按钮（一般在 .slide-btn 或 .jd-slide-btn）
  const slideBtn = await page.evaluate(() => {
    const candidates = [
      document.querySelector('#slideAuthCode .slide-btn'),
      document.querySelector('#slideAuthCode .jd-slide-btn'),
      document.querySelector('#slideAuthCode [class*="btn"]'),
      document.querySelector('#slideAuthCode [class*="slide-btn"]'),
      document.querySelector('#slideAuthCode [class*="slider"]'),
      document.querySelector('#slideAuthCode button'),
      document.querySelector('#slideAuthCode [role="button"]'),
    ].filter(Boolean);
    return candidates.map(c => {
      const r = c.getBoundingClientRect();
      return { tag: c.tagName, cls: c.className, id: c.id, x: r.x, y: r.y, w: r.width, h: r.height };
    });
  });
  console.log('  slide btn candidates:', JSON.stringify(slideBtn, null, 2));

  // 找缺口位置（jdSlide 会显示图片 + 滑块）
  // 1. 滑块按钮的 x, y
  // 2. 滑块容器的 x, y
  // 3. 图片的 x, y

  if (slideElements.all && slideElements.all.length > 0) {
    // 找按钮
    const btn = slideElements.all.find(e => /btn|slider|drag/i.test(e.cls || '')) || slideElements.all[0];
    console.log(`  选用按钮: cls=${btn.cls} x=${btn.x} y=${btn.y} w=${btn.w} h=${btn.h}`);

    if (btn.w > 0 && btn.h > 0) {
      const startX = btn.x + btn.w / 2;
      const startY = btn.y + btn.h / 2;
      const endX = startX + 250;  // 滑块拖到右边
      const endY = startY;

      console.log(`\n[5] 拖动滑块: (${startX}, ${startY}) -> (${endX}, ${endY})`);

      // 真实拖动
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // 缓慢移动
      const steps = 30;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = startX + (endX - startX) * t;
        const y = startY + (endY - startY) * t + Math.sin(t * Math.PI) * 5;  // 加点抖动
        await page.mouse.move(x, y, { steps: 1 });
        await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
      }
      await new Promise(r => setTimeout(r, 500));
      await page.mouse.up();

      console.log('  拖动完成，等 callback 触发...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // 看 callback 是否触发 + 抓所有 jdSlide 响应
  console.log('\n[6] jdSlide 网络请求:');
  for (const a of apiLog.filter(a => a.url.includes('iv.jd.com') || a.url.includes('iv.joybuy') || a.url.includes('slide'))) {
    console.log(`  [${a.method}] ${a.url}`);
    if (a.postData) console.log(`    body: ${a.postData.slice(0, 300)}`);
  }
  console.log('\n[7] jdSlide 响应:');
  for (const r of respLog.filter(r => r.url.includes('iv.jd.com') || r.url.includes('iv.joybuy') || r.url.includes('slide'))) {
    console.log(`  [${r.status}] ${r.url}`);
    console.log(`    body: ${r.body.slice(0, 500)}`);
  }

  // 看 callback 结果
  const finalSlideData = await page.evaluate(() => {
    return window.__slideData || null;
  });
  console.log('\n[8] callback 数据:', JSON.stringify(finalSlideData).slice(0, 500));

  fs.writeFileSync('/tmp/jd_track/slide_drag_apis.json', JSON.stringify(apiLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/slide_drag_resps.json', JSON.stringify(respLog, null, 2));
  await page.screenshot({ path: '/tmp/jd_track/slide_dragged.png', fullPage: true });

  await browser.close();
})();
