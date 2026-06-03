#!/usr/bin/env python3
"""
69_detect_z_lr.py

检测 jcap Z 形轨迹，用 BFS 但只允许向右走，生成从左到右的连续路径。
"""
import sys
import json
import cv2
import numpy as np
from collections import deque


def find_z_curve_lr(img_path):
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
    left_x = int(xs.min())
    left_y = int(ys[xs == left_x].mean())

    # 找最右点
    right_x = int(xs.max())
    right_y = int(ys[xs == right_x].mean())

    # 用 BFS 但只允许向右走（右优先）
    # 实际上更简单：直接按 x 排序，然后去重
    # 关键：每列只取 y 值，离前一个点的 y 最近的那个 y

    sorted_points = sorted([(int(x), int(y)) for y, x in zip(ys, xs)], key=lambda p: p[0])

    # 简化：保留唯一的 x（每列一个 y）
    col_y = {}
    for x, y in sorted_points:
        if x not in col_y:
            col_y[x] = []
        col_y[x].append(y)

    # 为每列选一个 y（用与上一列 y 最近的）
    cols = sorted(col_y.keys())
    if not cols:
        return {'error': 'no columns'}

    path = []
    prev_y = (col_y[cols[0]][0] + col_y[cols[0]][-1]) // 2 if len(col_y[cols[0]]) > 1 else col_y[cols[0]][0]
    for x in cols:
        ys_col = col_y[x]
        if len(ys_col) == 1:
            y = ys_col[0]
        else:
            # 选离 prev_y 最近的
            y = min(ys_col, key=lambda yy: abs(yy - prev_y))
        path.append((x, y))
        prev_y = y

    # 等间距采样
    target_count = 50
    if len(path) > target_count:
        idx = np.linspace(0, len(path) - 1, target_count).astype(int)
        path = [path[i] for i in idx]

    print(f'final points: {len(path)}', file=sys.stderr)
    print(f'first 10: {path[:10]}', file=sys.stderr)
    print(f'last 5: {path[-5:]}', file=sys.stderr)

    return {
        'color': 'dark',
        'width': int(w),
        'height': int(h),
        'start': [left_x, left_y],
        'end': [right_x, right_y],
        'points': [{'x': int(x), 'y': int(y)} for x, y in path],
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: detect_z_lr.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = find_z_curve_lr(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
