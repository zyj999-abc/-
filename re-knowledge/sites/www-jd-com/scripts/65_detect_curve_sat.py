#!/usr/bin/env python3
"""
65_detect_curve_sat.py

检测 jcap 轨迹绘制验证码的曲线。
策略：背景是彩色高饱和度，轨迹是低饱和度的灰色。
按列找饱和度最低的点作为曲线点。
"""
import sys
import json
import cv2
import numpy as np


def find_curve_by_saturation(img_path):
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': f'cannot read {img_path}'}
    h, w = img.shape[:2]
    print(f'image size: {w}x{h}', file=sys.stderr)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]  # saturation: 0-255

    # 阈值：低饱和度 = 灰 = 轨迹
    threshold = 100
    gray_mask = (sat < threshold).astype(np.uint8) * 255

    # 形态学去噪
    kernel = np.ones((3, 3), np.uint8)
    gray_mask = cv2.morphologyEx(gray_mask, cv2.MORPH_CLOSE, kernel)
    gray_mask = cv2.morphologyEx(gray_mask, cv2.MORPH_OPEN, kernel)

    cv2.imwrite('/tmp/jd_track/65_gray_mask.png', gray_mask)

    # 找最大连通域
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(gray_mask, connectivity=8)
    print(f'connected components: {num_labels}', file=sys.stderr)

    if num_labels <= 1:
        return {'error': 'no curve found'}

    # 按面积排序，找前 5 个最大连通域，看哪个最像一条曲线
    candidates = []
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        w_box = stats[i, cv2.CC_STAT_WIDTH]
        h_box = stats[i, cv2.CC_STAT_HEIGHT]
        # 曲线的 bbox 应该比面积小（细长）或者大（粗矩形）
        # 用长宽比过滤
        ratio = max(w_box, h_box) / max(1, min(w_box, h_box))
        if area > 200:  # 至少 200 像素
            candidates.append((i, area, w_box, h_box, ratio))
    candidates.sort(key=lambda x: -x[1])

    print('top candidates:', candidates[:5], file=sys.stderr)

    if not candidates:
        return {'error': 'no curve found'}

    # 选最大面积的
    max_idx = candidates[0][0]
    max_area = candidates[0][1]
    curve_mask = (labels == max_idx).astype(np.uint8) * 255
    print(f'max component: {max_idx}, area: {max_area}', file=sys.stderr)

    cv2.imwrite('/tmp/jd_track/65_curve.png', curve_mask)

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

    # 简化到 30-50 个点
    target_count = 40
    if len(points) > target_count:
        idx = np.linspace(0, len(points) - 1, target_count).astype(int)
        points = [points[i] for i in idx]

    print(f'final points: {len(points)}', file=sys.stderr)

    return {
        'color': 'gray',
        'width': w,
        'height': h,
        'points': [{'x': int(x), 'y': int(y)} for x, y in points],
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: detect_curve_sat.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = find_curve_by_saturation(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
