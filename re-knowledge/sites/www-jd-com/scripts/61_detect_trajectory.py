#!/usr/bin/env python3
"""
61_detect_trajectory.py

检测 jcap tp=26 "请按照图中轨迹绘制" 验证码的轨迹曲线。
返回轨迹点序列（图像坐标系）。
"""
import sys
import json
import cv2
import numpy as np


def hex_to_bgr(hex_color):
    h = hex_color.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b, g, r)  # OpenCV 用 BGR


def find_line_in_image(img_path):
    img = cv2.imread(img_path)
    if img is None:
        return {'error': f'cannot read {img_path}'}
    h, w = img.shape[:2]
    print(f'image size: {w}x{h}', file=sys.stderr)

    b, g, r = cv2.split(img.astype(np.int16))

    # 京东 jcap 默认曲线颜色
    candidate_colors = [
        ('#ff3b30', (255, 59, 48)),   # red
        ('#34c759', (52, 199, 89)),    # green
        ('#0a84ff', (10, 132, 255)),   # blue
    ]

    best_mask = None
    best_color = None
    best_count = 0

    for name, (cr, cg, cb) in candidate_colors:
        # 计算与该颜色的距离
        dist = np.sqrt((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2)
        # 距离 < 80 算匹配
        mask = (dist < 80).astype(np.uint8) * 255
        count = mask.sum() // 255
        print(f'  {name}: {count} pixels', file=sys.stderr)
        if count > best_count and count > 100:
            best_count = count
            best_mask = mask
            best_color = name

    if best_mask is None:
        return {'error': 'no curve found with default colors, try color picking'}

    print(f'best color: {best_color}, {best_count} pixels', file=sys.stderr)

    # 保存 mask 调试
    cv2.imwrite('/tmp/jd_track/61_mask.png', best_mask)

    # 用形态学操作去噪
    kernel = np.ones((3, 3), np.uint8)
    best_mask = cv2.morphologyEx(best_mask, cv2.MORPH_CLOSE, kernel)
    best_mask = cv2.morphologyEx(best_mask, cv2.MORPH_OPEN, kernel)

    # 找连通域
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(best_mask, connectivity=8)
    print(f'connected components: {num_labels}', file=sys.stderr)

    if num_labels <= 1:
        return {'error': 'no curve found in mask'}

    # 找最大连通域
    max_idx = 1
    max_area = stats[1, cv2.CC_STAT_AREA]
    for i in range(2, num_labels):
        if stats[i, cv2.CC_STAT_AREA] > max_area:
            max_area = stats[i, cv2.CC_STAT_AREA]
            max_idx = i

    print(f'max component: {max_idx}, area: {max_area}', file=sys.stderr)

    # 提取最大连通域的点
    curve_mask = (labels == max_idx).astype(np.uint8) * 255

    # 骨架化（细化为单像素宽）
    skeleton = None
    try:
        from cv2 import ximgproc
        skeleton = ximgproc.thinning(curve_mask)
    except (ImportError, AttributeError):
        # 旧版 OpenCV 没有 ximgproc，用 skeletonize 替代
        skeleton = skeletonize(curve_mask)

    cv2.imwrite('/tmp/jd_track/61_skeleton.png', skeleton)

    # 提取骨架上的点
    ys, xs = np.where(skeleton > 0)
    if len(xs) < 5:
        return {'error': f'too few skeleton points: {len(xs)}'}

    # 按 x 坐标排序（从左到右）
    points = list(zip(xs.tolist(), ys.tolist()))
    points.sort(key=lambda p: p[0])

    # 进一步简化：按 x 间隔均匀采样
    target_count = 40  # 鼠标轨迹点数量
    if len(points) > target_count:
        idx = np.linspace(0, len(points) - 1, target_count).astype(int)
        points = [points[i] for i in idx]

    print(f'points: {len(points)}', file=sys.stderr)

    return {
        'color': best_color,
        'width': w,
        'height': h,
        'points': [{'x': int(x), 'y': int(y)} for x, y in points],
    }


def skeletonize(img):
    """简易骨架化（Zhang-Suen 算法的简化版本）"""
    img = img.copy() // 255
    skeleton = np.zeros(img.shape, np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    while True:
        opened = cv2.morphologyEx(img, cv2.MORPH_OPEN, kernel)
        temp = cv2.subtract(img, opened)
        eroded = cv2.erode(img, kernel)
        skel = cv2.bitwise_or(skeleton, temp)
        skeleton = skel
        img = eroded.copy()
        if cv2.countNonZero(img) == 0:
            break
    return skeleton * 255


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: detect_trajectory.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = find_line_in_image(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
