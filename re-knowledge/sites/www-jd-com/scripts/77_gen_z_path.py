#!/usr/bin/env python3
"""
77_generate_z_path.py

基于 captcha 的固定结构生成 Z 形轨迹：
- Top horizontal: at 15% y
- Diagonal: from top-right to bottom-left
- Bottom horizontal: at 70% y
"""
import sys
import json


def gen_z_path(w, h, n_per_segment=20):
    """生成 Z 形轨迹点（图像坐标系）"""
    # Z 的关键位置
    top_y = int(h * 0.18)
    bottom_y = int(h * 0.78)
    left_x = int(w * 0.10)
    right_x = int(w * 0.85)

    points = []

    # 1. Top horizontal: (left_x, top_y) → (right_x, top_y)
    for i in range(n_per_segment):
        t = i / (n_per_segment - 1)
        x = left_x + t * (right_x - left_x)
        points.append((int(x), top_y))

    # 2. Diagonal: (right_x, top_y) → (left_x, bottom_y)
    for i in range(n_per_segment):
        t = i / (n_per_segment - 1)
        x = right_x + t * (left_x - right_x)
        y = top_y + t * (bottom_y - top_y)
        points.append((int(x), int(y)))

    # 3. Bottom horizontal: (left_x, bottom_y) → (right_x, bottom_y)
    for i in range(n_per_segment):
        t = i / (n_per_segment - 1)
        x = left_x + t * (right_x - left_x)
        points.append((int(x), bottom_y))

    return points


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('usage: gen_z.py <width> <height>', file=sys.stderr)
        sys.exit(1)
    w = int(sys.argv[1])
    h = int(sys.argv[2])
    points = gen_z_path(w, h)
    print(json.dumps({
        'width': w,
        'height': h,
        'points': [{'x': int(x), 'y': int(y)} for x, y in points],
    }, ensure_ascii=False))
