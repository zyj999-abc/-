#!/usr/bin/env python3
"""
88_gen_z_path.py (v3)

智能轨迹路径生成 - 自动沿骨架追踪。

算法：
1. 检测图片主色（背景）
2. 提取前景 mask
3. 找最大连通域
4. 骨架化
5. BFS 从最左端点沿骨架走到最远端点
6. 简化到 60-80 点

支持多种 jcap 验证码类型：
- Z 形 (tp=3)
- 立方体 (tp=11/25)
- 任意轨迹形状

输入: <image_path>
输出: JSON {width, height, points}
"""
import sys
import json
import cv2
import numpy as np
from skimage.morphology import skeletonize
from collections import deque


def detect_z_color(img):
    """判断前景是亮色还是暗色"""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2]
    return float(np.median(v)) < 100


def find_largest_cc(mask, min_area=200):
    """找最大连通域"""
    num, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    cands = [(i, stats[i, cv2.CC_STAT_AREA]) for i in range(1, num) if stats[i, cv2.CC_STAT_AREA] > min_area]
    if not cands:
        return None, None
    cands.sort(key=lambda x: -x[1])
    return cands[0][0], (labels, stats)


def find_endpoints(sk):
    """找骨架端点（1 个邻居）"""
    H, W = sk.shape
    endpoints = []
    for y in range(H):
        for x in range(W):
            if sk[y, x] == 0:
                continue
            n = 0
            for dy in [-1, 0, 1]:
                for dx in [-1, 0, 1]:
                    if dy == 0 and dx == 0:
                        continue
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < H and 0 <= nx < W and sk[ny, nx] > 0:
                        n += 1
            if n == 1:
                endpoints.append((x, y))
    return endpoints


def bfs_path(sk, start, target_count=60):
    """BFS 从 start 沿骨架走到最远点"""
    H, W = sk.shape
    visited = np.zeros_like(sk, dtype=bool)
    visited[start[1], start[0]] = True
    queue = deque([((start[0], start[1]), [start])])
    best_path = None
    iter_count = 0
    max_iter = 30000
    while queue and iter_count < max_iter:
        iter_count += 1
        (cx, cy), p = queue.popleft()
        if best_path is None or len(p) > len(best_path):
            best_path = p
        for dy in [-1, 0, 1]:
            for dx in [-1, 0, 1]:
                if dy == 0 and dx == 0:
                    continue
                nx, ny = cx + dx, cy + dy
                if 0 <= ny < H and 0 <= nx < W and sk[ny, nx] > 0 and not visited[ny, nx]:
                    visited[ny, nx] = True
                    queue.append(((nx, ny), p + [(nx, ny)]))
    if best_path is None:
        return None
    # 简化
    if len(best_path) > target_count:
        idx = np.linspace(0, len(best_path) - 1, target_count).astype(int)
        best_path = [best_path[i] for i in idx]
    return best_path


def gen_z_path(image_path, target_count=60, seed=None):
    img = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': f'cannot read {image_path}'}
    h, w = img.shape[:2]

    z_is_bright = detect_z_color(img)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2]
    if z_is_bright:
        v_mask = (v > 140).astype(np.uint8) * 255
    else:
        v_mask = (v < 100).astype(np.uint8) * 255
    v_mask = cv2.morphologyEx(v_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    v_mask = cv2.morphologyEx(v_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    # 找最大连通域
    biggest, _ = find_largest_cc(v_mask, min_area=300)
    if biggest is None:
        return {'error': 'no big connected component'}
    num, labels, stats, _ = cv2.connectedComponentsWithStats(v_mask, connectivity=8)
    mask = (labels == biggest).astype(np.uint8)

    # 骨架化
    sk = skeletonize(mask > 0).astype(np.uint8) * 255
    sk_count = (sk > 0).sum()
    if sk_count < 10:
        return {'error': f'skeleton too small: {sk_count}'}

    # 找端点
    endpoints = find_endpoints(sk)
    print(f'  端点数: {len(endpoints)}', file=sys.stderr)

    if not endpoints:
        return {'error': 'no endpoints'}

    # 选最左为起点
    endpoints.sort(key=lambda p: (p[0], p[1]))
    start = endpoints[0]

    # BFS 沿骨架
    path = bfs_path(sk, start, target_count=target_count)
    if not path:
        return {'error': 'BFS failed'}

    return {
        'width': int(w),
        'height': int(h),
        'start': list(start),
        'end': list(path[-1]),
        'points': [{'x': int(x), 'y': int(y)} for x, y in path],
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: 88_gen_z_path.py <image_path> [target_count]', file=sys.stderr)
        sys.exit(1)
    img_path = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    result = gen_z_path(img_path, target_count=n)
    print(json.dumps(result, ensure_ascii=False))
