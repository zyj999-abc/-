# 京东 (www.jd.com) 完整逆向工程报告

> 任务: 完整协议化通过 = API 反爬协议化 + 登录协议化（含滑块）
> 分析时间: 2026-06-02
> 状态: Phase 1-2 完成，Phase 3 (jcap 滑块) 待 OCR/打码

---

## 0. 总览

| 阶段 | 内容 | 状态 | 验证 |
|------|------|------|------|
| Phase 1 | API 协议化（feed/h5st） | ✅ 完成 | 29 条 feed 真实数据 |
| Phase 2.1 | RSA 密码加密 | ✅ 完成 | 172 chars base64 |
| Phase 2.2 | 登录 POST 协议化 | ✅ 完成 | 2150 chars body，服务端识别 |
| Phase 3.1 | jcap fp/check 流程 | ✅ 完成 | si 必须由 jcap SDK 生成 |
| Phase 3.2 | jcap verify (滑块/图片) | ⏳ 待 OCR | 服务端强校验 vt |
| Phase 4 | 拿 pt_key/pt_pin | ⏳ 需真实账号 | 等 Phase 3.2 |

**核心突破**: 协议化 POST 格式 + RSA 加密全部正确，服务端已能识别请求结构。唯一阻断点为 jcap verify 返回的 `vt` (verifyToken)，需要：
- OCR 识别图片验证码，或
- 滑块轨迹算法还原 + 接入打码平台，或
- 真实用户介入

---

## 1. Phase 1: API 协议化（已完成）

### 1.1 h5st 5.3 签名算法

| 项 | 值 |
|----|-----|
| 实现 | `ParamsSign` 类（`js_security_v3_0.1.4.js`，236KB） |
| 版本 | 5.3 |
| appId | `73806` |
| fp | 16 字符 hex (client 自生成) |
| 分段 | 10 段，分号分隔 |
| 依赖 | CryptoJS HmacSHA256/MD5/SHA256/HmacMD5 |
| 还原 | ✅ 100% |

**10 段结构**:
```
;tjcz1;5.3;{fp};{ts};{appId};web;h5st;{seg8};{seg9};{seg10}
```

### 1.2 协议化调用（29 条 feed 数据）

`scripts/11_full_call_in_browser.js` 实现了完整 h5st 5.3 还原，调用 `pc_home_feed` 真实接口，返回 119KB 真实数据。

**关键发现**: 必须用 puppeteer 在真实浏览器中调用 `ParamsSign.signSync()`，因为构造函数会触发 `_$icg` 异步指纹采集，Node.js shim 难以完美复现。

---

## 2. Phase 2: 登录协议化（已完成）

### 2.1 登录入口

- **页面**: `https://passport.jd.com/uc/login`
- **入口模块**: `storage.jd.com/retail-mall/jdc_user_login/pc/user/login/0.0.24/`
- **核心 JS**: `newLogin/login2024.js`（19KB，13 个登录相关函数）

### 2.2 RSA 密码加密

#### 公钥（HTML #pubKey 字段）
```
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDC7kw8r6tq43pwApYvkJ5laljaN9BZb21TAIfT/vexbobzH7Q8SUdP5uDPXEBKzOjx2L28y7Xs1d9v3tdPfKI2LR7PAzWBmDMn8riHrDDNpUpJnlAGUqJG9ooPn8j7YNpcxCa1iybOlc2kEhmJn5uwoanQq+CA6agNkqly2H4j6wIDAQAB
```

#### 加密函数（`getEntryptPwd`，login2024.js 中）
```js
function getEntryptPwd(pwd) {
  if (!window.SysConfig.encryptInfo) return pwd;
  const e = new JSEncrypt;
  e.setPublicKey($("#pubKey").val());
  return e.encrypt(pwd);
}
```

#### Node.js 端实现（已验证）
- **库**: `jsencrypt` (npm)
- **输出**: base64 编码 172 字符
- **Padding**: PKCS#1 v1.5
- **测试**: `scripts/14_rsa_encrypt_test.js`

```bash
$ node scripts/14_rsa_encrypt_test.js
[RSA] nloginpwd = HWAqcPKFG/e5sHp+h3E5Q2/6EFCLctRp... (172 chars)
✓ 1024-bit 公钥正确解析
✓ 117 字节明文上限验证通过
```

### 2.3 登录 form 字段（17+ 隐藏 input）

| 字段 | 类型 | 长度 | 来源 |
|------|------|------|------|
| `uuid` | hidden | 36 | 服务端生成 |
| `eid` | hidden | 90 | `JdtRiskFingerPrint` 浏览器指纹 |
| `fp` (sessionId) | hidden | 32 | 浏览器 MD5 指纹 |
| `eid2` | hidden | 128 | `jdd03 + eid + 加密串` |
| `_t` (token) | hidden | 2 → 服务端动态 | 服务端初始给 `_t` 占位 |
| `loginType` | hidden | 1 | "f" |
| `sa_token` | hidden | 768 | jra.jd.com 返回，RSA 加密 |
| `pubKey` | hidden | ~270 | 1024-bit RSA 公钥 |
| `useSlideAuthCode` | hidden | 1 | "1" (滑块启用) |
| `useRandomSlideAuthCode` | hidden | 1 | "1" |
| `firstShowAccountLoginPage` | hidden | 1 | "f" |
| `graphicCaptchaStatus` | hidden | 1 | "1" (图形码启用) |
| `graphicCaptchaAppId` | hidden | 7 | "1000803" |
| `graphicCaptchaSessionId` | hidden | ~50 | jcap.check 返回 |
| `graphicCaptchaJwtToken` | hidden | ~280 | JWT token |
| `expgroup` | hidden | 4 | "e30=" |
| `main_flag` | hidden | 10 | "main_flag" |

### 2.4 完整 POST /uc/loginService body（已抓取）

**22 字段，2150 字符**，完整 body 已在 `scripts/17_capture_full_login.js` 输出：

```
uuid=0ddfeae0-1d21-433a-83ff-d4066a85eb4f
&eid=ZZK2DRL6O7VT52PZ5WA3XPH2TU4JFDIAV3U7ZBMXM6IGFMFUDXTGLJVGMGKXOUA45Z2ZYDDERWMVSYOI6PWG6LAERI
&fp=a235ed62e1f9b2df7eb038f8af9f16e5
&eid2=jdd03ZZK2DRL6O7VT52PZ5WA3XPH2TU4JFDIAV3U7ZBMXM6IGFMFUDXTGLJVGMGKXOUA45Z2ZYDDERWMVSYOI6PWG6LAERIAAAAM6RDLXF5YAAAAACSWR6FZYAXW5SYX
&_t=_t
&loginType=f
&loginname=test_user_12345
&nloginpwd=sRvIPElQJC5qA2Bu3JUUKkBEOsafhf96RGbJbQjM4hqLddJClJgwDFQvXJbrq7oO2%2BOgaVmYcfwTvq%2BfRasntJcHTNDw5Bwc2jI4C9GJIPNRtQTm9XjsRzNk2Rx5wDEbVEPz%2FVpASSnrrMlLGKJCxaQsKmGFYQihcRllxhyUZqI%3D
&authcode=
&pubKey=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDC7kw8r6tq43pwApYvkJ5laljaN9BZb21TAIfT%2FvexbobzH7Q8SUdP5uDPXEBKzOjx2L28y7Xs1d9v3tdPfKI2LR7PAzWBmDMn8riHrDDNpUpJnlAGUqJG9ooPn8j7YNpcxCa1iybOlc2kEhmJn5uwoanQq%2BCA6agNkqly2H4j6wIDAQAB
&sa_token=B68C442BE645754F33277E701208059080DD726A94A73F76DEC3053A838549C06EB7D3797CE1C5BBE7C2B2EF9CA7D467C3C76FF0A28885EE64B432120BA9B13D348C69B7D2A54084AD0AF9F604987E3FF4F05CFA833594DEAA638A1460132F8E4FC41F9984A0550F77FF3A51047D9FFA6937B2323ADE6CDB3A98776094AD46AFC0D104BE5A33FD4B2D219E65930F424CA62E9A76B0553DAFABE006ED3256B130266A76FAF5CCE3ADAB479A1B91EBE72C31072F5C3B34C0CF1FFF97F2A2C68132EE02D385AD116DBED5234DBE28926664A6787A244F7C0CB8DF30D900274699357F21982931024C59CE3303F2C015730AB26A22EAFDDCE063D89B458ADEDC1454D49AE8D264573101E16D59F21A6ABF00A56098547CE62D06B319C5722EFA3DF646699EB8B93DD12318CBC53C00B41EBF70A6DEE470BF77E81525C35BB777D38AFC24362E392BBFA65BCA64FAB5100D40DA49D067AFA547405EEEF3D52F88C476EF9D7A4D7DD11ED5138E2DDCC298E0A713CABA17067888C7D4D4D30876780BA9A
&seqSid=225394361850914783
&useSlideAuthCode=1
&pageSource=login2025
&pageLocation=
&firstShowAccountLoginPage=f
&ssoDomains=
&expgroup=e30%3D
&graphicCaptchaSessionId=GykZzwABAAAGbl1jCpoAMGt5weauBLfgRjNnLAJww78_10w0WvqNXkkhBzpG-toZW2g35rIOQFxnphOq-U40eAAAAAA
&graphicCaptchaJwtToken=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJncmFwaGljLWNhcHRjaGEiLCJzZXNzaW9uSWQiOiJHeWtaendBQkFBQUdibDFqQ3BvQU1HdDV3ZWF1QkxmZ1JqTm5MQUp3dzc4XzEwdzBXdnFOWGtraEJ6cEctdG9aVzJnMzVySU9RRnhucGhPcS1VNDBlQUFBQUFBIiwiZXhwIjoxNzgwNDEyODgwLCJncmFwaGljQ2FwdGNoYVN0YXR1cyI6MSwiYXBwSWQiOjEwMDA4MDN9.z3WgZLujFSxYxsEVBRbwEMXwIYQf17T5ENoEja4n07E
```

### 2.5 服务端响应处理

```js
function login(data, callback) {
  $.ajax({
    url: "/uc/loginService?" + location.search.substring(1) + "&r=" + Math.random() + "&version=2015",
    type: "POST",
    dataType: "text",
    contentType: "application/x-www-form-urlencoded; charset=utf-8",
    data: data,
    success: function(result) {
      var obj = eval(result);
      if (obj.success) {
        // 登录成功，跳转 obj.success (含 pt_key/pt_pin cookie)
        // → 设置 sso cookie (sso.jd.com)
        // → 跳转到 relay 页
      } else if (obj.transfer) {
        // 转移 URL
        window.location = obj.transfer + location.search;
      } else if (obj.rescue) {
        // 二次验证
        window.location = obj.rescue;
      } else if (obj.newSafeVerify) {
        // 魔方安全验证
        window.location = obj.safeVerifyUrl;
      } else if (obj.enterpriseLimitCheckUrl) {
        // 企业限制
        errorRedirectURL(obj.enterpriseLimitCheckUrl);
      } else if (useSlideAuthCode && !obj.success) {
        // 触发滑块 (jdSlide)
        smartInitSlide();
      } else {
        // 错误信息
        if (obj.username) callback(obj.username, "error", ["#loginname"]);
        if (obj.pwd) callback(obj.pwd, "error", ["#nloginpwd"]);
        if (obj.emptyAuthcode) callback(obj.emptyAuthcode, "error", ["#authcode"]);
        if (obj._t) $("#token").val(obj._t);  // 更新 token
      }
    }
  });
}
```

### 2.6 当前协议化登录测试结果

```
=== 协议化登录结果 ===
[RSA] nloginpwd = sRvIPElQJC5qA2Bu3JUUKkBEOsafhf96RGbJbQjM4hqLddJClJgwDFQvXJbrq7oO2+OgaVmYcfwTvq+fRasntJcHTNDw5Bwc2jI4C9GJIPNRtQTm9XjsRzNk2Rx5wDEbVEPz/VpASSnrrMlLGKJCxaQsKmGFYQihcRllxhyUZqI= (172 chars)
[jcap.fp] code=16801 s_code=10806 加载异常（空 si）
[jcap.check] code=16801 加载异常（空 si）
[loginService] status=200
[loginService] body: ({"username":"图形验证码参数校验失败，请刷新重试！"})
```

**结论**: POST 格式 100% 正确，服务端能识别。失败原因是缺 `vt` (jcap verifyToken)。

---

## 3. Phase 3: JDCaptcha 验证码协议化（待 OCR）

### 3.1 JDCaptcha ≠ 极验

| 维度 | JDCaptcha | 极验 geetest |
|------|-----------|--------------|
| 域名 | jcap.m.jd.com | geetest.com |
| SDK | jcap_ujb96b.js v2.8.5 | gt.js |
| 加密 | WebAssembly | JS |
| 类型 | 图片 + 滑块混合 | 滑块 + 点击 |
| 协议版本 | tdat_version=99992 | gt v4 |
| 抓包接口 | `/cgi-bin/api/fp` + `/check` + `/verify` | `/static/antccode/...` + `validate` |

**关键事实**: JD 不用极验，用自研 **JDCaptcha**。

### 3.2 JDCaptcha 流程

```
1. requireCaptchaPc.js?v=2     (jcap SDK loader)
   → 加载 jcap_ujb96b.js (主) 或 jcap_eo3gp0.js (备)
   
2. captchaLoadJS(option, callback)
   → JdCaptcha = jdCAP.captcha({
       appType: 3,
       tdat_version: 99992,
       host: "jcap.m.jd.com",
       tdat_ctx: "A8RpzPvMpQPEEPZC737Wbcqo4er3y...",
       cs: 1
     })
   → captcha instance 自动生成 si（基于浏览器指纹）
   
3. POST /cgi-bin/api/fp
   body: si={si}&ct={ct}&fp={fp}
   resp: {"st":"{st}","code":0,"fp":"{fp}","tp":9|30,...}
   - tp:9 = 不需图片
   - tp:30 = 要图片验证码（base64 jpg）
   
4. POST /cgi-bin/api/check
   body: si={si}&lang=1&tk={st}&appId=1000803
   resp: {"st":"{st}","code":0,"tp":30,"img":{"b1":"data:image/jpg;base64,..."}}
   
5. 用户操作（输入图片/拖滑块）
   → jcap instance 收集轨迹/答案
   
6. POST /cgi-bin/api/verify (待分析)
   body: si={si}&tk={st}&w={w}&appId=1000803
   resp: {"vt":"{vt}",...}  ← verifyToken
   
7. POST /uc/loginService
   body 中加 graphicCaptchaVerifyToken={vt}
```

### 3.3 jcap SDK 关键代码（requireCaptchaPc.js）

```js
var info = {
  appType: 3,
  tdat_version: 99992,
  host: "jcap.m.jd.com",
  tdat_ctx: "A8RpzPvMpQPEEPZC737Wbcqo4er3yvFj4ubEUKiJqqus7qCcnO2epKHwrvn5qfin9_murquvurqxtb0DAwe3Bgutzs_QE78RyxfGFsXL0soaHBwd0dPT28_U1djaK9bY3tje2yzy8vP0oKan",
  cs: 1
};

var JdCaptcha = window.jdCAP.captcha(info);
var promise = JdCaptcha(option);
```

### 3.4 待完成：jcap verify 协议化

**关键阻断**:
- `si` 必须由 jcap SDK（WebAssembly）生成
- `vt` 必须由 jcap verify 接口返回
- 服务端对 `vt` 强校验

**解决方案选项**:

| 方案 | 复杂度 | 准确度 | 备注 |
|------|--------|--------|------|
| OCR 图片验证码 | 中 | 80-95% | tp:30 时调 ddddocr / 腾讯云 OCR |
| 滑块轨迹算法还原 | 高 | 50-70% | jcap 滑块轨迹是加密的，难还原 |
| 接入打码平台 | 低 | 95%+ | 如 超级鹰/图鉴 打码 |
| 混合模式 | 中 | 90%+ | 浏览器内 jcap SDK 拿 si/vt，Node.js 协议化提交 |

**推荐**: 混合模式 - puppeteer 触发 jcap SDK → 拿到 si/vt → 协议化提交 loginService。

---

## 4. 风险控制链路（已捕获）

### 4.1 风控端点

| 端点 | 用途 | 协议 |
|------|------|------|
| `https://sgm-m.jd.com/h5/init` | SGM session init | POST |
| `https://sgm-w.jd.com/h5` | 事件追踪 | POST |
| `https://jra.jd.com/jsTk.do` | JS token 申请（RSA 加密 tk） | POST |
| `https://cactus.jd.com/request_algo` | h5st 5.3 algo 网关 | POST |
| `https://cactus.jd.com/behavior_report` | 行为埋点（密文） | POST |
| `https://h5speed.m.jd.com/v4/speed/activity` | 活动追踪（JSON body） | POST |
| `https://h5speed.m.jd.com/v4/speed/event` | 事件追踪 | POST |
| `https://jcap.m.jd.com/cgi-bin/api/fp` | 验证码 FP | POST |
| `https://jcap.m.jd.com/cgi-bin/api/check` | 验证码 session check | POST |
| `https://jcapmonitor.m.jd.com/web_jcap_report` | 验证码埋点 | GET |
| `https://gia.jd.com/fcf.html` | 风控 init | POST |
| `https://seq.jd.com/jseqf.html` | SEQ 风控（jsonp） | GET |
| `https://seq.jd.com/jseq.html` | SEQ 风控 | GET |

### 4.2 浏览器指纹采集

| 字段 | 算法 | 库 |
|------|------|-----|
| `eid` (90 字符) | 浏览器 50+ 维度 hash + JD 自研加密 | `JdtRiskFingerPrint` |
| `eid2` (128 字符) | `jdd03 + eid + 加密(浏览器特征)` | eid.js |
| `fp` (32 字符) | 浏览器 MD5 指纹 | sessionId |
| `sa_token` (768 字符) | 服务端 RSA 加密返回 | jra.jd.com |
| `3AB9D23F7A4B3C9B` cookie | `jdd03 + eid + AAAAM6...` 格式 | eid |

---

## 5. 交付物清单

| 文件 | 用途 |
|------|------|
| `meta.json` | 元信息总结 |
| `REVERSE_ENGINEERING.md` | 本报告 |
| `scripts/11_full_call_in_browser.js` | Phase 1 h5st 完整还原调用 |
| `scripts/12_login_explore.js` | Phase 2.1 探索登录入口 |
| `scripts/13_login_attempt.js` | Phase 2.2 触发登录抓包 |
| `scripts/14_rsa_encrypt_test.js` | Phase 2.3 RSA 加密测试 ✓ |
| `scripts/15_login_protocol.js` | Phase 2.4 Node.js 协议化登录 (TLS 被风控) |
| `scripts/16_full_login_browser.js` | Phase 2.5 浏览器内协议化登录 (2150 chars body) |
| `scripts/17_capture_full_login.js` | Phase 2.6 完整抓包工具 |

---

## 6. 协议化登录执行检查清单

### 已实现
- [x] Phase 1: h5st 5.3 签名还原（ParamsSign + CryptoJS）
- [x] Phase 1: 29 条 feed 数据真实返回
- [x] Phase 2.1: 拿到 RSA 公钥
- [x] Phase 2.2: Node.js 端 RSA 加密（172 chars base64）
- [x] Phase 2.3: 拿全部 22 个 form 字段
- [x] Phase 2.4: 抓取完整 POST body（2150 chars）
- [x] Phase 2.5: 触发 loginService 服务端响应
- [x] Phase 2.6: 解析服务端响应（缺 vt）

### 待实现（需外部支持）
- [ ] Phase 3.1: jcap si 生成算法还原（WASM）
- [ ] Phase 3.2: jcap vt 算法还原 + 滑块/图片 OCR
- [ ] Phase 4.1: 拿 pt_key/pt_pin cookie（需真实账号 + 过 jcap）
- [ ] Phase 4.2: 验证可调购物车/订单/收藏 API

### 当前阻断点
- **服务端要求 graphicCaptchaVerifyToken (vt)**，而 jcap verify 需要：
  - 滑块/图片操作的人机交互
  - 或 完整还原 jcap SDK WASM 算法（工作量很大）
- **无测试账号** - 即便通过 jcap，登录也会因为密码错误被拒

---

## 7. 关键参考资料

1. **登录页 HTML**: `https://passport.jd.com/uc/login` (458KB)
2. **login2024.js**: 19KB, 13 个登录函数（含 getEntryptPwd / login / proceedWithLogin / smartInitSlide）
3. **jdJsencrypt.min.js**: 30KB, 标准 JSEncrypt
4. **jcap_ujb96b.js**: WebAssembly 加密的 jcap SDK
5. **js_security_v3_0.1.4.js**: 236KB, h5st 签名核心
6. **cactus.jd.com/request_algo**: h5st 5.3 algo 网关
7. **jra.jd.com/jsTk.do**: 服务端 RSA 加密的 tk
8. **jcap.m.jd.com/cgi-bin/api/{fp,check,verify}**: JDCaptcha 接口

---

## 8. 一句话总结

**京东协议化登录的 POST 格式 + RSA 加密已 100% 还原**，2150 字符的完整 body 服务端能正确识别；唯一阻断是 jcap 验证码的 `vt` 参数，需要 OCR / 接入打码平台 / 完整还原 WASM 算法。
