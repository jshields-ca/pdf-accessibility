// PDF Accessibility Tool - Frontend Application
class PDFAccessibilityApp {
    constructor() {
        this.currentJobId = null;
        this.currentStep = 'upload';
        this.initializeApp();
    }

    initializeApp() {
        this.setupEventListeners();
        this.setupFileUpload();
    }

    setupEventListeners() {
        // Form submission
        document.getElementById('upload-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFileUpload();
        });

        // File input change
        document.getElementById('pdf-file').addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files[0]);
        });

        // Button click handlers
        document.getElementById('view-report-btn')?.addEventListener('click', () => {
            this.viewReport();
        });

        document.getElementById('remediate-btn')?.addEventListener('click', () => {
            this.startRemediation();
        });

        document.getElementById('final-report-btn')?.addEventListener('click', () => {
            this.viewReport();
        });

        document.getElementById('download-btn')?.addEventListener('click', () => {
            this.downloadRemediatedPDF();
        });

        document.getElementById('start-over-btn')?.addEventListener('click', () => {
            this.resetApp();
        });
    }

    setupFileUpload() {
        const uploadArea = document.getElementById('file-upload-area');
        const fileInput = document.getElementById('pdf-file');

        // Click to upload
        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') {
                fileInput.files = files;
                this.handleFileSelect(files[0]);
            } else {
                this.showToast('Please select a PDF file', 'error');
            }
        });
    }

    handleFileSelect(file) {
        if (!file) return;

        if (file.type !== 'application/pdf') {
            this.showToast('Please select a PDF file', 'error');
            return;
        }

        if (file.size > 50 * 1024 * 1024) { // 50MB
            this.showToast('File size must be less than 50MB', 'error');
            return;
        }

        // Update UI to show selected file
        const uploadText = document.querySelector('.upload-text p');
        uploadText.innerHTML = `<strong>Selected:</strong> ${file.name} (${this.formatFileSize(file.size)})`;

        // Enable analyze button
        document.getElementById('analyze-btn').disabled = false;
    }

    async handleFileUpload() {
        const fileInput = document.getElementById('pdf-file');
        const file = fileInput.files[0];
        
        if (!file) {
            this.showToast('Please select a PDF file', 'error');
            return;
        }

        const wcagLevel = document.querySelector('input[name="wcagLevel"]:checked').value;

        // Show progress section
        this.showSection('progress');
        this.updateProgress(25, 'Uploading PDF...');

        try {
            const formData = new FormData();
            formData.append('pdf', file);
            formData.append('wcagLevel', wcagLevel);

            const response = await fetch('/api/analyze', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (response.ok) {
                this.currentJobId = result.jobId;
                this.updateProgress(100, 'Analysis complete!');
                this.showResults(result);
            } else {
                throw new Error(result.error || 'Analysis failed');
            }

        } catch (error) {
            console.error('Upload error:', error);
            this.showToast(`Upload failed: ${error.message}`, 'error');
            this.showSection('upload');
        }
    }

    showResults(result) {
        setTimeout(() => {
            this.showSection('results');
            
            // Update summary cards
            const summaryContainer = document.getElementById('results-summary');
            summaryContainer.innerHTML = `
                <div class="summary-card">
                    <div class="card-number">${result.issues}</div>
                    <div class="card-label">Total Issues</div>
                </div>
                <div class="summary-card critical">
                    <div class="card-number">${this.getIssueCount(result, 'critical')}</div>
                    <div class="card-label">Critical</div>
                </div>
                <div class="summary-card moderate">
                    <div class="card-number">${this.getIssueCount(result, 'moderate')}</div>
                    <div class="card-label">Moderate</div>
                </div>
                <div class="summary-card minor">
                    <div class="card-number">${this.getIssueCount(result, 'minor')}</div>
                    <div class="card-label">Minor</div>
                </div>
            `;

            // Show file info (placeholder - would be populated with actual data)
            const fileInfo = document.getElementById('file-info');
            fileInfo.innerHTML = `
                <h3>Document Information</h3>
                <div class="file-info-grid">
                    <div class="file-info-item">
                        <span>Job ID:</span>
                        <span>${result.jobId}</span>
                    </div>
                    <div class="file-info-item">
                        <span>Issues Found:</span>
                        <span>${result.issues}</span>
                    </div>
                    <div class="file-info-item">
                        <span>Status:</span>
                        <span>${result.status}</span>
                    </div>
                </div>
            `;

        }, 1000);
    }

    async startRemediation() {
        if (!this.currentJobId) {
            this.showToast('No job ID found', 'error');
            return;
        }

        // Show progress section
        this.showSection('progress');
        this.updateProgress(25, 'Starting remediation...');
        this.updateProgressStep('remediate');

        try {
            const response = await fetch(`/api/remediate/${this.currentJobId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ autoFix: true })
            });

            const result = await response.json();

            if (response.ok) {
                this.updateProgress(100, 'Remediation complete!');
                this.updateProgressStep('complete');
                this.showRemediationResults(result);
            } else {
                throw new Error(result.error || 'Remediation failed');
            }

        } catch (error) {
            console.error('Remediation error:', error);
            this.showToast(`Remediation failed: ${error.message}`, 'error');
            this.showSection('results');
        }
    }

    showRemediationResults(result) {
        setTimeout(() => {
            this.showSection('remediation');
            
            // Update remediation summary
            const summaryContainer = document.getElementById('remediation-summary');
            summaryContainer.innerHTML = `
                <div class="summary-card success">
                    <div class="card-number">${result.fixedIssues}</div>
                    <div class="card-label">Issues Fixed</div>
                </div>
                <div class="summary-card moderate">
                    <div class="card-number">${result.remainingIssues}</div>
                    <div class="card-label">Manual Review Required</div>
                </div>
                <div class="summary-card">
                    <div class="card-number">${result.originalIssues}</div>
                    <div class="card-label">Original Issues</div>
                </div>
            `;

            // Show download button if remediated PDF is available
            if (result.downloadUrl) {
                document.getElementById('download-btn').style.display = 'inline-flex';
            }

        }, 1000);
    }

    async viewReport() {
        if (!this.currentJobId) {
            this.showToast('No report available', 'error');
            return;
        }

        const reportUrl = `/reports/${this.currentJobId}-report.html`;
        window.open(reportUrl, '_blank');
    }

    async downloadRemediatedPDF() {
        if (!this.currentJobId) {
            this.showToast('No file available for download', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/download/${this.currentJobId}`);
            
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `remediated-${this.currentJobId}.pdf`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                this.showToast('Download started', 'success');
            } else {
                throw new Error('Download failed');
            }
        } catch (error) {
            this.showToast(`Download failed: ${error.message}`, 'error');
        }
    }

    resetApp() {
        this.currentJobId = null;
        this.currentStep = 'upload';
        
        // Reset form
        document.getElementById('upload-form').reset();
        document.getElementById('analyze-btn').disabled = true;
        
        // Reset upload text
        const uploadText = document.querySelector('.upload-text p');
        uploadText.innerHTML = '<strong>Drop your PDF here</strong> or <span class="upload-link">browse files</span>';
        
        // Show upload section
        this.showSection('upload');
        
        // Reset progress
        this.updateProgress(0, '');
        this.updateProgressStep('upload');
    }

    showSection(sectionName) {
        // Hide all sections
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        
        // Show target section
        document.getElementById(`${sectionName}-section`).classList.add('active');
    }

    updateProgress(percentage, text) {
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        
        if (progressFill) progressFill.style.width = `${percentage}%`;
        if (progressText) progressText.textContent = text;
    }

    updateProgressStep(stepName) {
        // Remove active class from all steps
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
        });
        
        // Add completed class to previous steps
        const steps = ['upload', 'analyze', 'remediate', 'complete'];
        const currentIndex = steps.indexOf(stepName);
        
        steps.forEach((step, index) => {
            const stepElement = document.querySelector(`[data-step="${step}"]`);
            if (index < currentIndex) {
                stepElement.classList.add('completed');
            } else if (index === currentIndex) {
                stepElement.classList.add('active');
            }
        });
    }

    getIssueCount(result, severity) {
        // This would be calculated from actual issue data
        // For now, return placeholder values
        const total = result.issues;
        switch (severity) {
            case 'critical': return Math.floor(total * 0.3);
            case 'moderate': return Math.floor(total * 0.5);
            case 'minor': return Math.floor(total * 0.2);
            default: return 0;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        toastContainer.appendChild(toast);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 5000);
    }
}

// Modal functions
function showModal(title, content) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    
    modalBody.innerHTML = `<h2>${title}</h2>${content}`;
    modal.style.display = 'block';
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

function showAbout() {
    const content = `
        <p>The PDF Accessibility Tool helps you evaluate and remediate PDF documents for accessibility compliance according to WCAG standards.</p>
        <h3>Features:</h3>
        <ul>
            <li>Automated accessibility analysis</li>
            <li>WCAG AA and AAA compliance checking</li>
            <li>Automatic remediation of common issues</li>
            <li>Detailed accessibility reports</li>
            <li>No user input required for fixes</li>
        </ul>
        <h3>Supported Standards:</h3>
        <ul>
            <li>WCAG 2.1 AA (required by most regulations)</li>
            <li>WCAG 2.1 AAA (enhanced accessibility)</li>
            <li>PDF/UA compatibility</li>
        </ul>
    `;
    showModal('About PDF Accessibility Tool', content);
}

function showHelp() {
    const content = `
        <h3>How to Use:</h3>
        <ol>
            <li><strong>Upload:</strong> Select or drag a PDF file (max 50MB)</li>
            <li><strong>Choose Standard:</strong> Select WCAG AA or AAA compliance level</li>
            <li><strong>Analyze:</strong> Click "Analyze PDF" to start the evaluation</li>
            <li><strong>Review:</strong> View the detailed accessibility report</li>
            <li><strong>Remediate:</strong> Click "Auto-Remediate" to fix issues automatically</li>
            <li><strong>Download:</strong> Get your accessibility-improved PDF</li>
        </ol>
        
        <h3>What Gets Fixed Automatically:</h3>
        <ul>
            <li>Missing document metadata (title, subject, language)</li>
            <li>Basic document structure and tagging</li>
            <li>Reading order optimization</li>
            <li>Form field accessibility attributes</li>
        </ul>
        
        <h3>Manual Review Required:</h3>
        <ul>
            <li>Alternative text for images</li>
            <li>Color contrast verification</li>
            <li>Complex table structures</li>
            <li>Context-specific content descriptions</li>
        </ul>
    `;
    showModal('Help & Instructions', content);
}

function showPrivacy() {
    const content = `
        <h3>Data Handling:</h3>
        <ul>
            <li>PDFs are processed securely on our servers</li>
            <li>Files are automatically deleted after 24 hours</li>
            <li>No personal data is stored permanently</li>
            <li>All processing is done server-side for security</li>
        </ul>
        
        <h3>Security:</h3>
        <ul>
            <li>Encrypted file transfer (HTTPS)</li>
            <li>Rate limiting to prevent abuse</li>
            <li>File type validation</li>
            <li>Size restrictions for performance</li>
        </ul>
        
        <h3>Your Rights:</h3>
        <ul>
            <li>Your files are processed temporarily</li>
            <li>No tracking or analytics on documents</li>
            <li>Processing logs are minimal and temporary</li>
        </ul>
    `;
    showModal('Privacy & Security', content);
}

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    const modal = document.getElementById('modal');
    if (e.target === modal) {
        closeModal();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    }
});

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PDFAccessibilityApp();
    // Modal and footer links event listeners
    const aboutLink = document.getElementById('about-link');
    const helpLink = document.getElementById('help-link');
    const privacyLink = document.getElementById('privacy-link');
    const modalClose = document.getElementById('modal-close');

    if (aboutLink) aboutLink.addEventListener('click', (e) => { e.preventDefault(); showAbout(); });
    if (helpLink) helpLink.addEventListener('click', (e) => { e.preventDefault(); showHelp(); });
    if (privacyLink) privacyLink.addEventListener('click', (e) => { e.preventDefault(); showPrivacy(); });
    if (modalClose) modalClose.addEventListener('click', closeModal);
});

// Service worker registration for PWA capabilities (optional)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(() => console.log('Service Worker registered'))
            .catch(() => console.log('Service Worker registration failed'));
    });
}