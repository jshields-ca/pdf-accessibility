# PDF Accessibility Tool

A comprehensive web application for evaluating PDF accessibility and automatically remediating common issues according to WCAG AA and AAA standards.

## Features

- 🔍 **Automated PDF Analysis** - Comprehensive accessibility evaluation
- ♿ **WCAG Compliance** - Support for both AA and AAA standards
- 🔧 **Automatic Remediation** - Fix common issues without user intervention
- 📊 **Detailed Reports** - HTML reports with actionable insights
- 🎯 **Zero User Input** - Fully automated remediation process
- 🚀 **Modern Web Interface** - Beautiful, accessible user experience
- 📱 **Responsive Design** - Works on desktop, tablet, and mobile
- 🔒 **Security First** - File cleanup, rate limiting, and validation

## Supported Standards

- **WCAG 2.1 AA** - Standard compliance level required by most accessibility regulations
- **WCAG 2.1 AAA** - Enhanced accessibility with stricter requirements
- **PDF/UA** - PDF Universal Accessibility standards compatibility

## What Gets Fixed Automatically

### ✅ Automatic Fixes
- Missing document metadata (title, subject, language)
- Basic document structure and tagging
- Reading order optimization
- Form field accessibility attributes
- Document outline/bookmarks creation
- Language specification

### ⚠️ Manual Review Required
- Alternative text for images (requires human context)
- Color contrast verification
- Complex table structures
- Context-specific content descriptions

## Installation

### Prerequisites

- Node.js 16+ and npm
- Python 3.8+ (for PDF processing)
- Git

### Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd pdf-accessibility-app
   ```

2. **Install Node.js dependencies**
   ```bash
   npm install
   ```

3. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

5. **Start the application**
   ```bash
   npm start
   ```

6. **Access the application**
   - Open http://localhost:3000 in your browser

## Development

### Development Mode
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

## API Endpoints

### Upload and Analyze PDF
```http
POST /api/analyze
Content-Type: multipart/form-data

Parameters:
- pdf: PDF file (max 50MB)
- wcagLevel: "AA" or "AAA"
```

### Remediate PDF
```http
POST /api/remediate/:jobId
Content-Type: application/json

Body:
{
  "autoFix": true
}
```

### Download Remediated PDF
```http
GET /api/download/:jobId
```

### Get Job Status
```http
GET /api/status/:jobId
```

## Architecture

```
pdf-accessibility-app/
├── server.js                 # Express server
├── package.json              # Node.js dependencies
├── requirements.txt          # Python dependencies
├── public/                   # Frontend files
│   ├── index.html           # Main HTML
│   ├── styles.css           # CSS styles
│   └── app.js               # Frontend JavaScript
├── src/
│   └── services/            # Backend services
│       ├── PDFProcessor.js          # PDF processing
│       ├── AccessibilityAnalyzer.js # WCAG analysis
│       ├── RemediationService.js    # Auto-remediation
│       └── ReportGenerator.js       # HTML reports
├── uploads/                 # Temporary PDF storage
├── output/                  # Remediated PDFs
└── reports/                 # Generated reports
```

## Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```env
PORT=3000
MAX_FILE_SIZE=52428800
RATE_LIMIT_MAX_REQUESTS=100
FILE_RETENTION_HOURS=24
```

### Security Settings

- **File Upload**: 50MB maximum, PDF files only
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **File Cleanup**: Automatic deletion after 24 hours
- **CORS**: Configurable allowed origins
- **CSP**: Content Security Policy headers

## Usage

### Web Interface

1. **Upload PDF**: Drag and drop or select a PDF file
2. **Choose Standard**: Select WCAG AA or AAA compliance level
3. **Analyze**: Wait for automatic analysis to complete
4. **View Report**: Review detailed accessibility findings
5. **Remediate**: Click to automatically fix issues
6. **Download**: Get the improved, accessible PDF

### Programmatic Usage

```javascript
// Upload and analyze
const formData = new FormData();
formData.append('pdf', pdfFile);
formData.append('wcagLevel', 'AA');

const response = await fetch('/api/analyze', {
  method: 'POST',
  body: formData
});
const result = await response.json();

// Remediate
const remediationResponse = await fetch(`/api/remediate/${result.jobId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ autoFix: true })
});
```

## Accessibility Checks

### WCAG AA Compliance
- 1.1.1 Non-text Content
- 1.3.1 Info and Relationships
- 1.3.2 Meaningful Sequence
- 1.4.3 Contrast (Minimum)
- 2.4.2 Page Titled
- 2.4.5 Multiple Ways
- 3.1.1 Language of Page
- 4.1.2 Name, Role, Value

### WCAG AAA Additional Checks
- 1.4.6 Contrast (Enhanced)
- 3.3.5 Help
- 2.4.9 Link Purpose (Link Only)
- 2.4.10 Section Headings

## Performance

- **File Processing**: Optimized for PDFs up to 50MB
- **Concurrent Jobs**: Multiple users supported simultaneously
- **Memory Management**: Automatic cleanup and garbage collection
- **Caching**: Temporary file caching for better performance

## Security

- **Input Validation**: File type and size validation
- **Rate Limiting**: Prevents abuse and DoS attacks
- **File Cleanup**: Automatic deletion of temporary files
- **Secure Headers**: Helmet.js security headers
- **CORS Protection**: Configurable cross-origin policies

## Monitoring

### Health Check
```http
GET /health
```

### Logs
Application logs are written to:
- Console (development)
- File: `./logs/app.log` (production)

## Deployment

### Production Setup

1. **Environment Configuration**
   ```bash
   NODE_ENV=production
   PORT=80
   ```

2. **Process Management**
   ```bash
   # Using PM2
   npm install -g pm2
   pm2 start server.js --name pdf-accessibility-tool
   ```

3. **Reverse Proxy**
   Configure nginx or Apache to proxy requests to the Node.js server.

### Docker Deployment

```dockerfile
# Example Dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Run tests: `npm test`
5. Commit: `git commit -am 'Add feature'`
6. Push: `git push origin feature-name`
7. Create a Pull Request

## License

MIT License - see LICENSE file for details.

## Support

For support and questions:
- Create an issue on GitHub
- Check the documentation
- Review the FAQ section

## Changelog

### v1.0.0
- Initial release
- WCAG AA/AAA analysis
- Automatic remediation
- HTML report generation
- Modern web interface

## FAQ

### Q: What types of PDFs are supported?
A: The tool supports all standard PDF files up to 50MB in size.

### Q: How long does processing take?
A: Analysis typically takes 10-30 seconds depending on file size and complexity.

### Q: Are my files stored permanently?
A: No, all files are automatically deleted after 24 hours for privacy and security.

### Q: Can I integrate this with my existing application?
A: Yes, the tool provides REST APIs for programmatic integration.

### Q: What accessibility standards are covered?
A: The tool covers WCAG 2.1 AA and AAA guidelines as well as PDF/UA standards.

---

Built with ❤️ for universal accessibility.