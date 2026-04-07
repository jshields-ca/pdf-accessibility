'use strict';

/**
 * Creates minimal but valid PDF buffers for use in tests.
 * Uses pdf-lib so no external dependencies are required.
 */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/**
 * Create a simple single-page PDF with optional metadata and text.
 */
async function createTestPDF(options = {}) {
  const {
    title = '',
    subject = '',
    author = '',
    text = 'Hello, world!',
    pageCount = 1,
  } = options;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  if (title) { pdfDoc.setTitle(title); }
  if (subject) { pdfDoc.setSubject(subject); }
  if (author) { pdfDoc.setAuthor(author); }

  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.addPage([612, 792]);
    if (text) {
      page.drawText(`${text} (page ${i + 1})`, {
        x: 50,
        y: 700,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  // useObjectStreams: false disables compression so pdf-parse (old pdf.js) can read these files
  const bytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

/**
 * Create a PDF without a title (triggers metadata-001 issue).
 */
async function createNoTitlePDF() {
  return createTestPDF({ title: '', text: 'Document without a title' });
}

/**
 * Create a longer PDF (5 pages, no bookmarks) to trigger structure-002.
 */
async function createLongPDF() {
  return createTestPDF({ title: 'Long Test Document', pageCount: 5 });
}

module.exports = { createTestPDF, createNoTitlePDF, createLongPDF };
