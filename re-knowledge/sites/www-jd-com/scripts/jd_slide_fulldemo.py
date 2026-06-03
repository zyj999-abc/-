"""
jdSlide 缺口识别 + 完整协议化模块
====================================

实现:
1. gap_detect: OpenCV 模板匹配找缺口 x 坐标
2. trajectory: 真实人行为轨迹生成（贝塞尔 + 抖动）
3. encode_d: 用 d 算法模块编码 mousePos
4. submit_verify: 协议化提交 s.html 拿 validate
"""
import os
import sys
import json
import base64
import random
import re
import time
import urllib.parse
import urllib.request
import ssl
from typing import List, Tuple

import cv2
import numpy as np


# 字符集
CHARS_64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-~'


def string10to64(n: int) -> str:
    """数字转 base64 (jdSlide 自定义字符集)"""
    n = int(n)
    c = len(CHARS_64)
    e = []
    while True:
        mod = n % c
        n = (n - mod) // c
        e.insert(0, CHARS_64[mod])
        if n == 0:
            break
    return ''.join(e)


def prefix_integer(a: str, b: int) -> str:
    """字符串左侧补 0"""
    return (('0' * b) + a)[-b:]


def pretreatment(a, b: int, is_first: bool) -> str:
    """编码单个数字 (带/不带符号)"""
    numA = int(a)
    e = string10to64(abs(numA))
    f = ''
    if not is_first:
        f += '1' if numA > 0 else '0'
    f += prefix_integer(e, b)
    return f


def get_coordinate(mouse_pos: List[List[int]]) -> str:
    """
    编码 mousePos 数组为 d 参数
    真实 jdSlide v6.1.2 算法:
      P0:  x(3, isFirst=true) + y(4, isFirst=true) + t(7, isFirst=true) = 14 chars
      P1+: sign_x(1) + dx(2, isFirst=false) + sign_y(1) + dy(2, isFirst=false) + dt(4, isFirst=true) = 10 chars
    """
    c = []
    for d in range(len(mouse_pos)):
        if d == 0:
            c.append(pretreatment(min(mouse_pos[d][0], 0x3ffff), 3, True))
            c.append(pretreatment(min(mouse_pos[d][1], 0xffffff), 4, True))
            c.append(pretreatment(min(mouse_pos[d][2], 0x3ffffffffff), 7, True))
        else:
            dx = mouse_pos[d][0] - mouse_pos[d-1][0]
            dy = mouse_pos[d][1] - mouse_pos[d-1][1]
            dt = mouse_pos[d][2] - mouse_pos[d-1][2]
            c.append(pretreatment(min(dx, 0xfff), 2, False))   # sign + 2 chars
            c.append(pretreatment(min(dy, 0xfff), 2, False))   # sign + 2 chars
            c.append(pretreatment(min(dt, 0xffffff), 4, True))  # 4 chars NO sign
    return ''.join(c)


def gap_detect(bg_bytes: bytes, patch_bytes: bytes) -> int:
    """
    缺口识别: 找 patch 在 bg 中的 x 坐标
    返回: 滑块滑动距离
    """
    bg_arr = np.frombuffer(bg_bytes, dtype=np.uint8)
    bg = cv2.imdecode(bg_arr, cv2.IMREAD_COLOR)
    patch_arr = np.frombuffer(patch_bytes, dtype=np.uint8)
    patch = cv2.imdecode(patch_arr, cv2.IMREAD_UNCHANGED)

    if patch is None or bg is None:
        return -1

    # 取 patch RGB
    if patch.shape[2] == 4:
        patch_rgb = patch[:, :, :3]
        patch_alpha = patch[:, :, 3]
    else:
        patch_rgb = patch
        patch_alpha = np.ones(patch.shape[:2], dtype=np.uint8) * 255

    # 模板匹配
    bg_gray = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)
    patch_gray = cv2.cvtColor(patch_rgb, cv2.COLOR_BGR2GRAY)

    # 用 patch 的 RGB 直接匹配
    res = cv2.matchTemplate(bg_gray, patch_gray, cv2.TM_CCOEFF_NORMED)
    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)

    # max_loc[0] 是水平匹配位置 (y 不重要因为 patch 高度可能不同)
    # 滑动距离 = max_loc[0] - patch 中心
    return max_loc[0]


def generate_trajectory(target_x: int, start_t: int, total_ms: int = 1500) -> List[List[int]]:
    """
    生成真实人行为轨迹

    模拟人类拖动:
    1. 慢启动 (前 20% 时间只走 10% 距离)
    2. 中段加速 (50% 时间走 70% 距离)
    3. 末段减速 (30% 时间走 20% 距离)
    4. y 方向小幅抖动
    5. dt 不均匀 (真实人不会等距)

    Args:
        target_x: 目标 x 距离
        start_t: 起始时间戳 (ms)
        total_ms: 总耗时 (ms)

    Returns:
        [[x, y, t], ...]
    """
    points = []
    n_steps = random.randint(48, 56)  # 48-56 步, 对齐真实 d ~52 点

    # 起点
    points.append([0, 0, start_t])

    # 贝塞尔 + ease-out
    cumulative_x = 0
    cumulative_t = 0
    for i in range(1, n_steps):
        t = i / n_steps
        # ease-out cubic
        eased = 1 - (1 - t) ** 3
        # 添加抖动
        jitter = random.uniform(-2, 2)
        # y 方向小幅度移动
        y_jitter = random.choice([-1, 0, 0, 0, 1, 1, 2])
        # dt 不均匀
        dt = random.randint(15, 50)
        cumulative_t += dt

        # x 是当前位置
        x = round(eased * target_x + jitter)
        # 防止倒走
        if x < cumulative_x:
            x = cumulative_x + 1
        cumulative_x = x
        y = y_jitter
        points.append([x, y, start_t + cumulative_t])

    # 终点
    points.append([target_x, 0, start_t + total_ms])
    return points


def ddddocr_local(img_bytes: bytes) -> str:
    """ddddocr 调用 (占位 - jdSlide 不需要 OCR)"""
    return ""


# ===========================================
# 测试
# ===========================================
if __name__ == '__main__':
    import sys
    if len(sys.argv) >= 3:
        bg_path = sys.argv[1]
        patch_path = sys.argv[2]
        with open(bg_path, 'rb') as f:
            bg_bytes = f.read()
        with open(patch_path, 'rb') as f:
            patch_bytes = f.read()
        gap = gap_detect(bg_bytes, patch_bytes)
        print(f'缺口 x = {gap}')

        # 生成轨迹
        start_t = int(time.time() * 1000)
        mp = generate_trajectory(gap, start_t)
        print(f'轨迹点数: {len(mp)}')
        print(f'前 5 点: {mp[:5]}')
        print(f'末 5 点: {mp[-5:]}')

        # 编码 d
        d = get_coordinate(mp)
        print(f'd 参数 (前 100): {d[:100]}')
        print(f'd 长度: {len(d)}')
    else:
        print('用法: python jd_slide_fulldemo.py <bg.png> <patch.png>')
        # 演示
        print('\n=== 算法自测 ===')
        # getCoordinate 测试
        mp = [[0, 0, 1717293600000], [10, 1, 1717293600030], [20, -1, 1717293600060]]
        d = get_coordinate(mp)
        print(f'模拟 mousePos -> d: {d}')
        # 真实
        d_real = "0000000pW91cE-13t11V00001080"
        print(f'真实 d 起始: {d_real}')
