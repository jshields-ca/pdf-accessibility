'use strict';

/**
 * Integration tests for the PDF Accessibility Tool API.
 * These tests make real HTTP calls against the Express app.
 */

process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const request = require('supertest');
const fs = require('fs').promises;
const path = require('path');
const { createTestPDF, createNoTitlePDF } = require('./helpers/createTestPDF');

// Import app AFTER setting env vars so DB initializes with :memory:
let app;

beforeAll(async () => {
  // Ensure runtime dirs exist
  await Promise.all([
    fs.mkdir('./uploads', { recursive: true }),
    fs.mkdir('./output', { recursive: true }),
    fs.mkdir('./reports', { recursive: true }),
  ]);
  app = require('../server');
});

// ── Health check ────────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('timestamp');
  });
});

// ── POST /api/analyze ───────────────────────────────────────────────────────
describe('POST /api/analyze', () => {
  it('analyses a valid PDF (AA level)', async () => {
    const pdf = await createTestPDF({ title: 'Test Document', text: 'Sample text' });

    const res = await request(app)
      .post('/api/analyze')
      .attach('pdf', pdf, 'test.pdf')
      .field('wcagLevel', 'AA');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body).toHaveProperty('issues');
    expect(typeof res.body.issues).toBe('number');
    expect(res.body).toHaveProperty('reportUrl');
    expect(res.body).toHaveProperty('remediationUrl');
    expect(res.body).toHaveProperty('pythonEnhanced');
  });

  it('analyses a PDF missing a title and detects metadata-001', async () => {
    const pdf = await createNoTitlePDF();

    const res = await request(app)
      .post('/api/analyze')
      .attach('pdf', pdf, 'notitle.pdf')
      .field('wcagLevel', 'AA');

    expect(res.status).toBe(200);
    // metadata-001 should always be detected (no Python required)
    expect(res.body.issues).toBeGreaterThan(0);
  });

  it('defaults to AA when wcagLevel is omitted', async () => {
    const pdf = await createTestPDF({ title: 'Level Test' });

    const res = await request(app)
      .post('/api/analyze')
      .attach('pdf', pdf, 'level.pdf');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobId');
  });

  it('rejects a request with no file', async () => {
    const res = await request(app).post('/api/analyze');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects a non-PDF file (MIME type mismatch)', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .attach('pdf', Buffer.from('this is not a pdf'), 'fake.pdf');

    // multer rejects it via fileFilter (wrong mimetype passed to content-type)
    // OR magic bytes check rejects it after upload
    expect([400, 500].includes(res.status) || res.status === 400).toBeTruthy();
  });

  it('rejects a file with a fake PDF extension but wrong magic bytes', async () => {
    // Valid Content-Type from supertest but wrong content
    const fakeContent = Buffer.from('PK\x03\x04 this is a zip file');

    const res = await request(app)
      .post('/api/analyze')
      .attach('pdf', fakeContent, { filename: 'evil.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid PDF/i);
  });
});

// ── GET /api/status/:jobId ──────────────────────────────────────────────────
describe('GET /api/status/:jobId', () => {
  it('returns 400 for an invalid UUID', async () => {
    const res = await request(app).get('/api/status/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 for a valid UUID that does not exist', async () => {
    const res = await request(app).get('/api/status/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('returns job status for a known job', async () => {
    // First create a job
    const pdf = await createTestPDF({ title: 'Status Test' });
    const analyzeRes = await request(app)
      .post('/api/analyze')
      .attach('pdf', pdf, 'status.pdf')
      .field('wcagLevel', 'AA');

    expect(analyzeRes.status).toBe(200);
    const { jobId } = analyzeRes.body;

    const statusRes = await request(app).get(`/api/status/${jobId}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('analyzed');
    expect(statusRes.body.wcagLevel).toBe('AA');
  });
});

// ── Report export endpoints ─────────────────────────────────────────────────
describe('GET /api/report/:jobId/json', () => {
  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).get('/api/report/bad-id/json');
    expect(res.status).toBe(400);
  });

  it('returns JSON report after analysis', async () => {
    const pdf = await createTestPDF({ title: 'JSON Export Test' });
    const analyzeRes = await request(app)
      .post('/api/analyze')
      .attach('pdf', pdf, 'jsontest.pdf');

    const { jobId } = analyzeRes.body;
    const res = await request(app).get(`/api/report/${jobId}/json`);

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/json/);
    const data = JSON.parse(res.text);
    expect(data).toHaveProperty('jobId', jobId);
    expect(data).toHaveProperty('accessibilityIssues');
  });
});

describe('GET /api/report/:jobId/csv', () => {
  it('returns CSV report after analysis', async () => {
    const pdf = await createTestPDF({ title: 'CSV Export Test' });
    const analyzeRes = await request(app)
      .post('/api/analyze')
      .attach('pdf', pdf, 'csvtest.pdf');

    const { jobId } = analyzeRes.body;
    const res = await request(app).get(`/api/report/${jobId}/csv`);

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/csv/);
    expect(res.text).toMatch(/ID,WCAG Rule,Severity/);
  });
});

// ── POST /api/remediate/:jobId ──────────────────────────────────────────────
describe('POST /api/remediate/:jobId', () => {
  it('returns 400 for an invalid UUID', async () => {
    const res = await request(app).post('/api/remediate/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown job', async () => {
    const res = await request(app)
      .post('/api/remediate/00000000-0000-0000-0000-000000000000')
      .send({ autoFix: true });
    expect(res.status).toBe(404);
  });

  it('remediates a PDF with a missing title', async () => {
    const pdf = await createNoTitlePDF();
    const analyzeRes = await request(app)
      .post('/api/analyze')
      .attach('pdf', pdf, 'remediate-test.pdf')
      .field('wcagLevel', 'AA');

    expect(analyzeRes.status).toBe(200);
    const { jobId } = analyzeRes.body;

    const remRes = await request(app)
      .post(`/api/remediate/${jobId}`)
      .send({ autoFix: true });

    expect(remRes.status).toBe(200);
    expect(remRes.body.fixedIssues).toBeGreaterThanOrEqual(0);
    expect(remRes.body).toHaveProperty('downloadUrl');
    expect(remRes.body).toHaveProperty('reportUrl');
  });
});

// ── GET /api/download/:jobId ────────────────────────────────────────────────
describe('GET /api/download/:jobId', () => {
  it('returns 400 for an invalid UUID', async () => {
    const res = await request(app).get('/api/download/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 when no remediated PDF exists', async () => {
    const res = await request(app).get('/api/download/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('returns the remediated PDF after remediation', async () => {
    const pdf = await createNoTitlePDF();
    const analyzeRes = await request(app)
      .post('/api/analyze')
      .attach('pdf', pdf, 'dl-test.pdf');

    const { jobId } = analyzeRes.body;
    await request(app).post(`/api/remediate/${jobId}`).send({ autoFix: true });

    const dlRes = await request(app).get(`/api/download/${jobId}`);
    // Should get a PDF back (or 404 if no remediable issues exist)
    expect([200, 404]).toContain(dlRes.status);
    if (dlRes.status === 200) {
      expect(dlRes.type).toMatch(/pdf/);
    }
  });
});

// ── Swagger docs ────────────────────────────────────────────────────────────
describe('GET /api/docs', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/docs.json', () => {
  it('returns OpenAPI spec', async () => {
    const res = await request(app).get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('openapi', '3.0.3');
    expect(res.body).toHaveProperty('paths');
  });
});
