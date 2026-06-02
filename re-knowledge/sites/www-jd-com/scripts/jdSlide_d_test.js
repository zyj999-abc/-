/**
 * jdSlide 协议化 d 参数算法 - 自测
 */

const { string10to64, prefixInteger, pretreatment, getCoordinate } = require('./jdSlide_d.js');

// 测试 string10to64
console.log('=== string10to64 ===');
console.log('0   =', string10to64(0));    // 期望 '0'
console.log('1   =', string10to64(1));    // 期望 '1'
console.log('9   =', string10to64(9));    // 期望 '9'
console.log('10  =', string10to64(10));   // 期望 'a'
console.log('35  =', string10to64(35));   // 期望 'z'
console.log('36  =', string10to64(36));   // 期望 'A'
console.log('61  =', string10to64(61));   // 期望 'Z'
console.log('62  =', string10to64(62));   // 期望 '-'
console.log('63  =', string10to64(63));   // 期望 '~'
console.log('64  =', string10to64(64));   // 期望 '10'
console.log('100 =', string10to64(100));  // 期望 '1E' (1*64+36 = 100)
console.log('108 =', string10to64(108));  // 期望 '1W' (1*64+44=108, 44='s'? 不, 's'=44?)
// 0=0, 1=1... 9=9, 10=a... 35=z, 36=A... 61=Z, 62=-, 63=~
// 64 = 1*64+0 = '10'
// 108 = 1*64+44 = 44-10=34 = 'y'? 0=0... 9=9, 10=a, 11=b, 12=c, 13=d, 14=e, 15=f, 16=g, 17=h, 18=i, 19=j, 20=k, 21=l, 22=m, 23=n, 24=o, 25=p, 26=q, 27=r, 28=s, 29=t, 30=u, 31=v, 32=w, 33=x, 34=y, 35=z, 36=A, 37=B, 38=C, 39=D, 40=E, 41=F, 42=G, 43=H, 44=I
// 108 = 1*I = '1I' ?
console.log('108 =', string10to64(108));

console.log('\n=== prefixInteger ===');
console.log("prefixInteger('abc', 5) =", prefixInteger('abc', 5));  // 00abc
console.log("prefixInteger('abc', 2) =", prefixInteger('abc', 2));  // bc

console.log('\n=== pretreatment ===');
console.log("pretreatment(0, 3, true) =", pretreatment(0, 3, true));         // 000
console.log("pretreatment(108, 4, true) =", pretreatment(108, 4, true));   // 01IW (108='1I', pad to 4)
console.log("pretreatment(5, 2, false) =", pretreatment(5, 2, false));     // 15 (sign=1, padded '5' to '5')
console.log("pretreatment(-5, 2, false) =", pretreatment(-5, 2, false));   // 05

console.log('\n=== getCoordinate ===');
// 模拟一个简单 mousePos
const mp = [
  [201, 121, 1717293600000],  // 起点
  [215, 122, 1717293600030],
  [230, 121, 1717293600060],
  [245, 122, 1717293600090],
  [260, 121, 1717293600120],
];
const d = getCoordinate(mp);
console.log('mousePos:', JSON.stringify(mp));
console.log('d =', d);
console.log('d 长度:', d.length);
// 14 (3+4+7) + 4*11 = 58
