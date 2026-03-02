'use strict';

process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { createTestPDF, createNoTitlePDF } = require('../helpers/createTestPDF');
const PDFProcessor = require('../../src/services/PDFProcessor');

let processor;
let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-test-'));
  processor = new PDFProcessor();
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

async function writeTmp(name, buf) {
  const p = path.join(tmpDir, name);
  await fs.writeFile(p, buf);
  return p;
}

// ── extractInfo ─────────────────────────────────────────────────────────────
describe('PDFProcessor.extractInfo', () => {
  it('extracts page count and word count', async () => {
    const buf = await createTestPDF({ title: 'Info Test', text: 'Hello world test' });
    const p = await writeTmp('info.pdf', buf);

    const info = await processor.extractInfo(p);

    expect(info.pageCount).toBe(1);
    expect(info.wordCount).toBeGreaterThan(0);
    expect(info.fileSize).toBeGreaterThan(0);
    expect(info.pages).toHaveLength(1);
  });

  it('captures the PDF title from metadata', async () => {
    const buf = await createTestPDF({ title: 'My Specific Title' });
    const p = await writeTmp('titled.pdf', buf);

    const info = await processor.extractInfo(p);
    expect(info.title).toBe('My Specific Title');
  });

  it('returns empty string for missing title', async () => {
    const buf = await createNoTitlePDF();
    const p = await writeTmp('notitle.pdf', buf);

    const info = await processor.extractInfo(p);
    expect(info.title).toBe('');
  });

  it('throws on a non-existent file', async () => {
    await expect(processor.extractInfo('/non/existent/file.pdf')).rejects.toThrow();
  });
});

// ── validatePDF ─────────────────────────────────────────────────────────────
describe('PDFProcessor.validatePDF', () => {
  it('validates a real PDF as valid', async () => {
    const buf = await createTestPDF({ title: 'Valid' });
    const p = await writeTmp('valid.pdf', buf);

    const result = await processor.validatePDF(p);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects a file with wrong magic bytes', async () => {
    const p = await writeTmp('fake.pdf', Buffer.from('This is not a PDF at all'));

    const result = await processor.validatePDF(p);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/magic bytes/i);
  });

  it('rejects a zip file disguised as a PDF', async () => {
    // ZIP magic bytes: PK\x03\x04
    const p = await writeTmp('evil.pdf', Buffer.from('PK\x03\x04 fake zip content'));

    const result = await processor.validatePDF(p);
    expect(result.isValid).toBe(false);
  });
});

// ── hasInteractiveElements ───────────────────────────────────────────────────
describe('PDFProcessor.hasInteractiveElements', () => {
  it('returns false for a plain document', async () => {
    const buf = await createTestPDF({ title: 'No Form' });
    const p = await writeTmp('noform.pdf', buf);

    const result = await processor.hasInteractiveElements(p);
    expect(result.hasForm).toBe(false);
    expect(result.fieldCount).toBe(0);
  });
});
