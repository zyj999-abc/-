#!/usr/bin/env node
/**
 * 127_jd_login_demo.js
 *
 * 端到端协议化京东登录 - 用户使用示例
 *
 * 重要：本机环境必须有 X server（能看到浏览器窗口）+ Chrome 浏览器
 * 用法：
 *   1. 在有 X server 的本机安装 puppeteer + chrome
 *   2. 修改下方的 JD_USERNAME / JD_PASSWORD 为真实账号
 *   3. 跑：node 127_jd_login_demo.js
 *   4. 浏览器自动打开 → 脚本自动输入账号密码 → 触发 jcap 弹窗
 *   5. 看到 jcap 弹窗后**手动操作**（拖动 / 画线 / 旋转）通过验证
 *   6. 脚本自动捕获 vt + 协议化 loginService → 拿 pt_key/pt_pin
 *
 * 输出：
 *   - 控制台打印 cookie 串
 *   - 保存到 /tmp/jd_login_success.json
 */

const { JDLogin } = require('./jd_login_protocol');

// ============================================
// 用户配置 - 改成你自己的账号
// ============================================
const JD_USERNAME = process.env.JD_USERNAME || 'your_jd_account@163.com';
const JD_PASSWORD = process.env.JD_PASSWORD || 'your_password_here';

// Chrome 路径（可自动检测 / 环境变量 / 显式指定）
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

(async () => {
  console.log('========================================');
  console.log('  京东端到端协议化登录 Demo');
  console.log('========================================\n');

  // 找 Chrome
  const fs = require('fs');
  let chromePath = null;
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) {
      chromePath = p;
      break;
    }
  }
  if (!chromePath) {
    console.log('⚠️  未找到 Chrome，请设置 CHROME_PATH 环境变量');
    console.log('   搜索路径:');
    for (const p of CHROME_PATHS) console.log(`     - ${p}`);
  } else {
    console.log(`✅ 找到 Chrome: ${chromePath}`);
  }

  // 启动 JDLogin（必须 headless: false 才能看到 jcap 弹窗手动过）
  const jd = new JDLogin({
    executablePath: chromePath,
    headless: false,           // 关键：必须 false 才能看到 jcap 弹窗
    useStealth: true,          // 启用 stealth 绕过 webdriver 检测
    jcapTimeoutMs: 120000,     // 等用户手动过 jcap 的超时（120 秒）
  });

  console.log(`\n[1] 启动浏览器，访问京东...`);
  console.log(`[2] 自动输入账号密码: ${JD_USERNAME}`);
  console.log(`[3] 触发 jcap 弹窗`);
  console.log(`[4] ⏳ 请在浏览器中手动操作 jcap 弹窗（拖动/画线/旋转）`);
  console.log(`[5] 通过后脚本自动协议化 loginService 拿 cookie\n`);

  try {
    const result = await jd.login({ username: JD_USERNAME, password: JD_PASSWORD });

    if (result.success) {
      console.log('\n🎉 ========================================');
      console.log('   登录成功！');
      console.log('   ========================================');
      console.log(`\n   pt_key:  ${result.cookies.pt_key.substring(0, 60)}...`);
      console.log(`   pt_pin:  ${result.cookies.pt_pin}`);
      console.log(`   \n   Cookie 串（复制使用）:\n   ${result.cookieStr}\n`);

      // 后续可调用京东任意接口
      console.log('   示例 - 用此 cookie 调用京东 API:');
      console.log(`   curl -H "Cookie: ${result.cookieStr}" https://passport.jd.com/user/petName/getUserInfoForMiniJd`);
    } else {
      console.log('\n❌ 登录失败');
      console.log(`   原因: ${result.message}`);
      if (result.loginResponse) {
        console.log(`   loginService 响应: ${result.loginResponse.substring(0, 500)}`);
      }
      console.log('\n   可能原因:');
      console.log('   1. 账号/密码错误');
      console.log('   2. jcap 验证超时（120 秒内没手动通过）');
      console.log('   3. 触发了二次验证（手机验证码 / 邮箱验证码）');
      console.log('   4. 触发了风控（rescue URL）');
    }
  } catch (err) {
    console.error('\n❌ 异常:', err.message);
    console.error(err.stack);
  }
})();
