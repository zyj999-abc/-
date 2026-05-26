"""
BrowserAct CLI Python API 包装器
===============================

本模块提供了对 BrowserAct CLI 所有功能的 Python API 访问。

使用前请确保已安装 browser-act-cli:
    pip install browser-act-cli

示例:
    from browser_act_api import StealthExtract, CaptchaBypass, BrowserSession
    
    # 隐身提取
    async def extract():
        extractor = StealthExtract()
        result = await extractor.extract("https://example.com")
        print(result.markdown)
"""

import asyncio
import json
from typing import Any, Dict, List, Optional, Tuple, Callable
from pathlib import Path
from dataclasses import dataclass
from enum import Enum

# ============================================================================
# Stealth Extract API
# ============================================================================

@dataclass
class ExtractionResult:
    """隐身提取结果"""
    html: str
    url: str
    status_code: Optional[int] = None
    error: Optional[str] = None
    
    @property
    def markdown(self) -> str:
        """将 HTML 转换为 Markdown"""
        from browser_act_cli.stealth_extract.extractor import _analyze_html, _classify_markdown_result
        analysis = _analyze_html(self.html)
        return analysis.get("markdown", "")


class StealthExtract:
    """
    隐身提取器 - 反检测浏览器内容提取
    
    使用示例:
        extractor = StealthExtract()
        result = await extractor.extract(
            "https://protected-site.com",
            dynamic_proxy="US",
            content_type="markdown"
        )
    """
    
    def __init__(self):
        self._import_modules()
    
    def _import_modules(self):
        """延迟导入模块"""
        from browser_act_cli.stealth_extract import extractor as ext_module
        from browser_act_cli.stealth_extract import gateway as gw_module
        from browser_act_cli.stealth_extract import proxy_session as ps_module
        self._extractor = ext_module
        self._gateway = gw_module
        self._proxy_session = ps_module
    
    async def extract(
        self,
        url: str,
        dynamic_proxy: Optional[str] = None,
        custom_proxy: Optional[str] = None,
        content_type: str = "markdown",
        timeout: int = 30000
    ) -> ExtractionResult:
        """
        提取网页内容
        
        Args:
            url: 目标 URL
            dynamic_proxy: 动态代理区域 (如 "US", "JP", "EU")
            custom_proxy: 自定义代理 URL
            content_type: 返回格式 ("markdown" 或 "html")
            timeout: 超时时间（毫秒）
            
        Returns:
            ExtractionResult 对象
        """
        try:
            result = await self._extractor.stealth_extract(
                url,
                dynamic_proxy=dynamic_proxy,
                custom_proxy=custom_proxy,
                content_type=content_type,
                timeout=timeout
            )
            return ExtractionResult(
                html=result.get("html", ""),
                url=result.get("url", url),
                status_code=result.get("status_code")
            )
        except Exception as e:
            return ExtractionResult(
                html="",
                url=url,
                error=str(e)
            )
    
    def get_diagnostics(self, result: ExtractionResult) -> 'ExtractionDiagnostics':
        """获取提取诊断信息"""
        return ExtractionDiagnostics(result)


class ExtractionDiagnostics:
    """提取诊断信息"""
    
    def __init__(self, result: ExtractionResult):
        self._result = result
        from browser_act_cli.stealth_extract.extractor import ExtractionDiagnostics as ED
        self._diag = ED(result)
    
    def details(self) -> Dict[str, Any]:
        """获取详细诊断信息"""
        return self._diag.details()
    
    def suffix(self) -> str:
        """获取诊断后缀"""
        return self._diag.suffix()
    
    def with_markdown(self) -> str:
        """获取带诊断的 Markdown"""
        return self._diag.with_markdown()
    
    def to_error(self) -> Exception:
        """转换为异常"""
        return self._diag.to_error()


# ============================================================================
# Captcha Bypass API
# ============================================================================

class CaptchaType(Enum):
    """验证码类型"""
    RECAPTCHA_V2 = "recaptcha_v2_token"
    CLOUDFLARE_CHALLENGE = "cloudflare_challenge_token"
    CLOUDFLARE_WIDGET = "cloudflare_widget_token"
    DATADOME_SLIDER = "datadome_slider"
    HUMAN_SECURITY = "human_security_solver"


class CaptchaBypass:
    """
    验证码绕过服务
    
    使用示例:
        bypass = CaptchaBypass()
        result = await bypass.solve(CaptchaType.RECAPTCHA_V2)
    """
    
    def __init__(self):
        self._import_modules()
    
    def _import_modules(self):
        """延迟导入模块"""
        from browser_act_cli.session.captcha import service as svc_module
        from browser_act_cli.session.captcha import client as cli_module
        from browser_act_cli.session.captcha import registry as reg_module
        from browser_act_cli.session.captcha import bootstrap as boot_module
        self._service = svc_module
        self._client = cli_module
        self._registry = reg_module
        self._bootstrap = boot_module
    
    def initialize(self) -> None:
        """初始化验证码服务"""
        self._bootstrap.ensure_captcha_bootstrapped()
    
    async def solve(self, captcha_type: CaptchaType, **kwargs) -> Any:
        """
        解决验证码
        
        Args:
            captcha_type: 验证码类型
            **kwargs: 额外参数
            
        Returns:
            解决结果（token 或布尔值）
        """
        solver = self._registry.get_solver(captcha_type.value)
        return await solver(**kwargs)
    
    def get_solver(self, captcha_type: CaptchaType):
        """获取指定类型的解决器"""
        return self._registry.get_solver(captcha_type.value)
    
    def list_detectors(self) -> List[str]:
        """列出所有检测器"""
        detectors = self._registry.get_detectors()
        return [d.__name__ for d in detectors]


# ============================================================================
# Browser Session API
# ============================================================================

class BrowserType(Enum):
    """浏览器类型"""
    STEALTH = "stealth"
    CHROME = "chrome"
    CHROME_DIRECT = "chrome-direct"
    WORKBENCH = "workbench"


@dataclass
class BrowserInfo:
    """浏览器信息"""
    id: str
    name: str
    type: str
    description: str
    proxy: Optional[str] = None
    status: str = "unknown"


@dataclass
class PageElement:
    """页面元素"""
    index: int
    tag: str
    text: str
    attributes: Dict[str, str]
    bbox: Optional[Tuple[int, int, int, int]] = None


@dataclass
class BrowserState:
    """浏览器状态"""
    url: str
    title: str
    elements: List[PageElement]
    screenshot: Optional[str] = None


class BrowserSession:
    """
    浏览器会话管理
    
    使用示例:
        session = BrowserSession("ws://localhost:9222")
        await session.connect()
        await session.navigate("https://example.com")
        state = await session.get_state()
        await session.click(3)
    """
    
    def __init__(self, server_url: str, session_name: str = "default"):
        self._server_url = server_url
        self._session_name = session_name
        self._client: Optional['SessionClient'] = None
        self._import_modules()
    
    def _import_modules(self):
        """延迟导入模块"""
        from browser_act_cli.session.client import SessionClient
        from browser_act_cli.session.protocol import Request, Response
        self._SessionClient = SessionClient
        self._Request = Request
        self._Response = Response
    
    async def connect(self) -> None:
        """连接到会话服务器"""
        self._client = self._SessionClient(self._server_url)
        await self._client.ping()
    
    async def disconnect(self) -> None:
        """断开连接"""
        if self._client:
            await self._client.send(self._Request.create("shutdown"))
            self._client = None
    
    async def open_browser(
        self,
        browser_id: str,
        url: str,
        browser_type: BrowserType = BrowserType.STEALTH,
        headed: bool = False,
        private: bool = False
    ) -> None:
        """
        打开浏览器
        
        Args:
            browser_id: 浏览器 ID
            url: 初始 URL
            browser_type: 浏览器类型
            headed: 是否显示窗口
            private: 是否使用隐私模式
        """
        request = self._Request.create("browser_open",
            browser_id=browser_id,
            url=url,
            type=browser_type.value,
            headed=headed,
            private=private
        )
        return await self._client.send(request)
    
    async def navigate(self, url: str) -> None:
        """导航到 URL"""
        request = self._Request.create("navigate", url=url)
        return await self._client.send(request)
    
    async def back(self) -> None:
        """返回上一页"""
        request = self._Request.create("back")
        return await self._client.send(request)
    
    async def forward(self) -> None:
        """前进到下一页"""
        request = self._Request.create("forward")
        return await self._client.send(request)
    
    async def reload(self) -> None:
        """刷新页面"""
        request = self._Request.create("reload")
        return await self._client.send(request)
    
    async def get_state(self) -> BrowserState:
        """获取页面状态"""
        request = self._Request.create("state")
        response = await self._client.send(request)
        return self._parse_state(response)
    
    async def get_html(self) -> str:
        """获取页面 HTML"""
        request = self._Request.create("get_html")
        response = await self._client.send(request)
        return response.get("html", "")
    
    async def get_markdown(self) -> str:
        """获取页面 Markdown"""
        request = self._Request.create("get_markdown")
        response = await self._client.send(request)
        return response.get("markdown", "")
    
    async def get_title(self) -> str:
        """获取页面标题"""
        request = self._Request.create("get_title")
        response = await self._client.send(request)
        return response.get("title", "")
    
    async def click(self, index: int) -> None:
        """点击元素"""
        request = self._Request.create("click", index=index)
        return await self._client.send(request)
    
    async def input(self, index: int, text: str) -> None:
        """输入文本"""
        request = self._Request.create("input", index=index, text=text)
        return await self._client.send(request)
    
    async def type(self, text: str) -> None:
        """在焦点元素输入"""
        request = self._Request.create("type", text=text)
        return await self._client.send(request)
    
    async def hover(self, index: int) -> None:
        """悬停元素"""
        request = self._Request.create("hover", index=index)
        return await self._client.send(request)
    
    async def select(self, index: int, option: str) -> None:
        """选择下拉选项"""
        request = self._Request.create("select", index=index, option=option)
        return await self._client.send(request)
    
    async def keys(self, keys: str) -> None:
        """发送键盘按键"""
        request = self._Request.create("keys", keys=keys)
        return await self._client.send(request)
    
    async def scroll(self, direction: str = "down", amount: int = 500) -> None:
        """滚动页面"""
        request = self._Request.create("scroll", direction=direction, amount=amount)
        return await self._client.send(request)
    
    async def scroll_into_view(self, selector: str) -> None:
        """滚动到元素可见"""
        request = self._Request.create("scrollintoview", selector=selector)
        return await self._client.send(request)
    
    async def screenshot(self, full_page: bool = False) -> str:
        """获取截图"""
        request = self._Request.create("screenshot", full=full_page)
        response = await self._client.send(request)
        return response.get("screenshot", "")
    
    async def wait_stable(self, timeout: int = 30000) -> None:
        """等待页面稳定"""
        request = self._Request.create("wait_stable", timeout=timeout)
        return await self._client.send(request)
    
    async def wait_selector(self, selector: str, state: str = "visible", timeout: int = 10000) -> None:
        """等待元素状态"""
        request = self._Request.create("wait_selector",
            selector=selector,
            state=state,
            timeout=timeout
        )
        return await self._client.send(request)
    
    async def upload(self, index: int, file_path: str) -> None:
        """上传文件"""
        request = self._Request.create("upload", index=index, file_path=file_path)
        return await self._client.send(request)
    
    async def eval_js(self, script: str) -> Any:
        """执行 JavaScript"""
        request = self._Request.create("eval", script=script)
        response = await self._client.send(request)
        return response.get("result")
    
    def _parse_state(self, response: Dict) -> BrowserState:
        """解析状态响应"""
        elements = []
        for idx, elem_data in enumerate(response.get("elements", [])):
            elements.append(PageElement(
                index=idx + 1,
                tag=elem_data.get("tag", ""),
                text=elem_data.get("text", ""),
                attributes=elem_data.get("attributes", {}),
                bbox=elem_data.get("bbox")
            ))
        
        return BrowserState(
            url=response.get("url", ""),
            title=response.get("title", ""),
            elements=elements,
            screenshot=response.get("screenshot")
        )


# ============================================================================
# Cookie Management API
# ============================================================================

class CookieManager:
    """
    Cookie 管理器
    
    使用示例:
        cookies = await cookie_manager.get(url="https://example.com")
        await cookie_manager.set("session_id", "abc123", url="https://example.com")
        await cookie_manager.export("/path/to/cookies.json")
    """
    
    def __init__(self, session: BrowserSession):
        self._session = session
    
    async def get(self, url: Optional[str] = None) -> List[Dict]:
        """获取 cookies"""
        request = self._session._Request.create("cookies_get", url=url)
        response = await self._session._client.send(request)
        return response.get("cookies", [])
    
    async def set(self, name: str, value: str, url: Optional[str] = None) -> None:
        """设置 cookie"""
        request = self._session._Request.create("cookies_set",
            name=name,
            value=value,
            url=url
        )
        return await self._session._client.send(request)
    
    async def clear(self, url: Optional[str] = None) -> None:
        """清除 cookies"""
        request = self._session._Request.create("cookies_clear", url=url)
        return await self._session._client.send(request)
    
    async def import_cookies(self, file_path: str) -> None:
        """导入 cookies"""
        request = self._session._Request.create("cookies_import", file_path=file_path)
        return await self._session._client.send(request)
    
    async def export_cookies(self, file_path: str) -> None:
        """导出 cookies"""
        request = self._session._Request.create("cookies_export", file_path=file_path)
        return await self._session._client.send(request)


# ============================================================================
# Network Monitoring API
# ============================================================================

class NetworkMonitor:
    """
    网络请求监控
    
    使用示例:
        await monitor.start()
        # ... 执行操作 ...
        requests = await monitor.get_requests()
        await monitor.stop()
    """
    
    def __init__(self, session: BrowserSession):
        self._session = session
    
    async def start(self) -> None:
        """开始 HAR 捕获"""
        request = self._session._Request.create("har_start")
        return await self._session._client.send(request)
    
    async def stop(self, output_path: Optional[str] = None) -> Dict:
        """停止 HAR 捕获"""
        request = self._session._Request.create("har_stop", output_path=output_path)
        return await self._session._client.send(request)
    
    async def get_requests(
        self,
        filter: Optional[str] = None,
        type: Optional[str] = None,
        method: Optional[str] = None,
        status: Optional[str] = None
    ) -> List[Dict]:
        """获取网络请求"""
        request = self._session._Request.create("network_requests",
            filter=filter,
            type=type,
            method=method,
            status=status
        )
        response = await self._session._client.send(request)
        return response.get("requests", [])
    
    async def get_request_detail(self, request_id: str) -> Dict:
        """获取请求详情"""
        request = self._session._Request.create("network_request", id=request_id)
        return await self._session._client.send(request)
    
    async def clear(self) -> None:
        """清除请求记录"""
        request = self._session._Request.create("clear_network")
        return await self._session._client.send(request)


# ============================================================================
# Tab Management API
# ============================================================================

@dataclass
class TabInfo:
    """标签页信息"""
    id: str
    url: str
    title: str
    active: bool = False


class TabManager:
    """
    标签页管理
    
    使用示例:
        tabs = await tab_manager.list()
        await tab_manager.switch("tab-id-123")
        await tab_manager.close("tab-id-123")
    """
    
    def __init__(self, session: BrowserSession):
        self._session = session
    
    async def list(self) -> List[TabInfo]:
        """列出所有标签页"""
        request = self._session._Request.create("tab_list")
        response = await self._session._client.send(request)
        tabs = []
        for tab_data in response.get("tabs", []):
            tabs.append(TabInfo(
                id=tab_data.get("id"),
                url=tab_data.get("url"),
                title=tab_data.get("title"),
                active=tab_data.get("active", False)
            ))
        return tabs
    
    async def switch(self, target_id: str) -> None:
        """切换到指定标签页"""
        request = self._session._Request.create("tab_switch", target_id=target_id)
        return await self._session._client.send(request)
    
    async def close(self, target_id: Optional[str] = None) -> None:
        """关闭标签页"""
        request = self._session._Request.create("tab_close", target_id=target_id)
        return await self._session._client.send(request)


# ============================================================================
# Human Assist API
# ============================================================================

class HumanAssist:
    """
    人工协助
    
    使用示例:
        assist = HumanAssist(session)
        url = await assist.start("帮我完成这个验证码")
        status = await assist.get_status()
    """
    
    def __init__(self, session: BrowserSession):
        self._session = session
    
    async def start(self, objective: str) -> str:
        """
        启动人工协助
        
        Args:
            objective: 需要完成的目标描述
            
        Returns:
            协助 URL
        """
        request = self._session._Request.create("human_assist_url", objective=objective)
        response = await self._session._client.send(request)
        return response.get("url", "")
    
    async def get_status(self) -> Dict:
        """获取协助状态"""
        request = self._session._Request.create("human_assist_status")
        return await self._session._client.send(request)


# ============================================================================
# 便捷函数
# ============================================================================

async def stealth_extract(
    url: str,
    dynamic_proxy: Optional[str] = None,
    custom_proxy: Optional[str] = None,
    content_type: str = "markdown",
    timeout: int = 30000
) -> ExtractionResult:
    """
    快速隐身提取函数
    
    使用示例:
        result = await stealth_extract("https://example.com")
        print(result.markdown)
    """
    extractor = StealthExtract()
    return await extractor.extract(
        url=url,
        dynamic_proxy=dynamic_proxy,
        custom_proxy=custom_proxy,
        content_type=content_type,
        timeout=timeout
    )


def html_to_markdown(html: str, url: str) -> str:
    """
    将 HTML 转换为 Markdown
    
    使用示例:
        md = html_to_markdown("<p>Hello</p>", "https://example.com")
    """
    from browser_act_cli.stealth_extract.extractor import _analyze_html, _classify_markdown_result
    
    analysis = _analyze_html(html)
    return analysis.get("markdown", "")


# ============================================================================
# 导出所有公共 API
# ============================================================================

__all__ = [
    # Stealth Extract
    'StealthExtract',
    'ExtractionResult',
    'ExtractionDiagnostics',
    'stealth_extract',
    'html_to_markdown',
    
    # Captcha Bypass
    'CaptchaBypass',
    'CaptchaType',
    
    # Browser Session
    'BrowserSession',
    'BrowserType',
    'BrowserInfo',
    'BrowserState',
    'PageElement',
    
    # Cookie Management
    'CookieManager',
    
    # Network Monitoring
    'NetworkMonitor',
    
    # Tab Management
    'TabManager',
    'TabInfo',
    
    # Human Assist
    'HumanAssist',
]
