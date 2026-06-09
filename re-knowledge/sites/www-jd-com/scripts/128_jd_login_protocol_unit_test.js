#!/usr/bin/env node
/**
 * 128_jd_login_protocol_unit_test.js
 *
 * 单元测试 jd_login_protocol.js 的非 Chrome 部分
 * - 模块加载
 * - H5ST_5_3.signH5st
 * - JDSLIDE_D.getCoordinate
 * - LOGIN_SERVICE 字段完整性
 */

const assert = require('assert');

console.log('========================================');
console.log('  京东协议化登录模块 - 单元测试');
console.log('========================================\n');

let passed = 0, failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
};

console.log('[Test 1] 模块加载');
const mod = require('./jd_login_protocol');
test('JDLogin 导出', () => assert(typeof mod.JDLogin === 'function'));
test('H5ST_5_3 导出', () => assert(mod.H5ST_5_3 && mod.H5ST_5_3.algorithm));
test('RSA_PWD_ENC 导出', () => assert(mod.RSA_PWD_ENC && mod.RSA_PWD_ENC.encrypt));
test('JDSLIDE_D 导出', () => assert(mod.JDSLIDE_D && mod.JDSLIDE_D.getCoordinate));
test('LOGIN_SERVICE 导出', () => assert(mod.LOGIN_SERVICE && mod.LOGIN_SERVICE.url));

console.log('\n[Test 2] H5ST_5_3.signH5st');
test('签名结果非空', () => {
  const sig = mod.H5ST_5_3.signH5st('test_token_12345', 'test_content_abc');
  assert(sig && sig.length === 64, `h5st 签名长度应为 64 (SHA256 hex), 实际 ${sig?.length}`);
});
test('同输入同输出', () => {
  const a = mod.H5ST_5_3.signH5st('token', 'content');
  const b = mod.H5ST_5_3.signH5st('token', 'content');
  assert(a === b, '相同输入应产生相同签名');
});
test('不同输入不同输出', () => {
  const a = mod.H5ST_5_3.signH5st('token1', 'content');
  const b = mod.H5ST_5_3.signH5st('token2', 'content');
  assert(a !== b, '不同 token 应产生不同签名');
});

console.log('\n[Test 3] JDSLIDE_D.getCoordinate');
test('单点 P0 编码', () => {
  // P0: x(3) + y(4) + t(7) isFirst=true
  const result = mod.JDSLIDE_D.getCoordinate([[100, 200, 1234567890123]]);
  assert(result && result.length > 0, 'getCoordinate 应返回非空字符串');
  assert(/^[0-9a-zA-Z\-~]+$/.test(result), `d 参数只应包含自定义 64 字符集字符: ${result}`);
});
test('多点 P0+P1+ 编码', () => {
  // 模拟真实拖动轨迹
  const points = [
    [0, 0, 1000000],
    [10, 0, 1000020],
    [30, 1, 1000050],
    [80, -1, 1000100],
    [150, 0, 1000180],
    [220, 0, 1000260],
  ];
  const result = mod.JDSLIDE_D.getCoordinate(points);
  assert(result && result.length >= 60, `多点 d 参数应足够长: ${result.length}`);
});
test('差分编码正确性', () => {
  // 验证 pretreatment 的正负号
  const pos = mod.JDSLIDE_D.pretreatment(100, 3, false);
  const neg = mod.JDSLIDE_D.pretreatment(-100, 3, false);
  assert(pos.startsWith('1'), '正数应该 1 开头');
  assert(neg.startsWith('0'), '负数应该 0 开头');
});

console.log('\n[Test 4] LOGIN_SERVICE 字段完整性');
test('URL 正确', () => assert(mod.LOGIN_SERVICE.url === 'https://passport.jd.com/uc/loginService'));
test('方法 POST', () => assert(mod.LOGIN_SERVICE.method === 'POST'));
test('Content-Type', () => assert(mod.LOGIN_SERVICE.contentType.includes('application/x-www-form-urlencoded')));
test('22+ 字段', () => {
  assert(mod.LOGIN_SERVICE.fields.length >= 22, `至少 22 字段, 实际 ${mod.LOGIN_SERVICE.fields.length}`);
});
test('jcap vt 字段名', () => {
  const has = mod.LOGIN_SERVICE.fields.some(f => f.includes('verifycode'));
  assert(has, 'LOGIN_SERVICE 应包含 verifycode (jcap vt) 字段');
});

console.log('\n[Test 5] RSA_PWD_ENC');
test('publicKey 存在', () => assert(mod.RSA_PWD_ENC.publicKey && mod.RSA_PWD_ENC.publicKey.length > 100));
test('encrypt 函数存在', () => assert(typeof mod.RSA_PWD_ENC.encrypt === 'function'));
test('超长密码抛错', () => {
  try {
    mod.RSA_PWD_ENC.encrypt('a'.repeat(200));
    assert.fail('应该抛错');
  } catch (e) {
    assert(e.message.includes('too long'));
  }
});

console.log('\n[Test 6] JCAP_2_8_5');
test('algorithm 描述', () => assert(mod.JCAP_2_8_5.algorithm && mod.JCAP_2_8_5.algorithm.includes('行为验证')));
test('domain 正确', () => assert(mod.JCAP_2_8_5.domain === 'jcap.m.jd.com'));
test('3 个 interfaceId', () => {
  assert(mod.JCAP_2_8_5.interfaces.fp);
  assert(mod.JCAP_2_8_5.interfaces.check);
  assert(mod.JCAP_2_8_5.interfaces.verify);
});
test('bypass_strategy', () => {
  assert(mod.JCAP_2_8_5.bypass_strategy && mod.JCAP_2_8_5.bypass_strategy.includes('用户手动'));
});

console.log('\n[Test 7] JDLogin 类');
test('可实例化', () => {
  const jd = new mod.JDLogin({ headless: false });
  assert(jd);
  assert(jd.headless === false);
});
test('默认参数', () => {
  const jd = new mod.JDLogin();
  assert(jd.headless === false, 'headless 默认 false');
  assert(jd.useStealth === true, 'useStealth 默认 true');
  assert(jd.jcapTimeoutMs === 90000, 'jcapTimeoutMs 默认 90000');
});

console.log('\n========================================');
console.log(`  测试结果: ${passed} 通过 / ${failed} 失败`);
console.log('========================================');
if (failed === 0) {
  console.log('  🎉 全部通过！');
  process.exit(0);
} else {
  console.log('  ❌ 有失败项');
  process.exit(1);
}
