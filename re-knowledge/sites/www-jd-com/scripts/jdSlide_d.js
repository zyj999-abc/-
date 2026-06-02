/**
 * jdSlide 协议化 d 参数算法 (Node.js 端独立模块)
 *
 * 从 slide_6.1.2.min.js 还原:
 *   - string10to64: 数字转 base64 字符串
 *   - prefixInteger: 字符串左侧补 0
 *   - pretreatment: 编码单个数字 (带/不带符号位)
 *   - getCoordinate: 编码整个 mousePos 数组
 */

// jdSlide 自定义 base64 字符集 (顺序固定)
const CHARS_64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-~';

/**
 * 数字转 base64 字符串
 * @param {number} a - 数字
 * @returns {string} base64 编码
 */
function string10to64(a) {
  let n = Number(a);
  const c = CHARS_64.length;
  const e = [];
  do {
    const mod = n % c;
    n = (n - mod) / c;
    e.unshift(CHARS_64[mod]);
  } while (n);
  return e.join('');
}

/**
 * 字符串左侧补 0 到指定长度
 * @param {string} a - 原字符串
 * @param {number} b - 目标长度
 * @returns {string} 补 0 后的字符串
 */
function prefixInteger(a, b) {
  return (Array(b).join(0) + a).slice(-b);
}

/**
 * 编码单个数字
 * @param {number} a - 数字
 * @param {number} b - 编码长度
 * @param {boolean} isFirst - 是否是第一个点 (true: 不加符号位)
 * @returns {string} 编码字符串
 */
function pretreatment(a, b, isFirst) {
  const numA = Number(a);
  const e = string10to64(Math.abs(numA));
  let f = '';
  if (!isFirst) {
    f += numA > 0 ? '1' : '0';
  }
  f += prefixInteger(e, b);
  return f;
}

/**
 * 编码 mousePos 数组为 d 参数
 *
 * mousePos 格式: [[x, y, t], [x, y, t], ...]
 * 第一个点用 pretreatment(x, 3, true) + pretreatment(y, 4, true) + pretreatment(t, 7, true)
 * 后续点用 delta: sign + pretreatment(dx, 2) + sign + pretreatment(dy, 2) + sign + pretreatment(dt, 4)
 *
 * @param {Array<Array<number>>} mousePos - 鼠标轨迹
 * @returns {string} d 参数
 */
function getCoordinate(mousePos) {
  const c = [];
  for (let d = 0; d < mousePos.length; d++) {
    if (d === 0) {
      // 第一个点: 不带符号位
      c.push(pretreatment(
        mousePos[d][0] < 0x3ffff ? mousePos[d][0] : 0x3ffff,
        3,
        true
      ));
      c.push(pretreatment(
        mousePos[d][1] < 0xffffff ? mousePos[d][1] : 0xffffff,
        4,
        true
      ));
      c.push(pretreatment(
        mousePos[d][2] < 0x3ffffffffff ? mousePos[d][2] : 0x3ffffffffff,
        7,
        true
      ));
    } else {
      // 后续点: delta 编码
      const e = mousePos[d][0] - mousePos[d - 1][0];
      const f = mousePos[d][1] - mousePos[d - 1][1];
      const g = mousePos[d][2] - mousePos[d - 1][2];
      c.push(pretreatment(
        e < 0xfff ? e : 0xfff,
        2,
        false
      ));
      c.push(pretreatment(
        f < 0xfff ? f : 0xfff,
        2,
        false
      ));
      c.push(pretreatment(
        g < 0xffffff ? g : 0xffffff,
        4,
        false
      ));
    }
  }
  return c.join('');
}

module.exports = {
  string10to64,
  prefixInteger,
  pretreatment,
  getCoordinate,
  CHARS_64,
};
