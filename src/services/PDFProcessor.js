'use strict';

const fs = require('fs').promises;
const pdfParse = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');
const logger = require('../logger');

class PDFProcessor {
  /**
   * Extract basic information from a PDF using pdf-parse and pdf-lib.
   * pdf-parse provides real text/metadata extraction from the PDF byte stream.
   */
  async extractInfo(filePath) {
    const dataBuffer = await fs.readFile(filePath);
    const fileSize = (await fs.stat(filePath)).size;

    // Load with pdf-lib (always works when the PDF is structurally valid)
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(dataBuffer, { ignoreEncryption: true });
    } catch (error) {
      logger.error({ err: error.message, filePath }, 'pdf-lib failed to load PDF');
      throw new Error(`Failed to extract PDF information: ${error.message}`);
    }

    const pages = pdfDoc.getPages();

    // Attempt text + metadata extraction via pdf-parse.
    // pdf-parse uses an older pdf.js engine that may fail on some compression
    // variants — fall back gracefully to pdf-lib getters when that happens.
    let pdfData = null;
    try {
      pdfData = await pdfParse(dataBuffer);
    } catch (err) {
      logger.warn(
        { err: err.message, filePath },
        'pdf-parse failed — using pdf-lib metadata fallback'
      );
    }

    const text = pdfData?.text || '';
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

    const info = {
      pageCount: pdfData?.numpages || pages.length,
      textContent: text,
      wordCount,
      // Prefer pdf-lib getters (read directly from the loaded object tree) for
      // structured metadata fields; they are more reliable than pdf-parse's Info
      // dictionary which can retain state between calls in some environments.
      title: pdfDoc.getTitle()?.trim() || pdfData?.info?.Title?.trim() || '',
      author: pdfDoc.getAuthor()?.trim() || pdfData?.info?.Author?.trim() || '',
      creator: pdfDoc.getCreator()?.trim() || pdfData?.info?.Creator?.trim() || '',
      producer: pdfDoc.getProducer()?.trim() || pdfData?.info?.Producer?.trim() || '',
      creationDate: pdfData?.info?.CreationDate || null,
      modificationDate: pdfData?.info?.ModDate || null,
      subject: pdfDoc.getSubject()?.trim() || pdfData?.info?.Subject?.trim() || '',
      keywords: pdfDoc.getKeywords()?.trim() || pdfData?.info?.Keywords?.trim() || '',
      fileSize,
      pages: [],
    };

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();
      info.pages.push({
        pageNumber: i + 1,
        width,
        height,
        rotation: page.getRotation().angle || 0,
      });
    }

    return info;
  }

  /**
   * Detect interactive form elements using pdf-lib.
   * pdf-lib natively supports AcroForm field enumeration.
   */
  async hasInteractiveElements(filePath) {
    try {
      const dataBuffer = await fs.readFile(filePath);
      const pdfDoc = await PDFDocument.load(dataBuffer, { ignoreEncryption: true });
      const form = pdfDoc.getForm();
      const fields = form.getFields();

      return {
        hasForm: fields.length > 0,
        fieldCount: fields.length,
        fields: fields.map((field) => ({
          name: field.getName(),
          type: field.constructor.name,
        })),
      };
    } catch (_) {
      return { hasForm: false, fieldCount: 0, fields: [] };
    }
  }

  /**
   * Validate that the file is a parseable PDF.
   * Performs magic-bytes verification to catch MIME-type spoofing,
   * then attempts a full structural load.
   */
  async validatePDF(filePath) {
    try {
      // Read first 5 bytes to verify PDF magic header (%PDF-)
      const fd = await fs.open(filePath, 'r');
      const magicBuf = Buffer.alloc(5);
      await fd.read(magicBuf, 0, 5, 0);
      await fd.close();

      if (magicBuf.toString('ascii') !== '%PDF-') {
        return {
          isValid: false,
          errors: ['File does not appear to be a valid PDF (magic bytes check failed)'],
        };
      }

      const dataBuffer = await fs.readFile(filePath);
      await PDFDocument.load(dataBuffer, { ignoreEncryption: true });
      return { isValid: true, errors: [] };
    } catch (error) {
      return { isValid: false, errors: [error.message] };
    }
  }
}

module.exports = PDFProcessor;
