#!/usr/bin/env python3
"""
75_detect_z_skim.py

用 scikit-image 的 skeletonize + 端点 BFS 找 Z 形路径。
"""
import sys
import json
import cv2
import numpy as np
from skimage.morphology import skeletonize
from collections import deque


def trace_path_skim(img_path):
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': f'cannot read {img_path}'}
    h, w = img.shape[:2]
    print(f'image size: {w}x{h}', file=sys.stderr)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 阈值化
    _, dark_mask = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)

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
    curve_mask = (labels == max_idx).astype(np.uint8)

    # skimage skeletonize
    sk = skeletonize(curve_mask > 0)
    skeleton = sk.astype(np.uint8) * 255
    cv2.imwrite('/tmp/jd_track/75_skeleton.png', skeleton)
    print(f'skeleton pixels: {(skeleton > 0).sum()}', file=sys.stderr)

    # 找所有端点（1 个邻居）
    H, W = skeleton.shape
    endpoints = []
    for y in range(H):
        for x in range(W):
            if skeleton[y, x] == 0:
                continue
            n = 0
            for dy in [-1, 0, 1]:
                for dx in [-1, 0, 1]:
                    if dy == 0 and dx == 0:
                        continue
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < H and 0 <= nx < W and skeleton[ny, nx] > 0:
                        n += 1
            if n == 1:
                endpoints.append((x, y))
    print(f'endpoints: {endpoints}', file=sys.stderr)

    if len(endpoints) < 2:
        # 退化为最左和最右
        ys, xs = np.where(skeleton > 0)
        left_x = int(xs.min())
        left_y = int(ys[xs == left_x].mean())
        right_x = int(xs.max())
        right_y = int(ys[xs == right_x].mean())
        endpoints = [(left_x, left_y), (right_x, right_y)]

    # 选最左和最右作为 path 端点
    endpoints.sort(key=lambda p: p[0])
    start = endpoints[0]
    end = endpoints[-1]
    print(f'BFS from {start} to {end}', file=sys.stderr)

    # BFS
    visited = np.zeros_like(skeleton, dtype=bool)
    visited[start[1], start[0]] = True
    queue = deque([((start[0], start[1]), [start])])

    path = None
    max_iter = 5000
    while queue and max_iter > 0:
        max_iter -= 1
        (cx, cy), p = queue.popleft()
        if (cx, cy) == end:
            path = p
            break
        # 8 邻域
        neighbors = []
        for dy in [-1, 0, 1]:
            for dx in [-1, 0, 1]:
                if dy == 0 and dx == 0:
                    continue
                nx, ny = cx + dx, cy + dy
                if 0 <= ny < H and 0 <= nx < W and skeleton[ny, nx] > 0 and not visited[ny, nx]:
                    dist = (nx - end[0])**2 + (ny - end[1])**2
                    neighbors.append((dist, nx, ny))
        neighbors.sort()
        for _, nx, ny in neighbors:
            visited[ny, nx] = True
            queue.append(((nx, ny), p + [(nx, ny)]))

    if not path:
        # 退化：用所有点按 x 排序
        ys, xs = np.where(skeleton > 0)
        path = sorted([(int(x), int(y)) for y, x in zip(ys, xs)], key=lambda p: p[0])

    print(f'path length: {len(path)}', file=sys.stderr)

    # 简化
    target_count = 60
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
        print('usage: detect_z_skim.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = trace_path_skim(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
