#!/usr/bin/env python3
"""
72_detect_z_skeleton_trace.py

用中轴 + DFS 找 Z 形轨迹的端点，然后从一端走到另一端。
"""
import sys
import json
import cv2
import numpy as np
from collections import deque


def trace_skeleton(skeleton):
    """从骨架的一个端点开始，用 DFS 走到另一个端点"""
    h, w = skeleton.shape

    # 找所有端点（只有一个邻居的骨架点）
    endpoints = []
    for y in range(h):
        for x in range(w):
            if skeleton[y, x] == 0:
                continue
            # 8 邻域邻居数
            neighbors = 0
            for dy in [-1, 0, 1]:
                for dx in [-1, 0, 1]:
                    if dy == 0 and dx == 0:
                        continue
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and skeleton[ny, nx] > 0:
                        neighbors += 1
            if neighbors == 1:
                endpoints.append((x, y))

    print(f'endpoints: {len(endpoints)}', file=sys.stderr)
    if not endpoints:
        return None

    # 选最左的端点作为起点
    endpoints.sort(key=lambda p: p[0])
    start = endpoints[0]

    # DFS（递归或迭代）
    visited = np.zeros_like(skeleton, dtype=bool)
    path = []

    def dfs(x, y):
        if visited[y, x]:
            return
        visited[y, x] = True
        path.append((x, y))
        # 8 邻域
        neighbors = []
        for dy in [-1, 0, 1]:
            for dx in [-1, 0, 1]:
                if dy == 0 and dx == 0:
                    continue
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and skeleton[ny, nx] > 0 and not visited[ny, nx]:
                    dist = np.sqrt(dx*dx + dy*dy)
                    neighbors.append((dist, nx, ny))
        # 排序：先访问最近的
        neighbors.sort()
        for _, nx, ny in neighbors:
            dfs(nx, ny)

    sys.setrecursionlimit(50000)
    dfs(start[0], start[1])

    return path


def find_z_curve_skeleton(img_path):
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': f'cannot read {img_path}'}
    h, w = img.shape[:2]
    print(f'image size: {w}x{h}', file=sys.stderr)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 阈值化
    _, dark_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)

    # 形态学
    kernel = np.ones((3, 3), np.uint8)
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_CLOSE, kernel)

    # 找最大连通域
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(dark_mask, connectivity=8)
    candidates = [(i, stats[i, cv2.CC_STAT_AREA]) for i in range(1, num_labels) if stats[i, cv2.CC_STAT_AREA] > 500]
    candidates.sort(key=lambda x: -x[1])

    if not candidates:
        return {'error': 'no curve found'}

    max_idx = candidates[0][0]
    curve_mask = (labels == max_idx).astype(np.uint8) * 255

    # 用距离变换找中心线
    dist = cv2.distanceTransform(curve_mask, cv2.DIST_L2, 5)
    max_dist = dist.max()
    # 取距离 > max_dist * 0.3 作为骨架
    skeleton = (dist > max_dist * 0.3).astype(np.uint8)

    # 骨架化（去分支）
    # 用形态学细化
    try:
        from cv2 import ximgproc
        skeleton_thin = ximgproc.thinning(curve_mask)
    except (ImportError, AttributeError):
        skeleton_thin = skeleton * 255

    cv2.imwrite('/tmp/jd_track/72_skeleton.png', skeleton_thin)
    print(f'skeleton size: {(skeleton_thin > 0).sum()} pixels', file=sys.stderr)

    # 找端点
    path = trace_skeleton(skeleton_thin)
    if not path or len(path) < 5:
        return {'error': f'path too short: {len(path) if path else 0}'}

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
        print('usage: detect_z_skeleton.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = find_z_curve_skeleton(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
