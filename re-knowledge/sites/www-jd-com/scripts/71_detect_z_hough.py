#!/usr/bin/env python3
"""
71_detect_z_hough.py

用 Hough 找 3 条主直线（Z 的 3 个笔画），按顺序拼接。
"""
import sys
import json
import cv2
import numpy as np


def find_z_curve_hough(img_path):
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if img is None:
        return {'error': f'cannot read {img_path}'}
    h, w = img.shape[:2]
    print(f'image size: {w}x{h}', file=sys.stderr)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 二值化（暗色 = 轨迹）
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

    # Hough 检测
    edges = cv2.Canny(curve_mask, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, 30, minLineLength=20, maxLineGap=10)

    if lines is None:
        return {'error': 'no lines found'}

    # 计算每条线的信息
    line_info = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        length = np.sqrt((x2-x1)**2 + (y2-y1)**2)
        angle = np.degrees(np.arctan2(y2-y1, x2-x1))
        # 归一化角度
        if angle < 0:
            angle += 180
        # 找线的中点
        cx = (x1+x2)/2
        cy = (y1+y2)/2
        line_info.append({
            'x1': int(x1), 'y1': int(y1), 'x2': int(x2), 'y2': int(y2),
            'length': float(length), 'angle': float(angle),
            'cx': float(cx), 'cy': float(cy),
        })

    # 合并相似的线（用角度分组）
    # 找 3 个主要角度
    angles = np.array([l['angle'] for l in line_info])
    print(f'lines: {len(line_info)}', file=sys.stderr)

    # 用 RANSAC 找 3 个主方向
    # 简化方法：找 top-3 不同角度的线
    if len(line_info) < 3:
        return {'error': f'too few lines: {len(line_info)}'}

    # 按长度排序
    line_info.sort(key=lambda x: -x['length'])

    # 选 top 6 条（让 3 个方向各 2 条线）
    top_lines = line_info[:30]

    # 找 3 个簇（按角度聚类）
    # 简化：用 3 个候选角度（0, 45, 135）找最近的
    target_angles = [0, 45, 135]
    best_for_angle = {a: None for a in target_angles}
    for line in top_lines:
        for ta in target_angles:
            diff = min(abs(line['angle'] - ta), abs(line['angle'] - ta + 180))
            if diff < 15:  # 角度容差 15 度
                if best_for_angle[ta] is None or line['length'] > best_for_angle[ta]['length']:
                    best_for_angle[ta] = line

    # 找最长的水平线（顶/底横线）
    horizontals = sorted([l for l in top_lines if abs(l['angle'] - 0) < 15 or abs(l['angle'] - 180) < 15], key=lambda x: -x['length'])[:2]
    # 找最长的对角线
    diagonals = sorted([l for l in top_lines if 20 < l['angle'] < 70 or 110 < l['angle'] < 160], key=lambda x: -x['length'])[:1]

    print(f'horizontals: {len(horizontals)}, diagonals: {len(diagonals)}', file=sys.stderr)
    for l in horizontals:
        print(f'  H: ({l["x1"]},{l["y1"]})-({l["x2"]},{l["y2"]}) angle={l["angle"]:.0f} len={l["length"]:.0f}', file=sys.stderr)
    for l in diagonals:
        print(f'  D: ({l["x1"]},{l["y1"]})-({l["x2"]},{l["y2"]}) angle={l["angle"]:.0f} len={l["length"]:.0f}', file=sys.stderr)

    if len(horizontals) < 2 or len(diagonals) < 1:
        return {'error': f'need 2 horizontals + 1 diagonal, got H={len(horizontals)} D={len(diagonals)}'}

    # 排序：上横线 y 最小，下横线 y 最大
    horizontals.sort(key=lambda l: l['cy'])
    top_h = horizontals[0]
    bottom_h = horizontals[1]
    diag = diagonals[0]

    # 生成 3 段的轨迹点
    def gen_line_points(line, n):
        x1, y1, x2, y2 = line['x1'], line['y1'], line['x2'], line['y2']
        pts = []
        for i in range(n):
            t = i / max(1, n - 1)
            x = x1 + t * (x2 - x1)
            y = y1 + t * (y2 - y1)
            pts.append((x, y))
        return pts

    n_per_segment = 20
    p_top = gen_line_points(top_h, n_per_segment)
    p_diag = gen_line_points(diag, n_per_segment)
    p_bot = gen_line_points(bottom_h, n_per_segment)

    # 拼接：top → diag → bot
    path = p_top + p_diag + p_bot

    # 转 int
    path = [(int(round(x)), int(round(y))) for x, y in path]

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
        print('usage: detect_z_hough.py <image_path>', file=sys.stderr)
        sys.exit(1)
    result = find_z_curve_hough(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
