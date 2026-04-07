'use strict';

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const { v4: uuidv4, validate: uuidValidate } = require('uuid');

const logger = require('./src/logger');
const db = require('./src/db');
const PDFProcessor = require('./src/services/PDFProcessor');
const AccessibilityAnalyzer = require('./src/services/AccessibilityAnalyzer');
const RemediationService = require('./src/services/RemediationService');
const ReportGenerator = require('./src/services/ReportGenerator');
const swaggerSpec = require('./src/openapi');

// ─── Config from environment ────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || String(50 * 1024 * 1024), 10);
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const REPORTS_DIR = process.env.REPORTS_DIR || './reports';
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
const CLEANUP_INTERVAL_MS =
  parseFloat(process.env.CLEANUP_INTERVAL_HOURS || '1') * 60 * 60 * 1000;
const FILE_RETENTION_MS =
  parseFloat(process.env.FILE_RETENTION_HOURS || '24') * 60 * 60 * 1000;

const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();

// HTTP request logging (suppressed in tests)
if (process.env.NODE_ENV !== 'test') {
  app.use(pinoHttp({ logger }));
}

// Security headers — no unsafe-inline for scripts; styles need it for report HTML
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],           // No unsafe-inline — all JS is external
        styleSrc: ["'self'", "'unsafe-inline'"], // Reports embed CSS
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

app.use(compression());

// CORS — enforce ALLOWED_ORIGINS in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : null;

app.use(
  cors({
    origin: allowedOrigins
      ? (origin, cb) => {
          // Allow same-origin (no origin header) and explicitly listed origins
          if (!origin || allowedOrigins.includes(origin)) {
            cb(null, true);
          } else {
            cb(new Error(`CORS: origin '${origin}' not allowed`));
          }
        }
      : true, // Dev/test: allow all
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Accept'],
  })
);

// Body parsing (only for non-file payloads — keep limit sane)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting on all API routes
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later.' },
});
app.use('/api', apiLimiter);

// ─── UUID validation middleware ───────────────────────────────────────────────
function requireValidJobId(req, res, next) {
  const { jobId } = req.params;
  if (!jobId || !uuidValidate(jobId)) {
    return res.status(400).json({ error: 'Invalid job ID format' });
  }
  next();
}

// ─── File upload (multer) ─────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    } catch (err) {
      cb(err, null);
    }
  },
  filename: (req, _file, cb) => {
    // jobId is injected by middleware before multer runs
    cb(null, `${req.jobId}-upload.pdf`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only PDF files are accepted'));
    }
  },
});

// ─── Services ────────────────────────────────────────────────────────────────
const pdfProcessor = new PDFProcessor();
const accessibilityAnalyzer = new AccessibilityAnalyzer();
const remediationService = new RemediationService();
const reportGenerator = new ReportGenerator();

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static('public'));
app.use('/reports', express.static(REPORTS_DIR));

// ─── API documentation ────────────────────────────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.0.1', timestamp: new Date().toISOString() });
});

// ─── Root ─────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── POST /api/analyze ────────────────────────────────────────────────────────
app.use('/api/analyze', (req, _res, next) => {
  req.jobId = uuidv4();
  next();
});

/**
 * @swagger
 * /api/analyze:
 *   post:
 *     summary: Upload and analyze a PDF for accessibility issues
 *     tags: [Analysis]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               pdf:
 *                 type: string
 *                 format: binary
 *               wcagLevel:
 *                 type: string
 *                 enum: [AA, AAA]
 *                 default: AA
 *     responses:
 *       200:
 *         description: Analysis complete
 *       400:
 *         description: Bad request (no file, wrong type, too large)
 *       500:
 *         description: Internal error
 */
app.post('/api/analyze', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const wcagLevel = ['AA', 'AAA'].includes(req.body.wcagLevel)
      ? req.body.wcagLevel
      : 'AA';
    const jobId = req.jobId;
    const filePath = req.file.path;

    // Post-upload magic bytes check (catches MIME spoofing)
    const validation = await pdfProcessor.validatePDF(filePath);
    if (!validation.isValid) {
      await fs.unlink(filePath).catch(() => {});
      return res.status(400).json({
        error: 'Uploaded file is not a valid PDF',
        details: IS_PROD ? undefined : validation.errors,
      });
    }

    // Persist job record
    db.createJob(jobId, wcagLevel, req.file.originalname, filePath);

    // Extract metadata
    const pdfInfo = await pdfProcessor.extractInfo(filePath);

    // Analyse accessibility (returns { issues, pythonEnhanced })
    const { issues, pythonEnhanced } = await accessibilityAnalyzer.analyze(filePath, wcagLevel);

    // Generate HTML + JSON report
    const reportPath = await reportGenerator.generateReport({
      jobId,
      filename: req.file.originalname,
      pdfInfo,
      accessibilityIssues: issues,
      wcagLevel,
      status: 'analyzed',
      pythonEnhanced,
    });

    db.updateJob(jobId, {
      status: 'analyzed',
      reportPath,
      issueCount: issues.length,
    });

    res.json({
      jobId,
      status: 'analyzed',
      issues: issues.length,
      pythonEnhanced,
      reportUrl: `/reports/${jobId}-report.html`,
      remediationUrl: `/api/remediate/${jobId}`,
    });
  } catch (error) {
    logger.error({ err: error.message }, 'Analysis error');
    res.status(500).json({
      error: 'Failed to analyze PDF',
      ...(IS_PROD ? {} : { details: error.message }),
    });
  }
});

// ─── POST /api/remediate/:jobId ───────────────────────────────────────────────
/**
 * @swagger
 * /api/remediate/{jobId}:
 *   post:
 *     summary: Apply automatic accessibility fixes to a previously analyzed PDF
 *     tags: [Remediation]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               autoFix:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Remediation complete
 *       404:
 *         description: Job or PDF not found
 *       500:
 *         description: Internal error
 */
app.post('/api/remediate/:jobId', requireValidJobId, async (req, res) => {
  try {
    const { jobId } = req.params;
    const autoFix = req.body.autoFix !== false;

    const job = db.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const filePath = job.filePath;
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Original PDF no longer available' });
    }

    const { issues, pythonEnhanced } = await accessibilityAnalyzer.analyze(
      filePath,
      job.wcagLevel
    );

    const pdfInfo = await pdfProcessor.extractInfo(filePath);

    const remediationResult = await remediationService.remediate(filePath, issues, {
      autoFix,
      jobId,
    });

    const reportPath = await reportGenerator.generateReport({
      jobId,
      filename: job.originalFilename,
      pdfInfo,
      accessibilityIssues: issues,
      remediationResult,
      wcagLevel: job.wcagLevel,
      status: 'remediated',
      pythonEnhanced,
    });

    db.updateJob(jobId, {
      status: 'remediated',
      reportPath,
      remediatedPath: remediationResult.remediatedPdfPath,
      issueCount: issues.length,
      fixedCount: remediationResult.fixedIssues.length,
    });

    res.json({
      jobId,
      status: 'remediated',
      originalIssues: issues.length,
      fixedIssues: remediationResult.fixedIssues.length,
      remainingIssues: remediationResult.remainingIssues.length,
      pythonEnhanced,
      reportUrl: `/reports/${jobId}-report.html`,
      downloadUrl: `/api/download/${jobId}`,
    });
  } catch (error) {
    logger.error({ err: error.message }, 'Remediation error');
    res.status(500).json({
      error: 'Failed to remediate PDF',
      ...(IS_PROD ? {} : { details: error.message }),
    });
  }
});

// ─── GET /api/download/:jobId ─────────────────────────────────────────────────
/**
 * @swagger
 * /api/download/{jobId}:
 *   get:
 *     summary: Download the remediated PDF
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: PDF file
 *       404:
 *         description: Not found
 */
app.get('/api/download/:jobId', requireValidJobId, async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = db.getJob(jobId);
    if (!job || !job.remediatedPath) {
      return res.status(404).json({ error: 'Remediated PDF not found' });
    }

    try {
      await fs.access(job.remediatedPath);
    } catch {
      return res.status(404).json({ error: 'Remediated PDF file no longer available' });
    }

    const filename = `remediated-${job.originalFilename || 'document.pdf'}`;
    res.download(job.remediatedPath, filename);
  } catch (error) {
    logger.error({ err: error.message }, 'Download error');
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// ─── GET /api/status/:jobId ───────────────────────────────────────────────────
/**
 * @swagger
 * /api/status/{jobId}:
 *   get:
 *     summary: Check the status of an analysis job
 *     tags: [Analysis]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Job status
 *       404:
 *         description: Job not found
 */
app.get('/api/status/:jobId', requireValidJobId, (req, res) => {
  const { jobId } = req.params;
  const job = db.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    status: job.status,
    wcagLevel: job.wcagLevel,
    issueCount: job.issueCount,
    fixedCount: job.fixedCount,
    reportUrl: job.reportPath ? `/reports/${jobId}-report.html` : null,
  });
});

// ─── GET /api/report/:jobId/json ──────────────────────────────────────────────
/**
 * @swagger
 * /api/report/{jobId}/json:
 *   get:
 *     summary: Download the raw accessibility report data as JSON
 *     tags: [Reports]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Report data
 *       404:
 *         description: Report not found
 */
app.get('/api/report/:jobId/json', requireValidJobId, async (req, res) => {
  const { jobId } = req.params;
  const dataFile = path.join(REPORTS_DIR, `${jobId}-data.json`);
  try {
    const raw = await fs.readFile(dataFile, 'utf8');
    res.type('application/json').send(raw);
  } catch {
    res.status(404).json({ error: 'Report data not found' });
  }
});

// ─── GET /api/report/:jobId/csv ───────────────────────────────────────────────
/**
 * @swagger
 * /api/report/{jobId}/csv:
 *   get:
 *     summary: Download the accessibility issues as a CSV file
 *     tags: [Reports]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: CSV file
 *       404:
 *         description: Report not found
 */
app.get('/api/report/:jobId/csv', requireValidJobId, async (req, res) => {
  const { jobId } = req.params;
  const dataFile = path.join(REPORTS_DIR, `${jobId}-data.json`);
  try {
    const raw = await fs.readFile(dataFile, 'utf8');
    const data = JSON.parse(raw);
    const issues = data.accessibilityIssues || [];

    const header = ['ID', 'WCAG Rule', 'Severity', 'Title', 'Description', 'Page', 'Fixable'];
    const rows = issues.map((i) => [
      csvEscape(i.id),
      csvEscape(i.wcagRule),
      csvEscape(i.severity),
      csvEscape(i.title),
      csvEscape(i.description),
      csvEscape(String(i.page ?? '')),
      csvEscape(String(i.fixable ?? '')),
    ]);

    const csv = [header, ...rows].map((row) => row.join(',')).join('\r\n');
    res
      .type('text/csv')
      .setHeader('Content-Disposition', `attachment; filename="${jobId}-report.csv"`)
      .send(csv);
  } catch {
    res.status(404).json({ error: 'Report data not found' });
  }
});

function csvEscape(value) {
  const str = String(value ?? '').replace(/"/g, '""');
  return `"${str}"`;
}

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: `File too large. Maximum upload size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB.`,
      });
    }
    return res.status(400).json({ error: 'File upload error: ' + error.message });
  }

  if (error.message && error.message.startsWith('CORS:')) {
    return res.status(403).json({ error: error.message });
  }

  logger.error({ err: error.message, stack: error.stack }, 'Unhandled error');
  res.status(500).json({
    error: 'Internal server error',
    ...(IS_PROD ? {} : { details: error.message }),
  });
});

// ─── Periodic cleanup ─────────────────────────────────────────────────────────
function scheduleCleanup() {
  return setInterval(async () => {
    logger.info('Running scheduled file cleanup');
    const dirs = [UPLOAD_DIR, OUTPUT_DIR, REPORTS_DIR];

    for (const dir of dirs) {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            const stat = await fs.stat(filePath);
            if (Date.now() - stat.mtime.getTime() > FILE_RETENTION_MS) {
              await fs.unlink(filePath);
              logger.info({ filePath }, 'Cleaned up old file');
            }
          } catch { /* file may have been deleted between readdir and stat */ }
        }
      } catch { /* directory may not exist yet */ }
    }

    // Remove old job records from DB
    try {
      const oldJobs = db.getJobsOlderThan(FILE_RETENTION_MS);
      for (const job of oldJobs) {
        db.deleteJob(job.jobId);
      }
      if (oldJobs.length > 0) {
        logger.info({ count: oldJobs.length }, 'Cleaned up old job records');
      }
    } catch (err) {
      logger.error({ err: err.message }, 'DB cleanup error');
    }
  }, CLEANUP_INTERVAL_MS);
}

// ─── Start server ─────────────────────────────────────────────────────────────
if (require.main === module) {
  // Ensure runtime directories exist
  Promise.all([
    fs.mkdir(UPLOAD_DIR, { recursive: true }),
    fs.mkdir(OUTPUT_DIR, { recursive: true }),
    fs.mkdir(REPORTS_DIR, { recursive: true }),
  ])
    .then(() => {
      scheduleCleanup();
      app.listen(PORT, () => {
        logger.info({ port: PORT }, 'PDF Accessibility Tool running');
      });
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'Startup error');
      process.exit(1);
    });
}

module.exports = app;
