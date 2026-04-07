#!/usr/bin/env python3
"""
PDF Accessibility Analyzer
Deep structural analysis using pikepdf and pdfplumber.
Outputs a single JSON object to stdout.
"""

import sys
import json
import os


def compute_relative_luminance(r, g, b):
    """Compute WCAG 2.1 relative luminance from 0-255 sRGB values."""
    def channel(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(l1, l2):
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def analyze(pdf_path):
    result = {
        "isTagged": False,
        "hasLanguage": False,
        "language": None,
        "hasBookmarks": False,
        "pdfVersion": None,
        "imagePages": [],
        "formFields": [],
        "textAnalysis": {
            "possibleHeadings": [],
            "maxFontSize": 0,
            "minFontSize": 0,
            "avgFontSize": 0,
            "hasText": False,
        },
        "contrastIssues": [],
        "pythonLibraries": [],
        "errors": [],
    }

    # --- pikepdf structural analysis ---
    try:
        import pikepdf
        result["pythonLibraries"].append("pikepdf")

        with pikepdf.open(pdf_path) as pdf:
            result["pdfVersion"] = pdf.pdf_version

            # Tagging: MarkInfo/Marked AND StructTreeRoot must both be present
            has_mark_info = False
            has_struct_tree = "/StructTreeRoot" in pdf.Root
            if "/MarkInfo" in pdf.Root:
                try:
                    mark_info = pdf.Root["/MarkInfo"]
                    has_mark_info = bool(mark_info.get("/Marked", False))
                except Exception:
                    pass
            result["isTagged"] = has_mark_info and has_struct_tree

            # Language
            if "/Lang" in pdf.Root:
                try:
                    lang_val = str(pdf.Root["/Lang"])
                    if lang_val and lang_val.lower() not in ("none", "null", ""):
                        result["hasLanguage"] = True
                        result["language"] = lang_val
                except Exception:
                    pass

            # Bookmarks/Outline
            if "/Outlines" in pdf.Root:
                try:
                    outlines = pdf.Root["/Outlines"]
                    result["hasBookmarks"] = "/First" in outlines
                except Exception:
                    pass

            # Images per page via XObject enumeration
            for page_num, page in enumerate(pdf.pages, 1):
                page_images = []
                try:
                    if "/Resources" in page:
                        resources = page["/Resources"]
                        if "/XObject" in resources:
                            xobjects = resources["/XObject"]
                            for name in xobjects.keys():
                                try:
                                    xobj = xobjects[name]
                                    if xobj.get("/Subtype") == "/Image":
                                        page_images.append({
                                            "name": str(name),
                                            # Alt text requires StructTree traversal;
                                            # conservatively assume missing until proven otherwise
                                            "hasAlt": False,
                                            "altText": None,
                                        })
                                except Exception:
                                    pass
                except Exception:
                    pass

                result["imagePages"].append({
                    "page": page_num,
                    "imageCount": len(page_images),
                    "images": page_images,
                })

            # Form fields from AcroForm
            if "/AcroForm" in pdf.Root:
                try:
                    acroform = pdf.Root["/AcroForm"]
                    if "/Fields" in acroform:
                        for field_ref in acroform["/Fields"]:
                            try:
                                name = str(field_ref.get("/T", ""))
                                tooltip = str(field_ref.get("/TU", ""))
                                has_tooltip = bool(
                                    tooltip and tooltip not in ("None", "null", "")
                                )
                                result["formFields"].append({
                                    "name": name,
                                    "hasTooltip": has_tooltip,
                                    "tooltip": tooltip if has_tooltip else None,
                                })
                            except Exception:
                                pass
                except Exception:
                    pass

    except ImportError:
        result["errors"].append("pikepdf not installed - run: pip install pikepdf")
    except Exception as e:
        result["errors"].append("pikepdf error: " + str(e))

    # --- pdfplumber text and contrast analysis ---
    try:
        import pdfplumber
        result["pythonLibraries"].append("pdfplumber")

        with pdfplumber.open(pdf_path) as pdf:
            all_font_sizes = []
            heading_candidates = []
            contrast_issues = []

            for page_num, page in enumerate(pdf.pages, 1):
                chars = page.chars or []
                if not chars:
                    continue

                result["textAnalysis"]["hasText"] = True

                # Collect font sizes
                page_sizes = [
                    c.get("size", 0) for c in chars if (c.get("size") or 0) > 0
                ]
                all_font_sizes.extend(page_sizes)

                if not page_sizes:
                    continue

                median_size = sorted(page_sizes)[len(page_sizes) // 2]

                # Group characters into visual lines by y-position
                lines = {}
                for char in chars:
                    y_key = round(char.get("top", 0))
                    lines.setdefault(y_key, []).append(char)

                for _y, line_chars in sorted(lines.items()):
                    line_text = "".join(
                        c["text"]
                        for c in sorted(line_chars, key=lambda c: c.get("x0", 0))
                    ).strip()
                    if not line_text:
                        continue

                    line_sizes = [
                        c.get("size", 0)
                        for c in line_chars
                        if (c.get("size") or 0) > 0
                    ]
                    avg_size = (
                        sum(line_sizes) / len(line_sizes) if line_sizes else median_size
                    )
                    is_bold = any(
                        "bold" in (c.get("fontname") or "").lower()
                        for c in line_chars
                    )

                    # Heading heuristic: significantly larger than body text, short line
                    if avg_size >= median_size * 1.15 and len(line_text) < 150:
                        heading_candidates.append({
                            "text": line_text,
                            "page": page_num,
                            "fontSize": round(avg_size, 1),
                            "isBold": is_bold,
                        })

                # Contrast: sample text colors vs white background
                sampled = set()
                for char in chars[:300]:
                    color = char.get("non_stroking_color")
                    if not isinstance(color, (list, tuple)) or len(color) < 3:
                        continue
                    try:
                        r, g, b = (int(round(c * 255)) for c in color[:3])
                    except (TypeError, ValueError):
                        continue

                    key = (r, g, b)
                    if key in sampled or key == (0, 0, 0):
                        # Skip black (always passes) and duplicates
                        continue
                    sampled.add(key)

                    text_lum = compute_relative_luminance(r, g, b)
                    white_lum = compute_relative_luminance(255, 255, 255)
                    ratio = contrast_ratio(text_lum, white_lum)

                    if ratio < 4.5:
                        contrast_issues.append({
                            "page": page_num,
                            "textColor": {"r": r, "g": g, "b": b},
                            "contrastRatio": round(ratio, 2),
                            "meetsAA": ratio >= 4.5,
                            "meetsAAA": ratio >= 7.0,
                        })

            if all_font_sizes:
                result["textAnalysis"]["maxFontSize"] = round(max(all_font_sizes), 1)
                result["textAnalysis"]["minFontSize"] = round(min(all_font_sizes), 1)
                result["textAnalysis"]["avgFontSize"] = round(
                    sum(all_font_sizes) / len(all_font_sizes), 1
                )

            # Cap lists to keep JSON payload reasonable
            result["textAnalysis"]["possibleHeadings"] = heading_candidates[:30]
            result["contrastIssues"] = contrast_issues[:15]

    except ImportError:
        result["errors"].append("pdfplumber not installed - run: pip install pdfplumber")
    except Exception as e:
        result["errors"].append("pdfplumber error: " + str(e))

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: analyze_pdf.py <pdf_path>"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.isfile(pdf_path):
        print(json.dumps({"error": "File not found: " + pdf_path}))
        sys.exit(1)

    try:
        output = analyze(pdf_path)
        print(json.dumps(output))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
