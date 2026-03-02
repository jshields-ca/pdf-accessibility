#!/usr/bin/env python3
"""
PDF Accessibility Remediator
Applies structural fixes using pikepdf that pdf-lib cannot perform.
Reads fixes specification from argv as JSON and outputs result JSON to stdout.
"""

import sys
import json
import os


def remediate(input_path, output_path, fixes):
    """
    Apply accessibility fixes to a PDF using pikepdf.

    fixes dict keys (all optional, default False/None):
      setLanguage      (str)  - BCP-47 language tag to set as /Lang, e.g. "en"
      markTagged       (bool) - Set MarkInfo/Marked = true
      displayDocTitle  (bool) - Set ViewerPreferences/DisplayDocTitle = true
      formTooltips     (bool) - Add /TU tooltip to AcroForm fields that lack one
    """
    result = {
        "success": False,
        "fixesApplied": [],
        "errors": [],
    }

    try:
        import pikepdf
    except ImportError:
        result["errors"].append(
            "pikepdf not installed - run: pip install pikepdf"
        )
        print(json.dumps(result))
        return result

    try:
        with pikepdf.open(input_path, allow_overwriting_input=False) as pdf:

            # -- Set document language --
            if fixes.get("setLanguage"):
                lang = str(fixes["setLanguage"]).strip()
                if lang:
                    pdf.Root["/Lang"] = pikepdf.String(lang)
                    result["fixesApplied"].append(
                        "Set document language to '" + lang + "'"
                    )

            # -- Mark document as tagged (formal flag; does not add StructTree) --
            if fixes.get("markTagged"):
                if "/MarkInfo" not in pdf.Root:
                    pdf.Root["/MarkInfo"] = pikepdf.Dictionary(Marked=True)
                else:
                    pdf.Root["/MarkInfo"]["/Marked"] = True
                result["fixesApplied"].append("Set MarkInfo/Marked = true")

            # -- Set DisplayDocTitle so title bar shows PDF title --
            if fixes.get("displayDocTitle"):
                if "/ViewerPreferences" not in pdf.Root:
                    pdf.Root["/ViewerPreferences"] = pikepdf.Dictionary(
                        DisplayDocTitle=True
                    )
                else:
                    pdf.Root["/ViewerPreferences"]["/DisplayDocTitle"] = True
                result["fixesApplied"].append(
                    "Set ViewerPreferences/DisplayDocTitle = true"
                )

            # -- Add tooltips (/TU) to form fields that lack them --
            if fixes.get("formTooltips") and "/AcroForm" in pdf.Root:
                try:
                    acroform = pdf.Root["/AcroForm"]
                    if "/Fields" in acroform:
                        count = 0
                        for field_ref in acroform["/Fields"]:
                            try:
                                existing_tu = field_ref.get("/TU")
                                has_tu = bool(
                                    existing_tu
                                    and str(existing_tu) not in ("None", "null", "")
                                )
                                if not has_tu:
                                    name = str(field_ref.get("/T", f"Field {count + 1}"))
                                    field_ref["/TU"] = pikepdf.String(
                                        "Please enter: " + name
                                    )
                                    count += 1
                            except Exception:
                                pass
                        if count > 0:
                            result["fixesApplied"].append(
                                f"Added tooltips to {count} form field(s)"
                            )
                except Exception as e:
                    result["errors"].append("Form tooltip fix error: " + str(e))

            pdf.save(output_path)
            result["success"] = True

    except Exception as e:
        result["errors"].append("Remediation error: " + str(e))

    return result


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(
            json.dumps({
                "error": "Usage: remediate_pdf.py <input_path> <output_path> <fixes_json>"
            })
        )
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    fixes_raw = sys.argv[3]

    if not os.path.isfile(input_path):
        print(json.dumps({"error": "Input file not found: " + input_path}))
        sys.exit(1)

    try:
        fixes = json.loads(fixes_raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": "Invalid fixes JSON: " + str(e)}))
        sys.exit(1)

    try:
        output = remediate(input_path, output_path, fixes)
        print(json.dumps(output))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
