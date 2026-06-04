#!/usr/bin/env node
/**
 * 125_jcap_stealth_bypass.js
 *
 * jcap 服务端 ML 绕过策略：
 * 1. puppeteer-extra + stealth 插件（移除 webdriver 痕迹）
 * 2. 真人级行为：贝塞尔曲线轨迹 + 自然随机 delay + 鼠标抖动
 * 3. 多次重试 + 退避（jcap 可能冷却一段时间放过）
 * 4. 滚动页面 + 鼠标自然 hover
 * 5. 不同 captcha 类型自适应
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

puppeteer.use(StealthPlugin());

const VENV_SITE = '/workspace/re-knowledge/sites/www-jd-com';
const GEN_SCRIPT = path.join(VENV_SITE, 'scripts/88_gen_z_path.py');

// 贝塞尔曲线轨迹生成（真实人类特征）
function bezierPath(p0, p1, p2, p3, steps) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x;
    const y = u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y;
    points.push({ x, y, t });
  }
  return points;
}

async function realisticMouseMove(page, fromX, fromY, toX, toY, totalMs = 4000) {
  // 真实鼠标轨迹：贝塞尔曲线 + 抖动 + 时间分布
  const steps = Math.max(40, Math.floor(totalMs / 30));
  // 起点控制点
  const cp1 = { x: fromX + (toX - fromX) * 0.2 + (Math.random() - 0.5) * 30, y: fromY + (Math.random() - 0.5) * 20 };
  const cp2 = { x: fromX + (toX - fromX) * 0.8 + (Math.random() - 0.5) * 30, y: toY + (Math.random() - 0.5) * 20 };
  const path = bezierPath({ x: fromX, y: fromY }, cp1, cp2, { x: toX, y: toY }, steps);

  // 时间分布：开始慢、加速、接近目标减速
  for (let i = 0; i < path.length; i++) {
    const t = i / path.length;
    // 缓动：开始慢、加速、结束慢
    const speed = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const noiseX = (Math.random() - 0.5) * 2;
    const noiseY = (Math.random() - 0.5) * 2;
    await page.mouse.move(path[i].x + noiseX, path[i].y + noiseY);
    const baseDelay = (1 - Math.abs(speed - 0.5) * 0.5) * 25 + 10;
    const jitter = Math.random() * 20;
    await sleep(baseDelay + jitter);
  }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome',
    headless: 'new',  // 使用 Chrome 新的 headless 模式（更真实）
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--window-size=1366,768',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
    ],
    defaultViewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });

  await page.evaluateOnNewDocument(() => {
    // 彻底移除 webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    // 真实 plugin
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ],
    });
    // 真实 mimeTypes
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => [
        { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: { name: 'Chrome PDF Plugin' } },
      ],
    });
    // Chrome 运行时
    window.chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
      runtime: {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
        connect: () => {}, sendMessage: () => {},
      },
      loadTimes: () => ({}),
      csi: () => ({}),
    };
    // WebGL vendor/renderer 真实化（不是 SwiftShader）
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return 'Intel Inc.';
        if (param === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter2.call(this, param);
      };
    }
    // Connection type
    Object.defineProperty(navigator, 'connection', {
      get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
    });
  });

  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  const respLog = [];
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes('/cgi-bin/api/')) {
      respLog.push({ requestId: e.requestId, url: e.request.url, postData: e.request.postData || '', t: Date.now() });
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

  // 步骤 1：先访问京东首页热身（建立自然浏览历史）
  console.log('[1] 访问京东首页热身...');
  await page.goto('https://www.jd.com', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000 + Math.random() * 3000);
  // 鼠标在首页随机移动
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(100 + Math.random() * 1100, 100 + Math.random() * 500, { steps: 10 });
    await sleep(300 + Math.random() * 500);
  }
  // 滚动一点
  await page.evaluate(() => window.scrollTo(0, 100 + Math.random() * 300));
  await sleep(1000 + Math.random() * 2000);

  // 步骤 2：访问登录页
  console.log('[2] 访问登录页...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000 + Math.random() * 2000);
  // 鼠标在登录页随机移动
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(200 + Math.random() * 900, 200 + Math.random() * 400, { steps: 10 });
    await sleep(500 + Math.random() * 500);
  }

  // 步骤 3：输入账号密码（真人级）
  console.log('[3] 输入账号密码...');
  const ts = Date.now().toString().slice(-8);
  const username = `jdtest_${ts}@163.com`;
  const password = 'Pwd!@#abc1234';

  // 点击账号输入框
  const userEl = await page.$('#loginname');
  const userBox = await userEl.boundingBox();
  await realisticMouseMove(page, 700, 400, userBox.x + 50 + Math.random() * 100, userBox.y + userBox.height / 2 + Math.random() * 5, 1500);
  await sleep(300);
  await page.mouse.click(userBox.x + 50, userBox.y + userBox.height / 2);
  await sleep(800);
  // 真人输入：偶尔有 typo
  for (let i = 0; i < username.length; i++) {
    await page.keyboard.type(username[i], { delay: 100 + Math.random() * 200 });
  }
  await sleep(800 + Math.random() * 500);

  // 点击密码输入框
  const pwdEl = await page.$('#nloginpwd');
  const pwdBox = await pwdEl.boundingBox();
  await realisticMouseMove(page, userBox.x + 50, userBox.y + userBox.height / 2, pwdBox.x + 50 + Math.random() * 100, pwdBox.y + pwdBox.height / 2 + Math.random() * 5, 1500);
  await sleep(300);
  await page.mouse.click(pwdBox.x + 50, pwdBox.y + pwdBox.height / 2);
  await sleep(800);
  for (let i = 0; i < password.length; i++) {
    await page.keyboard.type(password[i], { delay: 100 + Math.random() * 200 });
  }
  await sleep(1500);

  // 步骤 4：触发 jcap
  console.log('[4] 触发 jcap...');
  const btnEl = await page.$('.login-btn');
  const btnBox = await btnEl.boundingBox();
  await realisticMouseMove(page, pwdBox.x + 50, pwdBox.y + pwdBox.height / 2, btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2, 1500);
  await sleep(500);
  await page.mouse.click(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
  await sleep(8000);

  // 步骤 5：识别 captcha 类型
  console.log('[5] 识别 captcha 类型...');
  const captchaInfo = await page.evaluate(() => {
    const modal = document.querySelector('#captcha_modal, .captcha_modal_pc');
    if (!modal) return { error: 'no modal' };
    const elements = {};
    modal.querySelectorAll('[id]').forEach(el => {
      elements[el.id] = {
        tag: el.tagName, cls: el.className,
        x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y,
        w: el.offsetWidth, h: el.offsetHeight,
      };
    });
    const cpc = modal.querySelector('#cpc_img');
    return {
      elements,
      cpc: cpc ? { src: cpc.src.substring(0, 80), w: cpc.offsetWidth, h: cpc.offsetHeight } : null,
      hasTrackLine: !!modal.querySelector('#trackLine'),
      hasSlidePath: !!modal.querySelector('#slide_path'),
      hasDragBox: !!modal.querySelector('.drag-box'),
    };
  });
  console.log('Captcha info:', JSON.stringify(captchaInfo).substring(0, 500));

  // 步骤 6：真人级轨迹拖动
  // 6A: tp=26 旋转图片验证码 - 拖动 slide_path 让 cpc_img 旋转到正
  if (captchaInfo.elements && captchaInfo.elements.slide_path && captchaInfo.elements.slide_path.w > 0) {
    const sp = captchaInfo.elements.slide_path;
    const sBox = { x: sp.x, y: sp.y, w: sp.w, h: sp.h };
    console.log(`[6A] tp=26 旋转验证码 - slide_path 位置: (${sBox.x}, ${sBox.y}) ${sBox.w}x${sBox.h}`);

    // jcap slide_path 通常宽 290，高 48，需要拖动让图片转回 0 度
    // 经验值：拖动距离 ≈ 整条 track 的 60-80%
    const trackW = 290;  // slide_path 完整宽度
    const dragDist = trackW * 0.7;  // 拖 70% 距离

    const startX = sBox.x + 20;
    const startY = sBox.y + sBox.h / 2;
    const endX = startX + dragDist;

    console.log(`  从 (${startX}, ${startY}) 拖到 (${endX}, ${startY}) 距离 ${dragDist}px`);

    // 真人级悬停到拖动起点
    await realisticMouseMove(page, sp.x + 100, sp.y - 30, startX, startY, 1500);
    await sleep(500);
    await page.mouse.down();
    await sleep(150 + Math.random() * 200);

    // 沿贝塞尔曲线拖动 + 抖动 + 真人级节奏
    const N = 70;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      // 缓动：开始慢、加速、结束慢
      const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
      const baseX = startX + ease * dragDist;
      const baseY = startY;
      // 微抖动
      const noiseX = (Math.random() - 0.5) * 1.5;
      const noiseY = (Math.random() - 0.5) * 1.5;
      await page.mouse.move(baseX + noiseX, baseY + noiseY);
      // 节奏：开始慢、中间快、结束慢
      let dt;
      if (t < 0.15) dt = 35 + Math.random() * 25;
      else if (t < 0.85) dt = 15 + Math.random() * 18;
      else dt = 40 + Math.random() * 30;
      await sleep(dt);
    }
    await sleep(300);
    await page.mouse.up();
    console.log('  mouseup done (rotate)');
    await sleep(8000);
  } else if (captchaInfo.cpc) {
    const imgX = captchaInfo.cpc.x || 530;
    const imgY = captchaInfo.cpc.y || 282;
    const imgW = captchaInfo.cpc.w || 290;
    const imgH = captchaInfo.cpc.h || 179;

    // 6.1: 先用 OpenCV 检测 Z 形路径
    const cpcBase64 = await page.evaluate(() => {
      const cpc = document.querySelector('#cpc_img');
      return cpc ? cpc.src : null;
    });
    if (cpcBase64) {
      fs.writeFileSync('/tmp/jcap_v3.jpg', Buffer.from(cpcBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
      let points = null;
      try {
        points = JSON.parse(execSync(`python3 ${GEN_SCRIPT} /tmp/jcap_v3.jpg 200`, { encoding: 'utf-8' }));
      } catch (e) {
        console.log('  88 检测失败，用 fallback 对角线');
        points = null;
      }

      // 决定路径
      let drawPath = null;
      if (points && points.points && points.points.length >= 10) {
        drawPath = points.points;
        console.log(`  使用 88 生成的 ${drawPath.length} 个点`);
      } else {
        // fallback: 沿 cpc_img 画"自然"曲线（不规则折线 + 抖动）
        drawPath = [];
        const N = 60;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          // 起点 (30, 149) -> 终点 (260, 30) 的对角线 + 随机抖动
          const x = 30 + t * 230;
          const y = 149 - t * 119;
          // 加上抖动（10 像素内的曲线偏移）
          const noise = Math.sin(t * Math.PI * 3) * 8;
          drawPath.push({ x: x + noise + (Math.random() - 0.5) * 3, y: y + (Math.random() - 0.5) * 3 });
        }
        console.log(`  fallback: ${drawPath.length} 个点（对角线 + 抖动）`);
      }

      // 6.2: 先鼠标 hover 在 cpc_img 外（真实人行为）
      await realisticMouseMove(page, imgX + 100, imgY - 50, imgX + 50, imgY + 30, 1000);
      await sleep(500);

      // 6.3: 沿路径画
      const startX = imgX + drawPath[0].x;
      const startY = imgY + drawPath[0].y;
      // 移动到起点（不按下按钮 - 先 hover）
      await realisticMouseMove(page, imgX + 100, imgY - 50, startX, startY, 1500);
      await sleep(500);

      // 按下
      await page.mouse.down();
      await sleep(150 + Math.random() * 200);

      // 沿路径绘制（贝塞尔平滑 + 抖动）
      const N = drawPath.length;
      for (let i = 1; i < N; i++) {
        const p = drawPath[i];
        const x = imgX + p.x;
        const y = imgY + p.y;
        // 微抖动
        const nx = x + (Math.random() - 0.5) * 1.5;
        const ny = y + (Math.random() - 0.5) * 1.5;
        await page.mouse.move(nx, ny);
        // 节奏：开始慢、中间加速、结束慢
        const t = i / N;
        let dt;
        if (t < 0.15) dt = 40 + Math.random() * 30;
        else if (t < 0.85) dt = 15 + Math.random() * 20;
        else dt = 40 + Math.random() * 30;
        await sleep(dt);
      }
      await sleep(300);
      await page.mouse.up();
      console.log('mouseup done');
      await sleep(10000);
    }
  }

  // 步骤 7：输出所有响应
  console.log('\n=== /api/ 响应 ===');
  let first16807Seen = false;
  for (const r of respLog) {
    const ep = r.url.split('/').slice(-2).join('/');
    let j = null;
    try { j = JSON.parse(r.body); } catch (e) {}
    if (j) {
      const short = {};
      for (const k of ['code', 'msg', 'tp', 'st', 'vt', 'fp']) {
        if (k in j) short[k] = j[k] === '' ? '""' : (typeof j[k] === 'string' ? j[k].substring(0, 80) : j[k]);
      }
      console.log(`[${new Date(r.t).toISOString().slice(11, 19)}] ${ep}: ${JSON.stringify(short)}`);
      if (j.code === 0 && j.vt) {
        console.log('\n*** 拿到 vt! ***');
        console.log('  vt:', j.vt);
        console.log('  st:', j.st);
      }
    } else {
      console.log(`${ep}: ${r.body.substring(0, 200)}`);
    }
  }

  await browser.close();
})();
