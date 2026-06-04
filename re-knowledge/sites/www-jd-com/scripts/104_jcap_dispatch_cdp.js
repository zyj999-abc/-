#!/usr/bin/env node
/**
 * 104_jcap_dispatch_via_cdp.js
 *
 * 通过 CDP 直接 attach 到 jcap 的 frame/target
 * 在 jcap 实际上下文中 inspect w 实例
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

  // patch: 让 SDK 把所有 w/k 暴露到 window
  await cdp.on('Fetch.requestPaused', async (event) => {
    try {
      const resp = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
      let body = resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf-8') : resp.body;

      // 暴露 w 实例 (w = new a["Cap" + ... + "bly"](i))
      body = body.replace(/(w=new\(a\["Cap")/, ';window.__w=w=$1');

      // 暴露 k/x/M/F/N/R/G 函数
      const exposures = [
        ['k=function(A){var t={};function e(A,t){return S(t- -608,A)}', 'k'],
        ['x=function(A){var t={};function e(A,t){return S(t- -356,A)}', 'x'],
        ['M=function(A){var t={};function e(A,t){return S(A- -303,t)}', 'M'],
        ['F=function(A){var t={};function e(A,t){return S(t- -737,A)}', 'F'],
        ['N=function(A){var t={};function e(A,t){return S(A- -1517,t)}', 'N'],
        ['R=function(A,t){try{return w?w[function(A,t){return S(t- -187,A)}(704,690)+"se"](A,t):{}}catch(A){return{}}}', 'R'],
        ['G=function(A,t,e){var n={};function r(A,t){return S(A- -263,t)}', 'G'],
      ];
      for (const [v, name] of exposures) {
        if (body.includes(v)) {
          body = body.replace(v, v + ';window.__' + name + '=' + name + ';');
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
      console.log('Fetch error:', e.message);
      try { await cdp.send('Fetch.continueRequest', { requestId: event.requestId }); } catch (_) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  // 触发 jcap
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
      // 不在 main page 上 evaluate，避免 detached
      // 用 puppeteer 内部 count selector
      try {
        const r = await page.$('#cpc_img, #curve_main_img, #main_img');
        if (r) { console.log('触发 click=' + i); triggered = true; break; }
      } catch (e) {
        console.log('selector error:', e.message);
      }
    }
    if (triggered) break;
    await sleep(3000);
  }
  await sleep(8000);

  // 用 CDP list targets 找到 jcap 的 target
  const client = await page.target().createCDPSession();
  const targetsResp = await client.send('Target.getTargets');
  console.log('\n=== 所有 targets ===');
  for (const t of targetsResp.targetInfos) {
    console.log(`  ${t.type}: ${t.url.substring(0, 80)} (targetId: ${t.targetId})`);
  }

  // 找 jcap 相关的 target (worker 或 page)
  const jcapTarget = targetsResp.targetInfos.find(t => t.url && (t.url.includes('jcap') || t.url.startsWith('blob:')));
  if (!jcapTarget) {
    console.log('No jcap target found');
  } else {
    console.log('\n找到 target:', jcapTarget.url.substring(0, 80));
    console.log('type:', jcapTarget.type, 'targetId:', jcapTarget.targetId);

    // attach to target
    const jcapCdp = await client.send('Target.attachToTarget', {
      targetId: jcapTarget.targetId,
      flatten: true,
    });
    const jcapSessionId = jcapCdp.sessionId;

    // 在 jcap target 中 evaluate
    const evalResult = await client.send('Runtime.evaluate', {
      expression: `
        (() => {
          const w = (typeof window !== 'undefined' && window.__w) || (typeof self !== 'undefined' && self.__w);
          const k = (typeof window !== 'undefined' && window.__k) || (typeof self !== 'undefined' && self.__k);
          if (!w) return { error: 'no w', hasWindow: typeof window !== 'undefined', hasSelf: typeof self !== 'undefined' };
          const proto = Object.getPrototypeOf(w);
          return {
            wCtor: w.constructor.name,
            protoMethods: Object.getOwnPropertyNames(proto).filter(n => typeof w[n] === 'function'),
            ownMethods: Object.getOwnPropertyNames(w).filter(n => typeof w[n] === 'function'),
            hasGetTKData: typeof w.getTKData,
            hasParse: typeof w.parse,
            hasK: !!k,
            kType: typeof k,
          };
        })()
      `,
      returnByValue: true,
    }, jcapSessionId);

    console.log('\n=== Jcap target eval ===');
    console.log(JSON.stringify(evalResult.result?.value || evalResult, null, 2));

    // 测试调用 getTKData
    if (!evalResult.result?.value?.error) {
      const tkTest = await client.send('Runtime.evaluate', {
        expression: `
          (() => {
            try {
              const r = window.__w.getTKData(['test_si', 'test_st', 'test_xyList', '{}']);
              return { ok: true, type: typeof r, len: r ? r.length : 0, sample: r ? r.substring(0, 100) : null };
            } catch(e) { return { ok: false, err: e.message, stack: e.stack ? e.stack.substring(0, 200) : null }; }
          })()
        `,
        returnByValue: true,
      }, jcapSessionId);
      console.log('\n=== getTKData test ===');
      console.log(JSON.stringify(tkTest.result?.value || tkTest, null, 2));
    }
  }

  await browser.close();
})();
