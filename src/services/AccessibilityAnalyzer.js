'use strict';

const PDFProcessor = require('./PDFProcessor');
const { analyzePDF } = require('./PythonBridge');
const logger = require('../logger');

class AccessibilityAnalyzer {
  constructor() {
    this.pdfProcessor = new PDFProcessor();
  }

  /**
   * Analyze a PDF for accessibility issues against WCAG 2.1 AA or AAA.
   * Returns { issues: Array, pythonEnhanced: boolean }.
   *
   * When Python libraries (pikepdf, pdfplumber) are available the analysis
   * is authoritative.  When they are not, the analysis falls back to
   * conservative heuristics derived from pdf-parse metadata.
   */
  async analyze(filePath, wcagLevel = 'AA') {
    logger.info({ filePath, wcagLevel }, 'Starting accessibility analysis');

    const pdfInfo = await this.pdfProcessor.extractInfo(filePath);
    const interactive = await this.pdfProcessor.hasInteractiveElements(filePath);

    // Attempt deep Python-powered analysis; returns null on failure
    const py = await analyzePDF(filePath);
    const pythonEnhanced = py !== null;

    if (py && py.errors && py.errors.length > 0) {
      logger.warn({ errors: py.errors }, 'Python analysis partial errors');
    }

    const issues = [];

    issues.push(...this._checkDocumentStructure(pdfInfo, py));
    issues.push(...this._checkTextAlternatives(pdfInfo, py));
    issues.push(...this._checkColorContrast(py));
    issues.push(...this._checkReadingOrder(pdfInfo, py));
    issues.push(...this._checkMetadata(pdfInfo));
    issues.push(...this._checkLanguage(py));
    issues.push(...this._checkHeadingStructure(pdfInfo, py));
    issues.push(...this._checkFormFields(interactive, py));

    if (wcagLevel === 'AAA') {
      issues.push(...this._checkAAAExtensions(py));
    }

    // Sort by severity: critical → moderate → minor
    issues.sort(
      (a, b) => this._severityWeight(a.severity) - this._severityWeight(b.severity)
    );

    logger.info(
      { issueCount: issues.length, pythonEnhanced },
      'Accessibility analysis complete'
    );

    return { issues, pythonEnhanced };
  }

  // ─── Individual checks ──────────────────────────────────────────────────────

  _checkDocumentStructure(pdfInfo, py) {
    const issues = [];

    const isTagged = py ? py.isTagged : false;
    const hasBookmarks = py ? py.hasBookmarks : false;

    if (!isTagged) {
      issues.push({
        id: 'structure-001',
        wcagRule: '1.3.1',
        severity: 'critical',
        title: 'Document is not tagged for accessibility',
        description: py
          ? 'PDF lacks MarkInfo/Marked and/or StructTreeRoot required for screen reader navigation. ' +
            'Tagged PDFs expose the document structure (headings, paragraphs, lists, tables) to ' +
            'assistive technology.'
          : 'Unable to verify PDF tagging status (Python analysis unavailable). ' +
            'Manual verification is required.',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Screen readers cannot navigate the document structure',
        confident: py !== null,
      });
    }

    if (!hasBookmarks && pdfInfo.pageCount > 3) {
      issues.push({
        id: 'structure-002',
        wcagRule: '2.4.5',
        severity: 'moderate',
        title: 'Missing document bookmarks/outline',
        description:
          'Multi-page documents should include a bookmark outline so users can quickly navigate ' +
          'to sections without reading every page.',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Users cannot navigate between sections using the bookmark panel',
        confident: py !== null,
      });
    }

    return issues;
  }

  _checkTextAlternatives(pdfInfo, py) {
    const issues = [];

    if (!py) {
      // Cannot determine image presence without Python — skip rather than false-positive every PDF
      return issues;
    }

    for (const pageDatum of py.imagePages) {
      if (pageDatum.imageCount > 0) {
        issues.push({
          id: `alt-text-p${pageDatum.page}`,
          wcagRule: '1.1.1',
          severity: 'critical',
          title: `Page ${pageDatum.page}: ${pageDatum.imageCount} image(s) detected — alt text unverified`,
          description:
            `${pageDatum.imageCount} image XObject(s) detected on page ${pageDatum.page}. ` +
            'Verifying whether alt text is embedded requires a full PDF/UA structure tree traversal; ' +
            'provide descriptive alt text for all meaningful images.',
          element: 'Image',
          page: pageDatum.page,
          fixable: false,
          impact: 'Screen reader users cannot understand image content without alt text',
          confident: true,
        });
      }
    }

    return issues;
  }

  _checkColorContrast(py) {
    const issues = [];

    if (!py || py.contrastIssues.length === 0) {
      // If Python ran but found no issues, no issue to report.
      // If Python is unavailable, flag for manual review.
      if (!py) {
        issues.push({
          id: 'contrast-001',
          wcagRule: '1.4.3',
          severity: 'moderate',
          title: 'Color contrast requires manual verification',
          description:
            'Automated color contrast analysis requires the Python pdfplumber library. ' +
            'Manually verify that all text has a contrast ratio of at least 4.5:1 against its background.',
          element: 'Text',
          page: 'All',
          fixable: false,
          impact: 'Users with low vision may be unable to read low-contrast text',
          confident: false,
        });
      }
      return issues;
    }

    // Real contrast data from pdfplumber
    for (const ci of py.contrastIssues) {
      const { r, g, b } = ci.textColor;
      issues.push({
        id: `contrast-p${ci.page}-${r}-${g}-${b}`,
        wcagRule: '1.4.3',
        severity: ci.contrastRatio < 3.0 ? 'critical' : 'moderate',
        title: `Page ${ci.page}: Text contrast ratio ${ci.contrastRatio}:1 (below 4.5:1 minimum)`,
        description:
          `Text with RGB color (${r}, ${g}, ${b}) against a white background has a measured contrast ` +
          `ratio of ${ci.contrastRatio}:1, which fails WCAG AA (4.5:1 required for normal text, ` +
          `3:1 for large text). AAA requires 7:1.`,
        element: 'Text',
        page: ci.page,
        fixable: false,
        impact: 'Users with low vision or colour blindness may be unable to read this text',
        confident: true,
      });
    }

    return issues;
  }

  _checkReadingOrder(pdfInfo, py) {
    const issues = [];
    const isTagged = py ? py.isTagged : false;

    // If the document is properly tagged, reading order is defined by the structure tree.
    // If it is not tagged and has text content, reading order is undefined for AT.
    if (!isTagged && pdfInfo.wordCount > 50) {
      issues.push({
        id: 'reading-order-001',
        wcagRule: '1.3.2',
        severity: 'moderate',
        title: 'Reading order undefined — document is not tagged',
        description:
          'Without PDF structural tags, assistive technology reads content in the raw PDF byte ' +
          'stream order, which may differ from the visual/logical reading order (e.g. multi-column ' +
          'layouts, sidebars, footnotes). Tagging the document resolves this.',
        element: 'Document',
        page: 'All',
        fixable: false,
        impact: 'Screen readers may read content out of logical sequence',
        confident: py !== null,
      });
    }

    return issues;
  }

  _checkMetadata(pdfInfo) {
    const issues = [];

    if (!pdfInfo.title) {
      issues.push({
        id: 'metadata-001',
        wcagRule: '2.4.2',
        severity: 'moderate',
        title: 'Missing document title',
        description:
          'The PDF metadata does not include a Title field. Screen readers and browser tabs rely ' +
          'on the document title to identify the file without requiring the user to read the content.',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Users cannot identify the document purpose from its title',
        confident: true,
      });
    }

    if (!pdfInfo.subject) {
      issues.push({
        id: 'metadata-002',
        wcagRule: '2.4.2',
        severity: 'minor',
        title: 'Missing document subject/description',
        description:
          'The PDF metadata does not include a Subject field. This field provides an additional ' +
          'layer of context and is surfaced by many document management systems.',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Document lacks descriptive metadata for cataloguing and search',
        confident: true,
      });
    }

    return issues;
  }

  _checkLanguage(py) {
    const issues = [];

    // If Python is unavailable we cannot reliably detect language presence.
    // pdf-parse doesn't surface the /Lang catalog entry.
    if (!py) {
      issues.push({
        id: 'language-001',
        wcagRule: '3.1.1',
        severity: 'moderate',
        title: 'Document language not verifiable (Python unavailable)',
        description:
          'The primary language of the document could not be verified. Install Python with pikepdf ' +
          'to enable language detection, or manually confirm /Lang is set in the PDF catalog.',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Screen readers may use incorrect pronunciation and language rules',
        confident: false,
      });
      return issues;
    }

    if (!py.hasLanguage) {
      issues.push({
        id: 'language-001',
        wcagRule: '3.1.1',
        severity: 'moderate',
        title: 'Document language not specified',
        description:
          'The PDF catalog does not contain a /Lang entry. Without a declared language, screen ' +
          'readers cannot select the correct voice profile and TTS engine.',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Screen readers may mispronounce content or use wrong language rules',
        confident: true,
      });
    }

    return issues;
  }

  _checkHeadingStructure(pdfInfo, py) {
    const issues = [];

    if (!py) {
      // Fallback: simple regex heuristic (same as original code)
      const lines = pdfInfo.textContent.split('\n').filter((l) => l.trim().length > 0);
      const hasHeadingPattern = lines.some(
        (l) => l.length < 100 && /^[A-Z][A-Za-z\s]+$/.test(l.trim())
      );
      if (!hasHeadingPattern && pdfInfo.wordCount > 200) {
        issues.push({
          id: 'heading-001',
          wcagRule: '1.3.1',
          severity: 'moderate',
          title: 'Heading structure unverifiable (Python unavailable)',
          description:
            'No heading patterns were detected in the text content. A document with substantial ' +
            'text should use a clear heading hierarchy to aid navigation.',
          element: 'Headings',
          page: 'All',
          fixable: false,
          impact: 'Users cannot navigate document by headings',
          confident: false,
        });
      }
      return issues;
    }

    const headings = py.textAnalysis.possibleHeadings || [];
    const hasText = py.textAnalysis.hasText;

    if (hasText && headings.length === 0 && pdfInfo.wordCount > 200) {
      issues.push({
        id: 'heading-001',
        wcagRule: '1.3.1',
        severity: 'moderate',
        title: 'No heading structure detected in document',
        description:
          'Font-size analysis found no text significantly larger than the body font, suggesting ' +
          'the document lacks visual heading differentiation. Proper headings (marked in the ' +
          'structure tree or visually distinct) are essential for navigation.',
        element: 'Headings',
        page: 'All',
        fixable: false,
        impact: 'Users cannot navigate the document by headings using assistive technology',
        confident: true,
      });
    }

    return issues;
  }

  _checkFormFields(interactive, py) {
    const issues = [];

    if (!interactive.hasForm) {
      return issues;
    }

    // Use Python data for tooltip/label check when available
    if (py && py.formFields.length > 0) {
      for (const field of py.formFields) {
        if (!field.hasTooltip) {
          issues.push({
            id: `form-tooltip-${field.name || 'unknown'}`,
            wcagRule: '4.1.2',
            severity: 'moderate',
            title: `Form field "${field.name || '(unnamed)'}" is missing an accessible tooltip`,
            description:
              `The AcroForm field "${field.name || '(unnamed)'}" has no /TU (user-visible tooltip) ` +
              'entry. Tooltips provide accessible labels that screen readers announce when the field ' +
              'receives focus.',
            element: 'Form Field',
            page: 'Unknown',
            fixable: true,
            impact: 'Screen reader users may not understand what to enter in this field',
            confident: true,
          });
        }
      }
    } else {
      // No Python data — flag the form generically
      issues.push({
        id: 'form-001',
        wcagRule: '4.1.2',
        severity: 'moderate',
        title: 'Interactive form detected — accessibility requires verification',
        description:
          'The document contains AcroForm fields. Each field needs a /TU tooltip and proper ' +
          'label association. Install Python with pikepdf for automated per-field checks.',
        element: 'Form',
        page: 'All',
        fixable: true,
        impact: 'Form fields may not be usable with assistive technology',
        confident: false,
      });
    }

    return issues;
  }

  _checkAAAExtensions(py) {
    const issues = [];

    // Only add enhanced contrast issue if real contrast data was unavailable
    // (If Python ran, contrast-specific issues are already in _checkColorContrast)
    if (!py || py.contrastIssues.length === 0) {
      issues.push({
        id: 'contrast-aaa-001',
        wcagRule: '1.4.6',
        severity: 'moderate',
        title: 'Enhanced contrast (7:1) requires manual verification',
        description:
          'WCAG AAA criterion 1.4.6 requires a contrast ratio of at least 7:1 for normal-sized ' +
          'text. Manually verify all text in the document meets this enhanced threshold.',
        element: 'Text',
        page: 'All',
        fixable: false,
        impact: 'Users with severe visual impairments benefit from the higher contrast requirement',
        confident: !py,
      });
    }

    return issues;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────

  _severityWeight(severity) {
    return { critical: 1, moderate: 2, minor: 3 }[severity] ?? 4;
  }
}

module.exports = AccessibilityAnalyzer;
