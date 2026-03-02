'use strict';

const fs = require('fs').promises;
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const { remediatePDF } = require('./PythonBridge');
const logger = require('../logger');

class RemediationService {
  constructor() {
    this.outputDir = process.env.OUTPUT_DIR || './output';
    this._ensureOutputDir();
  }

  async _ensureOutputDir() {
    await fs.mkdir(this.outputDir, { recursive: true }).catch(() => {});
  }

  /**
   * Remediate accessibility issues in a PDF.
   *
   * Pipeline:
   *   1. pdf-lib applies metadata fixes (title, subject, creator, producer, keywords).
   *   2. Python/pikepdf applies structural fixes (language, MarkInfo, DisplayDocTitle,
   *      form field tooltips) that pdf-lib cannot perform.
   *   3. Remaining issues that cannot be auto-fixed are returned with explanations.
   *
   * @param {string}  filePath  - Path to the original uploaded PDF.
   * @param {Array}   issues    - Issue objects from AccessibilityAnalyzer.
   * @param {object}  options   - { autoFix: boolean, jobId: string }
   * @returns {Promise<object>} Remediation result.
   */
  async remediate(filePath, issues, options = {}) {
    const { autoFix = true, jobId } = options;

    logger.info({ filePath, issueCount: issues.length, autoFix }, 'Starting remediation');

    const outputFileName = jobId ? `${jobId}-remediated.pdf` : `${uuidv4()}-remediated.pdf`;
    const outputPath = path.join(this.outputDir, outputFileName);

    const fixedIssues = [];
    const remainingIssues = [];

    // ── Step 1: pdf-lib metadata pass ──────────────────────────────────────────
    let pdfBytes;
    try {
      const dataBuffer = await fs.readFile(filePath);
      const pdfDoc = await PDFDocument.load(dataBuffer, { ignoreEncryption: true });

      const metadataIssues = issues.filter((i) => i.id.startsWith('metadata-'));
      this._applyMetadataFixes(pdfDoc, metadataIssues, fixedIssues);

      pdfBytes = await pdfDoc.save();
    } catch (err) {
      logger.error({ err: err.message }, 'pdf-lib metadata pass failed');
      throw new Error(`Metadata remediation failed: ${err.message}`);
    }

    // Write the metadata-fixed PDF to the output path so Python can read it
    await fs.writeFile(outputPath, pdfBytes);

    // ── Step 2: Python/pikepdf structural pass ──────────────────────────────────
    if (autoFix) {
      const pythonFixes = this._buildPythonFixes(issues);
      const hasPythonWork = Object.keys(pythonFixes).length > 0;

      if (hasPythonWork) {
        try {
          const pyResult = await remediatePDF(outputPath, outputPath, pythonFixes);

          if (pyResult.success) {
            // Map applied fix descriptions back to issue IDs
            this._reconcilePythonFixes(issues, pyResult.fixesApplied, fixedIssues);
          } else {
            logger.warn(
              { errors: pyResult.errors },
              'Python remediation reported errors; structural fixes may be incomplete'
            );
            // Move unfixed structural issues to remaining
            this._moveUnfixedToRemaining(issues, fixedIssues, remainingIssues,
              'Python remediation encountered errors — structural fixes require manual intervention');
          }
        } catch (err) {
          logger.warn({ err: err.message }, 'Python remediation unavailable; skipping structural fixes');
          this._moveUnfixedToRemaining(issues, fixedIssues, remainingIssues,
            'Python is not available — install Python 3 with pikepdf to enable structural fixes');
        }
      }
    }

    // ── Step 3: Categorise remaining issues ────────────────────────────────────
    for (const issue of issues) {
      const alreadyFixed = fixedIssues.some((f) => f.id === issue.id);
      if (alreadyFixed) { continue; }

      let reason;
      if (!autoFix) {
        reason = 'Auto-fix was not requested';
      } else if (issue.id.startsWith('alt-text-')) {
        reason = 'Alternative text requires human judgment about image content';
      } else if (issue.id.startsWith('contrast-')) {
        reason = 'Color contrast corrections require manual editing in the source application';
      } else if (issue.id.startsWith('reading-order-') || issue.id === 'reading-order-001') {
        reason = 'Reading order remediation requires rebuilding the document structure tree, ' +
          'which must be done in a PDF authoring tool (Adobe Acrobat Pro, Foxit, etc.)';
      } else if (issue.id.startsWith('heading-')) {
        reason = 'Heading structure must be established in the source document and re-exported';
      } else if (!issue.fixable) {
        reason = 'This issue requires manual review and cannot be automatically corrected';
      } else {
        reason = 'Issue was not addressed in this remediation pass';
      }

      remainingIssues.push({ ...issue, reason });
    }

    const totalIssues = issues.length;
    const fixedCount = fixedIssues.length;

    logger.info(
      { outputPath, fixedCount, remainingCount: remainingIssues.length },
      'Remediation complete'
    );

    return {
      fixedIssues,
      remainingIssues,
      remediatedPdfPath: outputPath,
      summary: {
        totalIssues,
        fixedCount,
        remainingCount: remainingIssues.length,
        autoFixPercentage: totalIssues > 0
          ? Math.round((fixedCount / totalIssues) * 100)
          : 0,
      },
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Apply title, subject, and producer metadata via pdf-lib.
   * These are genuine changes that AT and document management systems use.
   */
  _applyMetadataFixes(pdfDoc, metadataIssues, fixedIssues) {
    // Always stamp creator/producer so the tool is identified
    pdfDoc.setCreator('PDF Accessibility Tool');
    pdfDoc.setProducer('PDF Accessibility Remediation Service');
    pdfDoc.setModificationDate(new Date());

    for (const issue of metadataIssues) {
      if (issue.id === 'metadata-001') {
        pdfDoc.setTitle('Accessible Document');
        fixedIssues.push({
          ...issue,
          fixApplied: 'Document title set',
          fixDetails:
            'Set PDF /Title metadata to "Accessible Document". Update with a descriptive title ' +
            'matching the document content.',
        });
      } else if (issue.id === 'metadata-002') {
        pdfDoc.setSubject('Document processed for accessibility compliance');
        fixedIssues.push({
          ...issue,
          fixApplied: 'Document subject set',
          fixDetails: 'Set PDF /Subject metadata describing accessibility processing.',
        });
      }
    }
  }

  /**
   * Determine which fixes Python should apply based on the outstanding issues.
   */
  _buildPythonFixes(issues) {
    const fixes = {};
    const ids = new Set(issues.map((i) => i.id));

    if (ids.has('language-001')) {
      fixes.setLanguage = 'en';
    }

    if (ids.has('structure-001')) {
      // Set MarkInfo/Marked=true and DisplayDocTitle for better AT compatibility.
      // Note: this is a formal flag, not a full PDF/UA structure tree — we are
      // transparent about this in the fix description.
      fixes.markTagged = true;
      fixes.displayDocTitle = true;
    } else if (ids.has('metadata-001')) {
      // Even without a tagging issue, enabling DisplayDocTitle is always beneficial
      fixes.displayDocTitle = true;
    }

    // Add tooltips to form fields that lack them
    const hasFormTooltipIssue = issues.some(
      (i) => i.id.startsWith('form-tooltip-') || i.id === 'form-001'
    );
    if (hasFormTooltipIssue) {
      fixes.formTooltips = true;
    }

    return fixes;
  }

  /**
   * After Python runs, mark the corresponding issues as fixed.
   */
  _reconcilePythonFixes(issues, appliedDescriptions, fixedIssues) {
    for (const issue of issues) {
      const alreadyFixed = fixedIssues.some((f) => f.id === issue.id);
      if (alreadyFixed) { continue; }

      let matched = false;

      if (issue.id === 'language-001' &&
          appliedDescriptions.some((d) => d.toLowerCase().includes('language'))) {
        fixedIssues.push({
          ...issue,
          fixApplied: 'Document language set to English (en)',
          fixDetails: 'Set PDF catalog /Lang = "en". Screen readers will now select the correct voice profile.',
        });
        matched = true;
      }

      if (issue.id === 'structure-001' &&
          appliedDescriptions.some((d) => d.includes('MarkInfo'))) {
        fixedIssues.push({
          ...issue,
          fixApplied: 'MarkInfo/Marked flag set; DisplayDocTitle enabled',
          fixDetails:
            'Set /MarkInfo/Marked = true (signals structured content to AT) and ' +
            '/ViewerPreferences/DisplayDocTitle = true (shows title in viewer title bar). ' +
            'Note: a full PDF/UA structure tree was not added — complex documents should be ' +
            're-authored in a tool such as Adobe Acrobat Pro for complete tagging.',
        });
        matched = true;
      }

      if ((issue.id.startsWith('form-tooltip-') || issue.id === 'form-001') &&
          appliedDescriptions.some((d) => d.toLowerCase().includes('tooltip'))) {
        fixedIssues.push({
          ...issue,
          fixApplied: 'Accessible tooltip (/TU) added to form field',
          fixDetails:
            'Added /TU (user-visible tooltip) entry to form fields that lacked one. ' +
            'Review generated tooltips and replace with field-specific descriptions.',
        });
        matched = true;
      }

      if (!matched && issue.id === 'metadata-001' &&
          appliedDescriptions.some((d) => d.includes('DisplayDocTitle'))) {
        // DisplayDocTitle fix is a bonus — metadata-001 already handled by pdf-lib
      }
    }
  }

  /**
   * Move issues that were not fixed (and weren't already in fixedIssues)
   * to remainingIssues with the provided reason.
   */
  _moveUnfixedToRemaining(issues, fixedIssues, remainingIssues, reason) {
    for (const issue of issues) {
      const alreadyFixed = fixedIssues.some((f) => f.id === issue.id);
      const alreadyRemaining = remainingIssues.some((r) => r.id === issue.id);
      if (!alreadyFixed && !alreadyRemaining && issue.fixable) {
        remainingIssues.push({ ...issue, reason });
      }
    }
  }
}

module.exports = RemediationService;
