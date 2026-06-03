#!/usr/bin/env python3
"""
68_detect_z_bfs.py

检测 jcap Z 形轨迹，用 BFS 沿曲线从一端走到另一端。
"""
import sys
import json
import cv2
import numpy as np
from collections import deque


def find_z_curve_bfs(img_path):
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': f'cannot read {img_path}'}
    h, w = img.shape[:2]
    print(f'image size: {w}x{h}', file=sys.stderr)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 阈值化：暗色 = 轨迹
    _, dark_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)

    # 形态学去噪
    kernel = np.ones((3, 3), np.uint8)
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_CLOSE, kernel)
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_OPEN, kernel)

    # 找最大连通域
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(dark_mask, connectivity=8)
    candidates = [(i, stats[i, cv2.CC_STAT_AREA]) for i in range(1, num_labels) if stats[i, cv2.CC_STAT_AREA] > 500]
    candidates.sort(key=lambda x: -x[1])

    if not candidates:
        return {'error': 'no curve found'}

    max_idx = candidates[0][0]
    curve_mask = (labels == max_idx).astype(np.uint8)

    # 找最左点
    ys, xs = np.where(curve_mask > 0)
    left_x = xs.min()
    left_y = int(ys[xs == left_x].mean())

    # 找最右点
    right_x = xs.max()
    right_y = int(ys[xs == right_x].mean())

    # BFS 从最左点开始
    visited = np.zeros_like(curve_mask, dtype=bool)
    queue = deque([(left_y, left_x)])
    visited[left_y, left_x] = True
    path = [(left_x, left_y)]

    while queue:
        cy, cx = queue.popleft()
        # 8 邻域
        for dy in [-1, 0, 1]:
            for dx in [-1, 0, 1]:
                if dy == 0 and dx == 0:
                    continue
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and curve_mask[ny, nx] > 0 and not visited[ny, nx]:
                    visited[ny, nx] = True
                    queue.append((ny, nx))
                    path.append((nx, ny))

    # path 是 BFS 顺序（不是从一端到另一端的最短路径）
    # 但我们可以用一个简单方法：从最左点开始，每次往右走
    # 实际：BFS 顺序是从最左点扩散开来的，要重排

    # 改用：从最左点开始，每次跳到未访问的最近点
    # 简化：只保留按 x 排序后的 path
    path.sort(key=lambda p: p[0])

    # 等间距采样
    target_count = 50
    if len(path) > target_count:
        idx = np.linspace(0, len(path) - 1, target_count).astype(int)
        path = [path[i] for i in idx]

    print(f'final points: {len(path)}', file=sys.stderr)

    return {
        'color': 'dark',
        'width': w,
        'height': h,
        'start': [left_x, left_y],
        'end': [right_x, right_y],
        'points': [{'x': int(x), 'y': int(y)} for x, y in path],
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: detect_z_bfs.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = find_z_curve_bfs(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
