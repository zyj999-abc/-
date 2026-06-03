#!/usr/bin/env python3
"""
73_detect_z_segments.py

通过 3 段 Z 形（顶横/对角/底横）分别检测再拼接。
策略：
1. 找最大连通域
2. 用骨架化 + 找 3 个端点
3. 端点之间两两配对形成 3 段
4. 按位置关系排序拼接
"""
import sys
import json
import cv2
import numpy as np
from collections import deque


def find_endpoints(skeleton):
    """找骨架的所有端点（只有一个邻居）"""
    h, w = skeleton.shape
    endpoints = []
    for y in range(h):
        for x in range(w):
            if skeleton[y, x] == 0:
                continue
            n = 0
            for dy in [-1, 0, 1]:
                for dx in [-1, 0, 1]:
                    if dy == 0 and dx == 0:
                        continue
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and skeleton[ny, nx] > 0:
                        n += 1
            if n == 1:
                endpoints.append((x, y))
    return endpoints


def find_path_bfs(skeleton, start, end, max_steps=2000):
    """BFS 从 start 到 end 沿骨架走"""
    h, w = skeleton.shape
    visited = np.zeros_like(skeleton, dtype=bool)
    visited[start[1], start[0]] = True
    queue = deque([(start, [start])])

    while queue and max_steps > 0:
        max_steps -= 1
        (cx, cy), path = queue.popleft()
        if (cx, cy) == end:
            return path
        for dy in [-1, 0, 1]:
            for dx in [-1, 0, 1]:
                if dy == 0 and dx == 0:
                    continue
                nx, ny = cx + dx, cy + dy
                if 0 <= ny < h and 0 <= nx < w and skeleton[ny, nx] > 0 and not visited[ny, nx]:
                    visited[ny, nx] = True
                    queue.append(((nx, ny), path + [(nx, ny)]))
    return None


def find_z_curve(img_path):
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': f'cannot read {img_path}'}
    h, w = img.shape[:2]
    print(f'image size: {w}x{h}', file=sys.stderr)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 阈值化（暗色 = 轨迹）
    _, dark_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)

    # 形态学
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
    curve_mask = (labels == max_idx).astype(np.uint8) * 255

    # 找所有 端点（用轮廓）
    # 找所有曲线点
    ys, xs = np.where(curve_mask > 0)

    # 找 4 个极值点：最左、最右、最上、最下
    left_x = int(xs.min())
    left_y = int(ys[xs == left_x].mean())
    right_x = int(xs.max())
    right_y = int(ys[xs == right_x].mean())
    top_y = int(ys.min())
    top_x = int(xs[ys == top_y].mean())
    bottom_y = int(ys.max())
    bottom_x = int(xs[ys == bottom_y].mean())

    print(f'  left=({left_x},{left_y})', file=sys.stderr)
    print(f'  right=({right_x},{right_y})', file=sys.stderr)
    print(f'  top=({top_x},{top_y})', file=sys.stderr)
    print(f'  bottom=({bottom_x},{bottom_y})', file=sys.stderr)

    # 用 medial axis transform 找中心线
    dist = cv2.distanceTransform(curve_mask, cv2.DIST_L2, 5)
    max_dist = dist.max()
    skeleton = (dist > max_dist * 0.4).astype(np.uint8)

    # 找 skeleton 端点
    endpoints = find_endpoints(skeleton)
    print(f'  endpoints: {len(endpoints)}', file=sys.stderr)
    for e in endpoints:
        print(f'    {e}', file=sys.stderr)

    if len(endpoints) < 2:
        return {'error': f'too few endpoints: {len(endpoints)}'}

    # 选最左 + 最右作为 path 端点
    endpoints.sort(key=lambda p: p[0])
    start = endpoints[0]
    end = endpoints[-1]

    # BFS
    print(f'  BFS from {start} to {end}', file=sys.stderr)
    path = find_path_bfs(skeleton, start, end, max_steps=10000)
    if not path:
        return {'error': 'no path found'}

    print(f'  path length: {len(path)}', file=sys.stderr)

    # 简化
    target_count = 50
    if len(path) > target_count:
        idx = np.linspace(0, len(path) - 1, target_count).astype(int)
        path = [path[i] for i in idx]

    print(f'final points: {len(path)}', file=sys.stderr)
    print(f'first 5: {path[:5]}', file=sys.stderr)
    print(f'last 5: {path[-5:]}', file=sys.stderr)

    return {
        'color': 'dark',
        'width': int(w),
        'height': int(h),
        'start': [path[0][0], path[0][1]],
        'end': [path[-1][0], path[-1][1]],
        'points': [{'x': int(x), 'y': int(y)} for x, y in path],
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: detect_z.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = find_z_curve(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
