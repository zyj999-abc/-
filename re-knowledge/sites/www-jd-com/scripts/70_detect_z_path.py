#!/usr/bin/env python3
"""
70_detect_z_path.py

检测 jcap Z 形轨迹，沿着最大连通域的轮廓中心线走。
"""
import sys
import json
import cv2
import numpy as np


def find_z_curve_path(img_path):
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

    # 找最大连通域
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(dark_mask, connectivity=8)
    candidates = [(i, stats[i, cv2.CC_STAT_AREA]) for i in range(1, num_labels) if stats[i, cv2.CC_STAT_AREA] > 500]
    candidates.sort(key=lambda x: -x[1])

    if not candidates:
        return {'error': 'no curve found'}

    max_idx = candidates[0][0]
    curve_mask = (labels == max_idx).astype(np.uint8) * 255

    # 用距离变换找中心线（中轴）
    dist = cv2.distanceTransform(curve_mask, cv2.DIST_L2, 5)
    # 找距离最大的点（中心）
    max_dist = dist.max()
    print(f'max distance: {max_dist}', file=sys.stderr)

    # 二值化距离图（取距离 > max_dist * 0.5 的点作为骨架）
    skeleton = (dist > max_dist * 0.5).astype(np.uint8) * 255
    cv2.imwrite('/tmp/jd_track/70_skeleton.png', skeleton)

    # 找骨架的端点
    ys, xs = np.where(skeleton > 0)
    if len(xs) == 0:
        return {'error': 'no skeleton points'}

    # 找最左点
    left_x = int(xs.min())
    left_y = int(ys[xs == left_x].mean())

    # 找最右点
    right_x = int(xs.max())
    right_y = int(ys[xs == right_x].mean())

    # 路径化：按 x 排序，每列取 y 中位数
    col_y = {}
    for x, y in zip(xs, ys):
        if x not in col_y:
            col_y[int(x)] = []
        col_y[int(x)].append(int(y))

    # 排序列
    cols = sorted(col_y.keys())

    # 用最近邻选择每列 y
    path = []
    if cols:
        prev_y = (col_y[cols[0]][0] + col_y[cols[0]][-1]) // 2 if len(col_y[cols[0]]) > 1 else col_y[cols[0]][0]
        for x in cols:
            ys_col = col_y[x]
            if len(ys_col) == 1:
                y = ys_col[0]
            else:
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
        print('usage: detect_z_path.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = find_z_curve_path(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
