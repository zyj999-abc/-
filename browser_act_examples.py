"""
BrowserAct CLI Python API 使用示例
=================================

本文件展示如何使用 browser_act_api.py 中导出的所有功能。
"""

import asyncio
from browser_act_api import (
    # Stealth Extract
    StealthExtract,
    stealth_extract,
    html_to_markdown,
    
    # Captcha Bypass
    CaptchaBypass,
    CaptchaType,
    
    # Browser Session
    BrowserSession,
    BrowserType,
    BrowserState,
    PageElement,
    
    # Cookie Management
    CookieManager,
    
    # Network Monitoring
    NetworkMonitor,
    
    # Tab Management
    TabManager,
    TabInfo,
    
    # Human Assist
    HumanAssist,
)


# ============================================================================
# 示例 1: 基础隐身提取
# ============================================================================

async def example_basic_extraction():
    """最基础的隐身提取示例"""
    print("=" * 60)
    print("示例 1: 基础隐身提取")
    print("=" * 60)
    
    # 使用便捷函数
    result = await stealth_extract("https://example.com")
    
    print(f"URL: {result.url}")
    print(f"状态码: {result.status_code}")
    print(f"HTML 长度: {len(result.html)}")
    print(f"Markdown 预览: {result.markdown[:200]}...")
    print()


# ============================================================================
# 示例 2: 使用动态代理提取
# ============================================================================

async def example_with_proxy():
    """使用动态代理的隐身提取"""
    print("=" * 60)
    print("示例 2: 使用动态代理")
    print("=" * 60)
    
    extractor = StealthExtract()
    
    # 使用美国 IP 代理
    result = await extractor.extract(
        "https://www.amazon.com",
        dynamic_proxy="US",
        content_type="markdown",
        timeout=60000
    )
    
    if result.error:
        print(f"错误: {result.error}")
    else:
        print(f"成功提取: {len(result.markdown)} 字符")
    print()


# ============================================================================
# 示例 3: 使用自定义代理
# ============================================================================

async def example_custom_proxy():
    """使用自定义代理的隐身提取"""
    print("=" * 60)
    print("示例 3: 自定义代理")
    print("=" * 60)
    
    result = await stealth_extract(
        "https://example.com",
        custom_proxy="socks5://username:password@proxy.example.com:1080",
        content_type="markdown"
    )
    
    print(f"提取结果: {result.url}")
    print()


# ============================================================================
# 示例 4: HTML 转 Markdown
# ============================================================================

async def example_html_to_markdown():
    """将 HTML 转换为 Markdown"""
    print("=" * 60)
    print("示例 4: HTML 转 Markdown")
    print("=" * 60)
    
    html = """
    <html>
    <head><title>Test Page</title></head>
    <body>
        <h1>Hello World</h1>
        <p>This is a <strong>test</strong> page.</p>
        <a href="https://example.com">Link</a>
    </body>
    </html>
    """
    
    markdown = html_to_markdown(html, "https://example.com")
    print("转换结果:")
    print(markdown)
    print()


# ============================================================================
# 示例 5: 验证码绕过
# ============================================================================

async def example_captcha_bypass():
    """验证码绕过示例"""
    print("=" * 60)
    print("示例 5: 验证码绕过")
    print("=" * 60)
    
    bypass = CaptchaBypass()
    
    # 初始化服务
    bypass.initialize()
    
    # 列出所有检测器
    detectors = bypass.list_detectors()
    print(f"可用检测器: {detectors}")
    
    # 获取特定类型的解决器
    solver = bypass.get_solver(CaptchaType.RECAPTCHA_V2)
    print(f"reCAPTCHA v2 解决器: {solver}")
    print()


# ============================================================================
# 示例 6: 浏览器会话管理
# ============================================================================

async def example_browser_session():
    """浏览器会话管理示例"""
    print("=" * 60)
    print("示例 6: 浏览器会话管理")
    print("=" * 60)
    
    # 连接到会话服务器
    session = BrowserSession("ws://localhost:9222")
    
    try:
        await session.connect()
        print("✓ 已连接到会话服务器")
        
        # 打开反检测浏览器
        await session.open_browser(
            browser_id="my-stealth-browser",
            url="https://example.com",
            browser_type=BrowserType.STEALTH,
            headed=True
        )
        print("✓ 浏览器已打开")
        
        # 获取页面状态
        state = await session.get_state()
        print(f"✓ 当前页面: {state.url}")
        print(f"✓ 标题: {state.title}")
        print(f"✓ 可交互元素数: {len(state.elements)}")
        
        # 等待页面稳定
        await session.wait_stable()
        print("✓ 页面已稳定")
        
        # 导航到其他页面
        await session.navigate("https://example.com/about")
        await session.wait_stable()
        print("✓ 已导航到 /about")
        
        # 获取新状态
        state = await session.get_state()
        print(f"✓ 新页面标题: {state.title}")
        
        # 执行 JavaScript
        result = await session.eval_js("document.title")
        print(f"✓ JS 执行结果: {result}")
        
    finally:
        await session.disconnect()
        print("✓ 已断开连接")
    print()


# ============================================================================
# 示例 7: 元素交互
# ============================================================================

async def example_element_interaction():
    """元素交互示例"""
    print("=" * 60)
    print("示例 7: 元素交互")
    print("=" * 60)
    
    session = BrowserSession("ws://localhost:9222")
    await session.connect()
    
    try:
        await session.open_browser("demo", "https://www.google.com")
        
        # 获取页面元素
        state = await session.get_state()
        print(f"找到 {len(state.elements)} 个可交互元素:")
        for elem in state.elements[:10]:
            print(f"  [{elem.index}] {elem.tag}: {elem.text[:30]}")
        
        # 找到搜索框（通常是 input 标签）
        search_input = next((e for e in state.elements if e.tag == "input"), None)
        if search_input:
            print(f"\n✓ 找到搜索框: 索引 {search_input.index}")
            
            # 输入搜索词
            await session.input(search_input.index, "Browser Automation")
            print("✓ 已输入搜索词")
            
            # 点击搜索按钮
            submit_btn = next((e for e in state.elements if "search" in e.text.lower()), None)
            if submit_btn:
                await session.click(submit_btn.index)
                print("✓ 已点击搜索")
        
        # 等待结果加载
        await session.wait_stable()
        print("✓ 搜索结果已加载")
        
    finally:
        await session.disconnect()
    print()


# ============================================================================
# 示例 8: Cookie 管理
# ============================================================================

async def example_cookie_management():
    """Cookie 管理示例"""
    print("=" * 60)
    print("示例 8: Cookie 管理")
    print("=" * 60)
    
    session = BrowserSession("ws://localhost:9222")
    await session.connect()
    
    try:
        await session.open_browser("demo", "https://example.com")
        
        # 创建 Cookie 管理器
        cookie_manager = CookieManager(session)
        
        # 获取 cookies
        cookies = await cookie_manager.get()
        print(f"✓ 找到 {len(cookies)} 个 cookies")
        
        # 设置新 cookie
        await cookie_manager.set("user_id", "12345", url="https://example.com")
        print("✓ 已设置 user_id cookie")
        
        # 导出 cookies 到文件
        await cookie_manager.export_cookies("/tmp/cookies.json")
        print("✓ 已导出 cookies 到文件")
        
        # 清除 cookies
        # await cookie_manager.clear()
        # print("✓ 已清除 cookies")
        
    finally:
        await session.disconnect()
    print()


# ============================================================================
# 示例 9: 网络请求监控
# ============================================================================

async def example_network_monitoring():
    """网络请求监控示例"""
    print("=" * 60)
    print("示例 9: 网络请求监控")
    print("=" * 60)
    
    session = BrowserSession("ws://localhost:9222")
    await session.connect()
    
    try:
        await session.open_browser("demo", "https://example.com")
        
        # 创建网络监控器
        monitor = NetworkMonitor(session)
        
        # 开始 HAR 捕获
        await monitor.start()
        print("✓ 已开始网络请求监控")
        
        # 执行需要监控的操作
        await session.navigate("https://example.com/api/data")
        await session.wait_stable()
        
        # 获取所有 XHR/Fetch 请求
        requests = await monitor.get_requests(type="xhr,fetch")
        print(f"✓ 捕获到 {len(requests)} 个 XHR/Fetch 请求")
        
        for req in requests[:5]:
            print(f"  [{req['id']}] {req['method']} {req['url']}")
        
        # 获取详细请求信息
        if requests:
            detail = await monitor.get_request_detail(requests[0]['id'])
            print(f"\n✓ 请求详情: {detail}")
        
        # 停止监控并保存 HAR
        har = await monitor.stop("/tmp/capture.har")
        print("✓ 已保存 HAR 文件")
        
    finally:
        await session.disconnect()
    print()


# ============================================================================
# 示例 10: 标签页管理
# ============================================================================

async def example_tab_management():
    """标签页管理示例"""
    print("=" * 60)
    print("示例 10: 标签页管理")
    print("=" * 60)
    
    session = BrowserSession("ws://localhost:9222")
    await session.connect()
    
    try:
        await session.open_browser("demo", "https://example.com")
        
        # 创建标签页管理器
        tab_manager = TabManager(session)
        
        # 在新标签打开链接（假设页面上有链接）
        # await session.eval_js("window.open('https://example.org')")
        # await asyncio.sleep(1)
        
        # 列出所有标签页
        tabs = await tab_manager.list()
        print(f"✓ 当前有 {len(tabs)} 个标签页:")
        for tab in tabs:
            active = "(活动)" if tab.active else ""
            print(f"  [{tab.id}] {tab.title} {active}")
        
        # 切换到第一个标签
        if len(tabs) > 1:
            await tab_manager.switch(tabs[0].id)
            print(f"✓ 已切换到标签: {tabs[0].title}")
        
        # 关闭非活动标签
        for tab in tabs:
            if not tab.active:
                await tab_manager.close(tab.id)
                print(f"✓ 已关闭标签: {tab.title}")
        
    finally:
        await session.disconnect()
    print()


# ============================================================================
# 示例 11: 人工协助
# ============================================================================

async def example_human_assist():
    """人工协助示例"""
    print("=" * 60)
    print("示例 11: 人工协助")
    print("=" * 60)
    
    session = BrowserSession("ws://localhost:9222")
    await session.connect()
    
    try:
        await session.open_browser("demo", "https://example.com")
        
        # 创建人工协助管理器
        assist = HumanAssist(session)
        
        # 启动人工协助
        assist_url = await assist.start("帮我完成这个 reCAPTCHA 验证")
        print(f"✓ 人工协助已启动")
        print(f"  协助 URL: {assist_url}")
        
        # 检查状态
        status = await assist.get_status()
        print(f"  状态: {status}")
        
    finally:
        await session.disconnect()
    print()


# ============================================================================
# 示例 12: 截图和滚动
# ============================================================================

async def example_screenshot_and_scroll():
    """截图和滚动示例"""
    print("=" * 60)
    print("示例 12: 截图和滚动")
    print("=" * 60)
    
    session = BrowserSession("ws://localhost:9222")
    await session.connect()
    
    try:
        await session.open_browser("demo", "https://example.com")
        
        # 截取截图
        screenshot = await session.screenshot()
        print(f"✓ 已获取截图 (长度: {len(screenshot)})")
        
        # 保存截图到文件
        with open("/tmp/page_screenshot.png", "wb") as f:
            import base64
            f.write(base64.b64decode(screenshot))
        print("✓ 已保存截图到 /tmp/page_screenshot.png")
        
        # 全页面截图
        full_screenshot = await session.screenshot(full_page=True)
        print(f"✓ 已获取全页面截图 (长度: {len(full_screenshot)})")
        
        # 向下滚动
        await session.scroll("down", 500)
        print("✓ 已向下滚动 500px")
        
        await session.scroll("down", 1000)
        print("✓ 已向下滚动 1000px")
        
        # 向上滚动
        await session.scroll("up", 500)
        print("✓ 已向上滚动 500px")
        
        # 滚动到指定元素
        state = await session.get_state()
        if state.elements:
            await session.scroll_into_view(state.elements[0].tag)
            print(f"✓ 已滚动到第一个元素可见")
        
    finally:
        await session.disconnect()
    print()


# ============================================================================
# 主函数
# ============================================================================

async def main():
    """运行所有示例"""
    print("\n" + "=" * 60)
    print("BrowserAct CLI Python API 示例")
    print("=" * 60 + "\n")
    
    # 基础功能示例（不需要服务器连接）
    await example_basic_extraction()
    await example_with_proxy()
    await example_custom_proxy()
    await example_html_to_markdown()
    await example_captcha_bypass()
    
    # 需要服务器连接的功能
    # 注意：这些示例需要先启动 browser-act-server
    # 
    # await example_browser_session()
    # await example_element_interaction()
    # await example_cookie_management()
    # await example_network_monitoring()
    # await example_tab_management()
    # await example_human_assist()
    # await example_screenshot_and_scroll()
    
    print("\n" + "=" * 60)
    print("示例完成")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
