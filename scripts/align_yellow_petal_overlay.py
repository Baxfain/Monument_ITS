#!/usr/bin/env python3
"""Align the rendered yellow petal masks to the source by one uniform fit.

The only image transform is a uniform scale and translation fitted from the
center petal apex/root pair. The measurements are visual pixel comparisons,
not calibrated physical dimensions.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs/planning/evidence/yellow-petal-traced"
FRONT_CAPTURE = ROOT / "docs/planning/evidence/emblem-contour/stage-yellow-petal-traced-front.png"
LABEL_MASK = EVIDENCE / "source-petal-label-mask.png"
TRACE_REPORT = EVIDENCE / "source-yellow-contours.json"
PETAL_NAMES = ("outerLeft", "innerLeft", "center", "innerRight", "outerRight")
RENDER_HSV_LOW = (15, 45, 70)
# The rendered leaf materials sit at HSV hue 34; the yellow emblem faces sit
# at hue 27–29. Keeping this cut tight prevents foliage behind the flower from
# joining an edge component at the shared lower area.
RENDER_HSV_HIGH = (32, 255, 255)
RENDER_MIN_COMPONENT_AREA = 1000
RENDER_CENTER_X_FRACTION = (0.35, 0.67)
RENDER_TOP_Y_FRACTION = 0.48
PROFILE_FRACTIONS = (0.2, 0.35, 0.5, 0.65, 0.8)
SIDE_PROFILE_FRACTIONS = (0.15, 0.3, 0.5, 0.7, 0.85)
SEAM_CENTER_HEIGHTS = (0.35, 0.5, 0.65)
OVERLAY_SOURCE = (0, 210, 255)
OVERLAY_RENDER = (255, 25, 155)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def mask_measurements(mask: np.ndarray) -> dict:
    ys, xs = np.where(mask > 0)
    require(len(xs) > 0, "Cannot measure an empty petal mask.")
    top = int(ys.min())
    bottom = int(ys.max())
    tip_x = float(np.mean(xs[ys == top]))
    root_x = float(np.mean(xs[ys == bottom]))
    return {
        "top_xy": [tip_x, float(top)],
        "bottom_xy": [root_x, float(bottom)],
        "bbox_xywh": [int(xs.min()), top, int(xs.max() - xs.min() + 1), int(bottom - top + 1)],
    }


def row_span(mask: np.ndarray, row: int) -> list[int] | None:
    if row < 0 or row >= mask.shape[0]:
        return None
    xs = np.flatnonzero(mask[row] > 0)
    if len(xs) == 0:
        return None
    return [int(xs.min()), int(xs.max()), int(xs.max() - xs.min() + 1)]


def aligned_mask_metrics(source: np.ndarray, rendered: np.ndarray) -> dict:
    source_binary = (source > 0).astype(np.uint8)
    rendered_binary = (rendered > 0).astype(np.uint8)
    intersection = int(np.count_nonzero(source_binary & rendered_binary))
    union = int(np.count_nonzero(source_binary | rendered_binary))
    source_area = int(np.count_nonzero(source_binary))
    rendered_area = int(np.count_nonzero(rendered_binary))

    kernel = np.ones((3, 3), np.uint8)
    source_edges = cv2.morphologyEx(source_binary, cv2.MORPH_GRADIENT, kernel) > 0
    rendered_edges = cv2.morphologyEx(rendered_binary, cv2.MORPH_GRADIENT, kernel) > 0
    distance_from_source = cv2.distanceTransform((~source_edges).astype(np.uint8), cv2.DIST_L2, 3)
    distance_from_render = cv2.distanceTransform((~rendered_edges).astype(np.uint8), cv2.DIST_L2, 3)
    render_to_source = distance_from_source[rendered_edges]
    source_to_render = distance_from_render[source_edges]
    symmetric = np.concatenate((render_to_source, source_to_render))
    tolerance_px = 2.0
    return {
        "source_area_px": source_area,
        "rendered_area_px": rendered_area,
        "intersection_over_union": round(intersection / union, 5) if union else 0,
        "mean_symmetric_boundary_distance_px": round(float(np.mean(symmetric)), 3) if len(symmetric) else None,
        "p95_symmetric_boundary_distance_px": round(float(np.percentile(symmetric, 95)), 3) if len(symmetric) else None,
        "boundary_fraction_within_2px": round(float(np.mean(symmetric <= tolerance_px)), 5) if len(symmetric) else None,
    }


def boundary(mask: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours((mask > 0).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    result = np.zeros(mask.shape, np.uint8)
    if contours:
        cv2.drawContours(result, contours, -1, 1, 1, cv2.LINE_8)
    return result > 0


def width_profiles(mask: np.ndarray, fractions: tuple[float, ...]) -> dict:
    measurements = mask_measurements(mask)
    tip_y = measurements["top_xy"][1]
    bottom_y = measurements["bottom_xy"][1]
    profile = {}
    for fraction in fractions:
        row = round(tip_y + (bottom_y - tip_y) * fraction)
        span = row_span(mask, row)
        profile[f"{fraction:.2f}"] = {"row": row, "span_xyw": span}
    return profile


def make_overlay(source_labels: np.ndarray, render_labels: np.ndarray) -> Image.Image:
    source_any = source_labels > 0
    render_any = render_labels > 0
    canvas = np.empty((*source_labels.shape, 3), np.uint8)
    canvas[:] = (246, 245, 239)
    canvas[source_any] = (
        canvas[source_any].astype(np.float32) * 0.72
        + np.array(OVERLAY_SOURCE, np.float32) * 0.28
    ).astype(np.uint8)
    canvas[render_any] = (
        canvas[render_any].astype(np.float32) * 0.72
        + np.array(OVERLAY_RENDER, np.float32) * 0.28
    ).astype(np.uint8)
    for label_value in range(1, 6):
        source_edges = boundary((source_labels == label_value).astype(np.uint8))
        render_edges = boundary((render_labels == label_value).astype(np.uint8))
        canvas[source_edges] = OVERLAY_SOURCE
        canvas[render_edges] = OVERLAY_RENDER
    image = Image.fromarray(canvas)
    header = 38
    framed = Image.new("RGB", (image.width, image.height + header), (246, 245, 239))
    framed.paste(image, (0, header))
    draw = ImageDraw.Draw(framed)
    font = ImageFont.truetype("DejaVuSans.ttf", 8)
    draw.text((8, 6), "SOURCE cyan | AFTER magenta", fill=(30, 34, 37), font=font)
    draw.text((8, 20), "Uniform scale + translation; tip/root fit", fill=(75, 78, 80), font=font)
    return framed


def main() -> None:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    render_rgb = np.array(Image.open(FRONT_CAPTURE).convert("RGB"))
    source_labels = np.array(Image.open(LABEL_MASK).convert("L"))
    trace_report = json.loads(TRACE_REPORT.read_text(encoding="utf-8"))
    source_origin_x, source_origin_y = trace_report["source_mask"]["crop_origin_full_source_xy"]
    source_mask_width, source_mask_height = trace_report["source_mask"]["crop_size_wh"]
    require(source_labels.shape == (source_mask_height, source_mask_width), "Source label mask dimensions disagree with trace report.")
    require(render_rgb.ndim == 3, "Rendered capture must be an RGB image.")

    render_hsv = cv2.cvtColor(render_rgb, cv2.COLOR_RGB2HSV)
    render_yellow = cv2.inRange(
        render_hsv,
        np.array(RENDER_HSV_LOW, np.uint8),
        np.array(RENDER_HSV_HIGH, np.uint8),
    )
    component_count, component_labels, stats, centroids = cv2.connectedComponentsWithStats(render_yellow, 8)
    center_x_min = render_rgb.shape[1] * RENDER_CENTER_X_FRACTION[0]
    center_x_max = render_rgb.shape[1] * RENDER_CENTER_X_FRACTION[1]
    top_y_max = render_rgb.shape[0] * RENDER_TOP_Y_FRACTION
    petal_components = [
        index
        for index in range(1, component_count)
        if int(stats[index, cv2.CC_STAT_AREA]) >= RENDER_MIN_COMPONENT_AREA
        and center_x_min <= float(centroids[index, 0]) <= center_x_max
        and int(stats[index, cv2.CC_STAT_TOP]) < top_y_max
    ]
    petal_components.sort(key=lambda index: float(centroids[index, 0]))
    require(
        len(petal_components) == 5,
        "Rendered HSV extraction expected five petal components near the flower; "
        f"found {len(petal_components)}. Check capture and thresholds.",
    )
    render_labels_full = np.zeros(component_labels.shape, np.uint8)
    render_component_metadata = []
    for value, (name, component) in enumerate(zip(PETAL_NAMES, petal_components), 1):
        render_labels_full[component_labels == component] = value
        render_component_metadata.append({
            "name": name,
            "area_px": int(stats[component, cv2.CC_STAT_AREA]),
            "bbox_xywh": [int(value) for value in stats[component, :4]],
            "centroid_xy": [round(float(value), 3) for value in centroids[component]],
        })

    render_center = render_labels_full == 3
    source_center = source_labels == 3
    render_anchors = mask_measurements(render_center.astype(np.uint8))
    source_anchors_local = mask_measurements(source_center.astype(np.uint8))
    render_apex = np.array(render_anchors["top_xy"], np.float64)
    render_root = np.array(render_anchors["bottom_xy"], np.float64)
    source_apex = np.array(source_anchors_local["top_xy"], np.float64) + np.array([source_origin_x, source_origin_y])
    source_root = np.array(source_anchors_local["bottom_xy"], np.float64) + np.array([source_origin_x, source_origin_y])
    render_axis_length = float(np.linalg.norm(render_root - render_apex))
    source_axis_length = float(np.linalg.norm(source_root - source_apex))
    require(render_axis_length > 0 and source_axis_length > 0, "Center petal apex/root pair is degenerate.")
    scale = source_axis_length / render_axis_length
    translation_absolute = (source_apex + source_root - scale * (render_apex + render_root)) / 2
    translation_local = translation_absolute - np.array([source_origin_x, source_origin_y])
    transform = np.array(
        [[scale, 0, translation_local[0]], [0, scale, translation_local[1]]],
        np.float64,
    )
    render_labels = cv2.warpAffine(
        render_labels_full,
        transform,
        (source_mask_width, source_mask_height),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )

    transformed_apex = scale * render_apex + translation_absolute
    transformed_root = scale * render_root + translation_absolute
    source_full_x, source_full_y = source_origin_x, source_origin_y
    aligned_reports = {}
    source_axis_x = (source_apex[0] + source_root[0]) / 2
    for index, name in enumerate(PETAL_NAMES, 1):
        source_mask = (source_labels == index).astype(np.uint8)
        rendered_mask = (render_labels == index).astype(np.uint8)
        source_petal_anchors = mask_measurements(source_mask)
        rendered_petal_anchors = mask_measurements(rendered_mask)
        source_tip_lean = source_petal_anchors["top_xy"][0] + source_origin_x - source_axis_x
        rendered_tip_lean = rendered_petal_anchors["top_xy"][0] + source_origin_x - source_axis_x
        aligned_reports[name] = {
            "regions": aligned_mask_metrics(source_mask, rendered_mask),
            "tip_lean_from_center_axis_px": {
                "source": round(float(source_tip_lean), 3),
                "rendered_after_alignment": round(float(rendered_tip_lean), 3),
                "difference": round(float(rendered_tip_lean - source_tip_lean), 3),
            },
            "source_width_profile_from_tip_to_visible_root": width_profiles(source_mask, SIDE_PROFILE_FRACTIONS),
            "render_width_profile_from_tip_to_visible_root": width_profiles(rendered_mask, SIDE_PROFILE_FRACTIONS),
            "source_visible_lower_sweep": source_petal_anchors["bottom_xy"],
            "render_visible_lower_sweep": rendered_petal_anchors["bottom_xy"],
        }

    center_widths = {}
    center_tip_y = source_apex[1] - source_full_y
    center_root_y = source_root[1] - source_full_y
    for fraction in PROFILE_FRACTIONS:
        row = round(center_tip_y + (center_root_y - center_tip_y) * fraction)
        source_span = row_span((source_labels == 3).astype(np.uint8), row)
        render_span = row_span((render_labels == 3).astype(np.uint8), row)
        center_widths[f"{fraction:.2f}"] = {
            "source_row": row,
            "source_span_xyw": source_span,
            "render_span_xyw": render_span,
            "width_delta_px": (render_span[2] - source_span[2]) if source_span and render_span else None,
        }

    seam_profiles = {}
    for left_index in range(1, 5):
        left_name = PETAL_NAMES[left_index - 1]
        right_name = PETAL_NAMES[left_index]
        pair_key = f"{left_name}:{right_name}"
        seam_profiles[pair_key] = {}
        for fraction in SEAM_CENTER_HEIGHTS:
            row = round(center_tip_y + (center_root_y - center_tip_y) * fraction)
            left_source = row_span((source_labels == left_index).astype(np.uint8), row)
            right_source = row_span((source_labels == left_index + 1).astype(np.uint8), row)
            left_render = row_span((render_labels == left_index).astype(np.uint8), row)
            right_render = row_span((render_labels == left_index + 1).astype(np.uint8), row)
            def gap(left_span: list[int] | None, right_span: list[int] | None) -> int | None:
                return right_span[0] - left_span[1] - 1 if left_span and right_span else None
            seam_profiles[pair_key][f"center_height_{fraction:.2f}"] = {
                "row": row,
                "source_gap_px": gap(left_source, right_source),
                "render_gap_px": gap(left_render, right_render),
            }

    source_rgb = np.array(Image.open(ROOT / "assets/reference/emblem-detail.jpeg").convert("RGB"))
    source_crop = source_rgb[
        source_origin_y : source_origin_y + source_mask_height,
        source_origin_x : source_origin_x + source_mask_width,
    ]
    component_overlay = source_crop.copy()
    palette = {
        1: (239, 75, 95), 2: (56, 180, 233), 3: (123, 223, 51),
        4: (218, 76, 231), 5: (62, 102, 232),
    }
    for value, color in palette.items():
        component_overlay[source_labels == value] = (
            component_overlay[source_labels == value].astype(np.float32) * 0.4
            + np.array(color, np.float32) * 0.6
        ).astype(np.uint8)
    Image.fromarray(component_overlay).save(EVIDENCE / "source-component-overlay-native.png")
    Image.fromarray(render_labels_full).save(EVIDENCE / "rendered-after-component-mask.png")
    render_y, render_x = np.where(render_labels_full > 0)
    render_left = max(0, int(render_x.min()) - 8)
    render_top = max(0, int(render_y.min()) - 8)
    render_right = min(render_rgb.shape[1], int(render_x.max()) + 9)
    render_bottom = min(render_rgb.shape[0], int(render_y.max()) + 9)
    render_crop = render_rgb[render_top:render_bottom, render_left:render_right].copy()
    render_label_crop = render_labels_full[render_top:render_bottom, render_left:render_right]
    for value, color in palette.items():
        selected = render_label_crop == value
        render_crop[selected] = (
            render_crop[selected].astype(np.float32) * 0.4 + np.array(color, np.float32) * 0.6
        ).astype(np.uint8)
    render_label_image = Image.fromarray(render_crop)
    label_draw = ImageDraw.Draw(render_label_image)
    for value, name in enumerate(PETAL_NAMES, 1):
        ys, xs = np.where(render_labels_full == value)
        label_draw.text(
            (float(xs.mean()) - render_left, float(ys.mean()) - render_top),
            str(value),
            font=ImageFont.truetype("DejaVuSans-Bold.ttf", 14),
            fill=(255, 255, 255),
            stroke_width=2,
            stroke_fill=(20, 20, 20),
            anchor="mm",
        )
    render_label_image.resize((render_label_image.width * 2, render_label_image.height * 2), Image.Resampling.NEAREST).save(
        EVIDENCE / "rendered-after-component-labels.png"
    )

    overlay = make_overlay(source_labels, render_labels)
    overlay.save(EVIDENCE / "aligned-yellow-reference-after-overlay.png")
    overlay.resize((overlay.width * 3, overlay.height * 3), Image.Resampling.NEAREST).save(
        EVIDENCE / "aligned-yellow-reference-after-overlay-closeup.png"
    )

    source_y, source_x = np.where(source_labels > 0)
    render_y, render_x = np.where(render_labels > 0)
    source_aspect = float((source_x.max() - source_x.min() + 1) / (source_y.max() - source_y.min() + 1))
    render_aspect = float((render_x.max() - render_x.min() + 1) / (render_y.max() - render_y.min() + 1))
    report = {
        "render_capture": FRONT_CAPTURE.relative_to(ROOT).as_posix(),
        "source": trace_report["source"],
        "method": {
            "render_hsv_low_in_opencv_hsv": list(RENDER_HSV_LOW),
            "render_hsv_high_in_opencv_hsv": list(RENDER_HSV_HIGH),
            "render_components_sorted_left_to_right": render_component_metadata,
            "fit": "one uniform scale and x/y translation from center apex/root; no rotation, warp, or independent petal scaling",
            "uniform_scale_render_to_source": round(scale, 7),
            "translation_source_pixels": [round(float(value), 4) for value in translation_absolute],
            "source_center_apex_xy": [round(float(value), 3) for value in source_apex],
            "source_center_root_xy": [round(float(value), 3) for value in source_root],
            "render_center_apex_xy": [round(float(value), 3) for value in render_apex],
            "render_center_root_xy": [round(float(value), 3) for value in render_root],
            "apex_alignment_residual_px": [round(float(value), 3) for value in transformed_apex - source_apex],
            "root_alignment_residual_px": [round(float(value), 3) for value in transformed_root - source_root],
            "source_flower_aspect_ratio": round(source_aspect, 6),
            "aligned_render_flower_aspect_ratio": round(render_aspect, 6),
            "flower_aspect_ratio_difference": round(render_aspect - source_aspect, 6),
            "calibration_limit": "Pixel-space visual comparison only; source camera and physical scale are not calibrated.",
        },
        "central_widths_at_shared_apex_root_fractions": center_widths,
        "side_petal_tip_lean_and_shape_profiles": aligned_reports,
        "adjacent_yellow_region_seam_gaps": seam_profiles,
        "petal_region_comparisons": {
            name: aligned_reports[name]["regions"] for name in PETAL_NAMES
        },
    }
    (EVIDENCE / "aligned-overlay-metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "overlay": str(EVIDENCE / "aligned-yellow-reference-after-overlay.png"),
        "overlay_closeup": str(EVIDENCE / "aligned-yellow-reference-after-overlay-closeup.png"),
        "uniform_scale": round(scale, 7),
        "central_widths": center_widths,
        "per_petal_iou": {name: aligned_reports[name]["regions"]["intersection_over_union"] for name in PETAL_NAMES},
        "center_root_tip_residual_px": {
            "apex": [round(float(value), 3) for value in transformed_apex - source_apex],
            "root": [round(float(value), 3) for value in transformed_root - source_root],
        },
    }, indent=2))


if __name__ == "__main__":
    main()
