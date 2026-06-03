#!/usr/bin/env python3
"""
64_detect_curve.py

检测 jcap 轨迹绘制验证码的曲线。
策略：颜色过滤后，对每列找到曲线点（亮度最高/颜色最匹配的点）。
返回从左到右的曲线点序列。
"""
import sys
import json
import cv2
import numpy as np


def hex_to_rgb(hex_color):
    h = hex_color.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def find_curve_by_columns(img_path, target_color='#ff3b30'):
    """
    对每列找曲线点：颜色距离最小或饱和度最高。
    """
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': f'cannot read {img_path}'}
    h, w = img.shape[:2]
    print(f'image size: {w}x{h}', file=sys.stderr)

    b, g, r = cv2.split(img.astype(np.int16))
    tr, tg, tb = hex_to_rgb(target_color)

    # 计算颜色距离
    dist = np.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2)

    # 阈值化（距离小于阈值的像素是曲线）
    threshold = 80
    mask = (dist < threshold).astype(np.uint8) * 255

    # 形态学去噪
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    cv2.imwrite('/tmp/jd_track/64_mask.png', mask)

    # 找最大连通域
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    print(f'connected components: {num_labels}', file=sys.stderr)

    if num_labels <= 1:
        return {'error': 'no curve found'}

    max_idx = 1
    max_area = stats[1, cv2.CC_STAT_AREA]
    for i in range(2, num_labels):
        if stats[i, cv2.CC_STAT_AREA] > max_area:
            max_area = stats[i, cv2.CC_STAT_AREA]
            max_idx = i

    curve_mask = (labels == max_idx).astype(np.uint8) * 255
    print(f'max component: {max_idx}, area: {max_area}', file=sys.stderr)

    cv2.imwrite('/tmp/jd_track/64_curve.png', curve_mask)

    # 对每列找曲线中心 y
    points = []
    for x in range(w):
        col = curve_mask[:, x]
        ys = np.where(col > 0)[0]
        if len(ys) > 0:
            # 取中心
            y = int(np.mean(ys))
            points.append((x, y))

    if len(points) < 5:
        return {'error': f'too few points: {len(points)}'}

    # 简化到 30-50 个点（等间距）
    target_count = 40
    if len(points) > target_count:
        idx = np.linspace(0, len(points) - 1, target_count).astype(int)
        points = [points[i] for i in idx]

    print(f'final points: {len(points)}', file=sys.stderr)

    return {
        'color': target_color,
        'width': w,
        'height': h,
        'points': [{'x': int(x), 'y': int(y)} for x, y in points],
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: detect_curve.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = find_curve_by_columns(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
