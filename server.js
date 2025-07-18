const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const PDFProcessor = require('./src/services/PDFProcessor');
const AccessibilityAnalyzer = require('./src/services/AccessibilityAnalyzer');
const RemediationService = require('./src/services/RemediationService');
const ReportGenerator = require('./src/services/ReportGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

// Security and performance middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api', limiter);

// File upload configuration
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = './uploads';
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error, null);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = uuidv4();
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Serve static files
app.use(express.static('public'));
app.use('/reports', express.static('reports'));

// Initialize services
const pdfProcessor = new PDFProcessor();
const accessibilityAnalyzer = new AccessibilityAnalyzer();
const remediationService = new RemediationService();
const reportGenerator = new ReportGenerator();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload and analyze PDF
app.post('/api/analyze', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const { wcagLevel = 'AA' } = req.body;
    const jobId = uuidv4();
    
    // Process PDF
    console.log(`Starting analysis for job ${jobId}`);
    const pdfInfo = await pdfProcessor.extractInfo(req.file.path);
    
    // Analyze accessibility
    const accessibilityIssues = await accessibilityAnalyzer.analyze(
      req.file.path, 
      wcagLevel
    );
    
    // Generate initial report
    const reportPath = await reportGenerator.generateReport({
      jobId,
      filename: req.file.originalname,
      pdfInfo,
      accessibilityIssues,
      wcagLevel,
      status: 'analyzed'
    });

    res.json({
      jobId,
      status: 'analyzed',
      issues: accessibilityIssues.length,
      reportUrl: `/reports/${jobId}-report.html`,
      remediationUrl: `/api/remediate/${jobId}`
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze PDF', details: error.message });
  }
});

// Remediate PDF
app.post('/api/remediate/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { autoFix = true } = req.body;
    
    console.log(`Starting remediation for job ${jobId}`);
    
    // Find original PDF file
    const uploadDir = './uploads';
    const files = await fs.readdir(uploadDir);
    const pdfFile = files.find(file => file.includes(jobId));
    
    if (!pdfFile) {
      return res.status(404).json({ error: 'Original PDF not found' });
    }
    
    const originalPath = path.join(uploadDir, pdfFile);
    
    // Re-analyze to get current issues
    const accessibilityIssues = await accessibilityAnalyzer.analyze(originalPath, 'AA');
    
    // Perform remediation
    const remediationResult = await remediationService.remediate(
      originalPath,
      accessibilityIssues,
      { autoFix }
    );
    
    // Generate final report
    const reportPath = await reportGenerator.generateReport({
      jobId,
      filename: pdfFile,
      accessibilityIssues,
      remediationResult,
      status: 'remediated'
    });

    res.json({
      jobId,
      status: 'remediated',
      originalIssues: accessibilityIssues.length,
      fixedIssues: remediationResult.fixedIssues.length,
      remainingIssues: remediationResult.remainingIssues.length,
      reportUrl: `/reports/${jobId}-report.html`,
      downloadUrl: remediationResult.remediatedPdfPath ? `/api/download/${jobId}` : null
    });

  } catch (error) {
    console.error('Remediation error:', error);
    res.status(500).json({ error: 'Failed to remediate PDF', details: error.message });
  }
});

// Download remediated PDF
app.get('/api/download/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const outputDir = './output';
    const files = await fs.readdir(outputDir);
    const remediatedFile = files.find(file => file.includes(jobId));
    
    if (!remediatedFile) {
      return res.status(404).json({ error: 'Remediated PDF not found' });
    }
    
    const filePath = path.join(outputDir, remediatedFile);
    res.download(filePath, `remediated-${remediatedFile}`);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Get job status
app.get('/api/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const reportPath = path.join('./reports', `${jobId}-report.html`);
    
    try {
      await fs.access(reportPath);
      res.json({ status: 'completed', reportUrl: `/reports/${jobId}-report.html` });
    } catch {
      res.json({ status: 'processing' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Cleanup old files periodically (run every hour)
setInterval(async () => {
  try {
    const dirs = ['./uploads', './output', './reports'];
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const dir of dirs) {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = await fs.stat(filePath);
          if (Date.now() - stat.mtime.getTime() > maxAge) {
            await fs.unlink(filePath);
            console.log(`Cleaned up old file: ${filePath}`);
          }
        }
      } catch (error) {
        console.error(`Error cleaning directory ${dir}:`, error);
      }
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`PDF Accessibility App running on http://localhost:${PORT}`);
});

module.exports = app;