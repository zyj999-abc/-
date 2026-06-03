#!/usr/bin/env python3
"""
67_detect_z_curve.py

检测 jcap Z 形轨迹验证码的曲线。
策略：
1. 转灰度，阈值化为暗色区域
2. 找最大连通域（Z 形主体）
3. 找到 Z 的起点和终点，按路径顺序生成点
"""
import sys
import json
import cv2
import numpy as np


def find_z_curve(img_path):
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': f'cannot read {img_path}'}
    h, w = img.shape[:2]
    print(f'image size: {w}x{h}', file=sys.stderr)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 阈值化：暗色 = 轨迹
    _, dark_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)

    cv2.imwrite('/tmp/jd_track/67_dark.png', dark_mask)

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
    curve_mask = (labels == max_idx).astype(np.uint8) * 255
    cv2.imwrite('/tmp/jd_track/67_curve.png', curve_mask)

    # 找 Z 的起点（最左点）
    ys, xs = np.where(curve_mask > 0)
    if len(xs) == 0:
        return {'error': 'no pixels in curve'}

    # 找最左点
    left_x = xs.min()
    left_y = ys[xs == left_x].mean()
    start = (int(left_x), int(left_y))

    # 找最右点
    right_x = xs.max()
    right_y = ys[xs == right_x].mean()
    end = (int(right_x), int(right_y))

    # 找最上点（在同一垂直范围）
    top_y = ys.min()
    top_x = xs[ys == top_y].mean()
    # 找最下点
    bottom_y = ys.max()
    bottom_x = xs[ys == bottom_y].mean()

    print(f'  start (left): {start}', file=sys.stderr)
    print(f'  end (right): {end}', file=sys.stderr)
    print(f'  top: ({int(top_x)}, {int(top_y)})', file=sys.stderr)
    print(f'  bottom: ({int(bottom_x)}, {int(bottom_y)})', file=sys.stderr)

    # 用 skeleton 化简（如果可能）
    try:
        from cv2 import ximgproc
        skeleton = ximgproc.thinning(curve_mask)
    except (ImportError, AttributeError):
        skeleton = curve_mask.copy()

    cv2.imwrite('/tmp/jd_track/67_skeleton.png', skeleton)

    # 用 BFS 沿 skeleton 生成路径
    # 简化：对每列找中点
    points = []
    for x in range(w):
        col = skeleton[:, x]
        ys_col = np.where(col > 0)[0]
        if len(ys_col) > 0:
            y = int(np.mean(ys_col))
            points.append((x, y))

    if len(points) < 5:
        return {'error': f'too few points: {len(points)}'}

    # 等间距采样
    target_count = 50
    if len(points) > target_count:
        idx = np.linspace(0, len(points) - 1, target_count).astype(int)
        points = [points[i] for i in idx]

    print(f'final points: {len(points)}', file=sys.stderr)

    return {
        'color': 'dark',
        'width': w,
        'height': h,
        'start': start,
        'end': end,
        'top': [int(top_x), int(top_y)],
        'bottom': [int(bottom_x), int(bottom_y)],
        'points': [{'x': int(x), 'y': int(y)} for x, y in points],
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: detect_z_curve.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = find_z_curve(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
