#!/usr/bin/env node
/**
 * 京东完整登录协议化 - 一键测试
 * ==========================================
 *
 * 用法:
 *   node jd_login_run.js [username] [password]
 *
 * 流程:
 *   1. 打开真实 Chrome (heades stealth)
 *   2. 走 passport.jd.com 登录
 *   3. 触发 jdSlide 滑块
 *   4. 真实 mouse 拖动 + d 算法
 *   5. 拿 validate
 *   6. 协议化 loginService
 *   7. 输出 cookie
 */

const { JDLogin, JDSLIDE_D, gapDetect, generateTrajectory, LOGIN_SERVICE } = require('./jd_login_protocol');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const randomStr = (n) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

async function main() {
  const username = process.argv[2] || `jdtest${randomStr(6)}@163.com`;
  const password = process.argv[3] || `Pwd${randomStr(8)}!@#`;
  console.log(`[Run] USERNAME: ${username}`);
  console.log(`[Run] PASSWORD: ${password}`);

  const jd = new JDLogin({
    executablePath: '/opt/google/chrome/chrome',
    headless: 'new',
  });
  const result = await jd.login({ username, password });
  console.log('\n[Result]:', JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
