const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const PDFProcessor = require('./PDFProcessor');

class AccessibilityAnalyzer {
  constructor() {
    this.pdfProcessor = new PDFProcessor();
    this.wcagRules = {
      'AA': this.getWCAGAARules(),
      'AAA': this.getWCAGAAARules()
    };
  }

  /**
   * Analyze PDF for accessibility issues
   */
  async analyze(filePath, wcagLevel = 'AA') {
    try {
      console.log(`Analyzing PDF accessibility for WCAG ${wcagLevel}`);
      
      const pdfInfo = await this.pdfProcessor.extractInfo(filePath);
      const structure = await this.pdfProcessor.getStructure(filePath);
      const interactive = await this.pdfProcessor.hasInteractiveElements(filePath);
      
      const issues = [];
      const rules = this.wcagRules[wcagLevel];
      
      // Run all accessibility checks
      issues.push(...await this.checkDocumentStructure(pdfInfo, structure));
      issues.push(...await this.checkTextAlternatives(filePath, pdfInfo));
      issues.push(...await this.checkColorContrast(filePath));
      issues.push(...await this.checkReadingOrder(pdfInfo));
      issues.push(...await this.checkInteractiveElements(interactive));
      issues.push(...await this.checkMetadata(pdfInfo));
      issues.push(...await this.checkLanguage(pdfInfo));
      issues.push(...await this.checkHeadingStructure(pdfInfo));
      issues.push(...await this.checkTableStructure(filePath));
      issues.push(...await this.checkFormFields(interactive));
      
      if (wcagLevel === 'AAA') {
        issues.push(...await this.checkAAaSpecificRules(filePath, pdfInfo));
      }
      
      // Sort issues by severity
      issues.sort((a, b) => this.getSeverityWeight(a.severity) - this.getSeverityWeight(b.severity));
      
      return issues;
    } catch (error) {
      console.error('Error analyzing accessibility:', error);
      throw new Error(`Failed to analyze accessibility: ${error.message}`);
    }
  }

  /**
   * Check document structure and tagging
   */
  async checkDocumentStructure(pdfInfo, structure) {
    const issues = [];
    
    if (!structure.isTagged) {
      issues.push({
        id: 'structure-001',
        wcagRule: '1.3.1',
        severity: 'critical',
        title: 'Document is not properly tagged',
        description: 'PDF lacks proper structural tags required for screen readers',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Screen readers cannot navigate the document structure'
      });
    }
    
    if (!structure.hasOutline && pdfInfo.pageCount > 3) {
      issues.push({
        id: 'structure-002',
        wcagRule: '2.4.5',
        severity: 'moderate',
        title: 'Missing document outline/bookmarks',
        description: 'Multi-page document lacks navigation bookmarks',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Users cannot easily navigate between sections'
      });
    }
    
    return issues;
  }

  /**
   * Check for alternative text on images
   */
  async checkTextAlternatives(filePath, pdfInfo) {
    const issues = [];
    
    try {
      const images = await this.pdfProcessor.extractImages(filePath);
      
      for (const pageImages of images) {
        if (pageImages.imageCount > 0) {
          issues.push({
            id: `alt-text-${pageImages.pageNumber}`,
            wcagRule: '1.1.1',
            severity: 'critical',
            title: 'Images may lack alternative text',
            description: 'Images found that may not have proper alternative text',
            element: 'Image',
            page: pageImages.pageNumber,
            fixable: true,
            impact: 'Screen reader users cannot understand image content'
          });
        }
      }
    } catch (error) {
      console.error('Error checking images:', error);
    }
    
    return issues;
  }

  /**
   * Check color contrast
   */
  async checkColorContrast(filePath) {
    const issues = [];
    
    // This is a placeholder - real implementation would analyze PDF colors
    // and calculate contrast ratios
    issues.push({
      id: 'contrast-001',
      wcagRule: '1.4.3',
      severity: 'moderate',
      title: 'Color contrast needs verification',
      description: 'Color contrast should be manually verified to meet WCAG standards',
      element: 'Text',
      page: 'All',
      fixable: false,
      impact: 'Users with visual impairments may have difficulty reading text'
    });
    
    return issues;
  }

  /**
   * Check reading order
   */
  async checkReadingOrder(pdfInfo) {
    const issues = [];
    
    // Placeholder for reading order analysis
    if (pdfInfo.textContent.length > 0) {
      issues.push({
        id: 'reading-order-001',
        wcagRule: '1.3.2',
        severity: 'moderate',
        title: 'Reading order needs verification',
        description: 'Document reading order should be verified for logical flow',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Screen readers may read content in incorrect order'
      });
    }
    
    return issues;
  }

  /**
   * Check interactive elements
   */
  async checkInteractiveElements(interactive) {
    const issues = [];
    
    if (interactive.hasForm) {
      for (const field of interactive.fields) {
        issues.push({
          id: `form-${field.name}`,
          wcagRule: '4.1.2',
          severity: 'moderate',
          title: `Form field "${field.name}" needs accessibility review`,
          description: 'Form field should have proper labels and descriptions',
          element: 'Form Field',
          page: 'Unknown',
          fixable: true,
          impact: 'Users may not understand the purpose of form fields'
        });
      }
    }
    
    return issues;
  }

  /**
   * Check document metadata
   */
  async checkMetadata(pdfInfo) {
    const issues = [];
    
    if (!pdfInfo.title || pdfInfo.title === 'Untitled') {
      issues.push({
        id: 'metadata-001',
        wcagRule: '2.4.2',
        severity: 'moderate',
        title: 'Missing document title',
        description: 'PDF document lacks a descriptive title',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Users cannot identify document purpose from title'
      });
    }
    
    if (!pdfInfo.subject) {
      issues.push({
        id: 'metadata-002',
        wcagRule: '2.4.2',
        severity: 'minor',
        title: 'Missing document subject',
        description: 'PDF document lacks subject metadata',
        element: 'Document',
        page: 'All',
        fixable: true,
        impact: 'Document lacks descriptive information'
      });
    }
    
    return issues;
  }

  /**
   * Check language specification
   */
  async checkLanguage(pdfInfo) {
    const issues = [];
    
    // Placeholder for language detection
    issues.push({
      id: 'language-001',
      wcagRule: '3.1.1',
      severity: 'moderate',
      title: 'Document language not specified',
      description: 'PDF should specify the primary language',
      element: 'Document',
      page: 'All',
      fixable: true,
      impact: 'Screen readers may use incorrect pronunciation'
    });
    
    return issues;
  }

  /**
   * Check heading structure
   */
  async checkHeadingStructure(pdfInfo) {
    const issues = [];
    
    // Simple check for potential headings based on text patterns
    const text = pdfInfo.textContent;
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    
    let hasHeadingStructure = false;
    
    // Look for patterns that might indicate headings
    for (const line of lines) {
      if (line.length < 100 && /^[A-Z][A-Za-z\s]+$/.test(line.trim())) {
        hasHeadingStructure = true;
        break;
      }
    }
    
    if (!hasHeadingStructure && pdfInfo.textContent.length > 1000) {
      issues.push({
        id: 'heading-001',
        wcagRule: '1.3.1',
        severity: 'moderate',
        title: 'Missing heading structure',
        description: 'Long document appears to lack proper heading structure',
        element: 'Headings',
        page: 'All',
        fixable: true,
        impact: 'Users cannot navigate document by headings'
      });
    }
    
    return issues;
  }

  /**
   * Check table structure
   */
  async checkTableStructure(filePath) {
    const issues = [];
    
    // Placeholder for table analysis
    // In a real implementation, this would detect tables and check for headers
    
    return issues;
  }

  /**
   * Check form fields accessibility
   */
  async checkFormFields(interactive) {
    const issues = [];
    
    if (interactive.hasForm) {
      issues.push({
        id: 'form-001',
        wcagRule: '1.3.1',
        severity: 'moderate',
        title: 'Form accessibility needs review',
        description: 'Interactive forms require manual accessibility verification',
        element: 'Form',
        page: 'All',
        fixable: true,
        impact: 'Form may not be usable with assistive technology'
      });
    }
    
    return issues;
  }

  /**
   * Check AAA-specific rules
   */
  async checkAAaSpecificRules(filePath, pdfInfo) {
    const issues = [];
    
    // Enhanced color contrast (AAA requires 7:1 ratio)
    issues.push({
      id: 'contrast-aaa-001',
      wcagRule: '1.4.6',
      severity: 'moderate',
      title: 'Enhanced color contrast verification needed',
      description: 'AAA level requires 7:1 contrast ratio for normal text',
      element: 'Text',
      page: 'All',
      fixable: false,
      impact: 'Enhanced accessibility for users with visual impairments'
    });
    
    // Context-sensitive help
    issues.push({
      id: 'help-aaa-001',
      wcagRule: '3.3.5',
      severity: 'minor',
      title: 'Context-sensitive help may be missing',
      description: 'AAA level requires context-sensitive help for complex content',
      element: 'Document',
      page: 'All',
      fixable: true,
      impact: 'Users may need additional assistance understanding content'
    });
    
    return issues;
  }

  /**
   * Get WCAG AA rules
   */
  getWCAGAARules() {
    return {
      '1.1.1': 'Non-text Content',
      '1.3.1': 'Info and Relationships',
      '1.3.2': 'Meaningful Sequence',
      '1.4.3': 'Contrast (Minimum)',
      '2.4.2': 'Page Titled',
      '2.4.5': 'Multiple Ways',
      '3.1.1': 'Language of Page',
      '4.1.2': 'Name, Role, Value'
    };
  }

  /**
   * Get WCAG AAA rules (includes AA rules plus additional)
   */
  getWCAGAAARules() {
    return {
      ...this.getWCAGAARules(),
      '1.4.6': 'Contrast (Enhanced)',
      '3.3.5': 'Help',
      '2.4.9': 'Link Purpose (Link Only)',
      '2.4.10': 'Section Headings'
    };
  }

  /**
   * Get severity weight for sorting
   */
  getSeverityWeight(severity) {
    const weights = {
      'critical': 1,
      'moderate': 2,
      'minor': 3
    };
    return weights[severity] || 4;
  }
}

module.exports = AccessibilityAnalyzer;