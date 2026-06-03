#!/usr/bin/env python3
"""
63_detect_rotation.py

检测 jcap 验证码 b1 圆形图的旋转角度。

b1 是圆形剪裁图，包含一个被旋转的自然场景。
策略：找到场景的"自然水平线"（天空/地面边界或主轴方向），
      计算需要旋转多少度才能让水平线变水平。
"""
import sys
import json
import cv2
import numpy as np


def detect_rotation(img_path):
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': f'cannot read {img_path}'}
    h, w = img.shape[:2]
    print(f'image size: {w}x{h}', file=sys.stderr)

    if w != h:
        print(f'WARNING: not square ({w}x{h})', file=sys.stderr)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # 策略 1: 用 Hough 找主直线（找最长水平线）
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 30, minLineLength=15, maxLineGap=5)

    hough_angles = []
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            if x2 - x1 == 0:
                continue
            a = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            hough_angles.append(a)
        hough_angles = np.array(hough_angles)
        print(f'hough lines: {len(hough_angles)}', file=sys.stderr)

    # 策略 2: 用色彩分布检测"地平线"（通常天空在顶部，地面在底部）
    # 计算每行的平均饱和度或亮度
    sat = hsv[:, :, 1]  # saturation
    val = hsv[:, :, 2]  # value
    row_sat = sat.mean(axis=1)
    row_val = val.mean(axis=1)

    # 找到饱和度或亮度变化最大的行（地平线位置）
    sat_grad = np.abs(np.gradient(row_sat))
    val_grad = np.abs(np.gradient(row_val))
    horizon_row = np.argmax(sat_grad + val_grad)

    # 策略 3: 用模板匹配找到与原图最相似的旋转角度
    # （但我们需要知道原图，这不可行）

    # 策略 4: 检测主要边缘方向
    if lines is not None and len(hough_angles) > 5:
        # 用 RANSAC 找主方向
        from sklearn.linear_model import RANSACRegressor
        # 对角度做直方图
        hist, bin_edges = np.histogram(hough_angles, bins=180, range=(-90, 90))
        # 平滑
        hist_smooth = np.convolve(hist, np.ones(5)/5, mode='same')
        peak_idx = np.argmax(hist_smooth)
        peak_angle = bin_edges[peak_idx]
        # 旋转角 = -peak_angle (让线变水平)
        angle = -peak_angle
        method = 'hough_histogram'
    else:
        # Fallback: 找图中最长的水平结构
        # 对每一行，计算水平方向的梯度
        angle = 0
        method = 'fallback'

    return {
        'angle': float(angle),
        'method': method,
        'width': w,
        'height': h,
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: detect_rotation.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = detect_rotation(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
