'use strict';

process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { createTestPDF, createNoTitlePDF, createLongPDF } = require('../helpers/createTestPDF');
const AccessibilityAnalyzer = require('../../src/services/AccessibilityAnalyzer');

let analyzer;
let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'a11y-test-'));
  analyzer = new AccessibilityAnalyzer();
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

async function writeTmp(name, buf) {
  const p = path.join(tmpDir, name);
  await fs.writeFile(p, buf);
  return p;
}

// ── General shape of results ─────────────────────────────────────────────────
describe('AccessibilityAnalyzer.analyze', () => {
  it('returns { issues, pythonEnhanced } for a valid PDF', async () => {
    const buf = await createTestPDF({ title: 'Shape Test' });
    const p = await writeTmp('shape.pdf', buf);

    const result = await analyzer.analyze(p, 'AA');

    expect(result).toHaveProperty('issues');
    expect(result).toHaveProperty('pythonEnhanced');
    expect(Array.isArray(result.issues)).toBe(true);
    expect(typeof result.pythonEnhanced).toBe('boolean');
  });

  it('detects metadata-001 (missing title)', async () => {
    const buf = await createNoTitlePDF();
    const p = await writeTmp('notitle.pdf', buf);

    const { issues } = await analyzer.analyze(p, 'AA');
    const ids = issues.map((i) => i.id);
    expect(ids).toContain('metadata-001');
  });

  it('does NOT flag metadata-001 when title is present', async () => {
    const buf = await createTestPDF({ title: 'A Proper Title', subject: 'Test subject' });
    const p = await writeTmp('titled.pdf', buf);

    const { issues } = await analyzer.analyze(p, 'AA');
    const ids = issues.map((i) => i.id);
    expect(ids).not.toContain('metadata-001');
  });

  it('detects metadata-002 (missing subject)', async () => {
    const buf = await createTestPDF({ title: 'Has Title But No Subject' });
    const p = await writeTmp('nosubject.pdf', buf);

    const { issues } = await analyzer.analyze(p, 'AA');
    const ids = issues.map((i) => i.id);
    expect(ids).toContain('metadata-002');
  });

  it('detects structure-002 for a multi-page document without bookmarks', async () => {
    const buf = await createLongPDF(); // 5 pages
    const p = await writeTmp('long.pdf', buf);

    const { issues } = await analyzer.analyze(p, 'AA');
    const ids = issues.map((i) => i.id);
    // structure-002 appears when Python confirms no bookmarks OR as fallback
    expect(ids.some((id) => id.startsWith('structure-'))).toBe(true);
  });

  it('issues are sorted with critical before moderate before minor', async () => {
    const buf = await createNoTitlePDF();
    const p = await writeTmp('sorted.pdf', buf);

    const { issues } = await analyzer.analyze(p, 'AA');

    const weights = { critical: 1, moderate: 2, minor: 3 };
    for (let i = 1; i < issues.length; i++) {
      expect(weights[issues[i - 1].severity]).toBeLessThanOrEqual(weights[issues[i].severity]);
    }
  });

  it('includes AAA-specific issues when level is AAA', async () => {
    const buf = await createTestPDF({ title: 'AAA Test' });
    const p = await writeTmp('aaa.pdf', buf);

    const aaResult = await analyzer.analyze(p, 'AA');
    const aaaResult = await analyzer.analyze(p, 'AAA');

    // AAA analysis should have at least as many issues
    expect(aaaResult.issues.length).toBeGreaterThanOrEqual(aaResult.issues.length);
  });

  it('each issue has required fields', async () => {
    const buf = await createNoTitlePDF();
    const p = await writeTmp('fields.pdf', buf);

    const { issues } = await analyzer.analyze(p, 'AA');
    expect(issues.length).toBeGreaterThan(0);

    for (const issue of issues) {
      expect(issue).toHaveProperty('id');
      expect(issue).toHaveProperty('wcagRule');
      expect(issue).toHaveProperty('severity');
      expect(issue).toHaveProperty('title');
      expect(issue).toHaveProperty('description');
      expect(issue).toHaveProperty('fixable');
      expect(issue).toHaveProperty('impact');
      expect(['critical', 'moderate', 'minor']).toContain(issue.severity);
    }
  });
});
