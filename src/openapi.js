'use strict';

/**
 * OpenAPI 3.0 specification for the PDF Accessibility Tool API.
 * Served at /api/docs (Swagger UI) and /api/docs.json (raw JSON).
 */
const spec = {
  openapi: '3.0.3',
  info: {
    title: 'PDF Accessibility Tool API',
    version: '0.0.1',
    description:
      'Upload PDF documents, receive WCAG 2.1 AA/AAA accessibility reports, and apply automatic remediations.',
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  tags: [
    { name: 'Analysis', description: 'Upload and analyse PDFs' },
    { name: 'Remediation', description: 'Apply accessibility fixes' },
    { name: 'Files', description: 'Download remediated PDFs' },
    { name: 'Reports', description: 'Export report data' },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        operationId: 'getHealth',
        tags: [],
        responses: {
          200: {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    version: { type: 'string', example: '0.0.1' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/analyze': {
      post: {
        summary: 'Upload and analyse a PDF',
        operationId: 'analyzePDF',
        tags: ['Analysis'],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['pdf'],
                properties: {
                  pdf: {
                    type: 'string',
                    format: 'binary',
                    description: 'PDF file to analyse (max 50 MB)',
                  },
                  wcagLevel: {
                    type: 'string',
                    enum: ['AA', 'AAA'],
                    default: 'AA',
                    description: 'WCAG 2.1 conformance level to check against',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Analysis complete',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AnalysisResult' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          429: { $ref: '#/components/responses/RateLimited' },
          500: { $ref: '#/components/responses/ServerError' },
        },
      },
    },
    '/api/status/{jobId}': {
      get: {
        summary: 'Check analysis job status',
        operationId: 'getJobStatus',
        tags: ['Analysis'],
        parameters: [{ $ref: '#/components/parameters/jobId' }],
        responses: {
          200: {
            description: 'Job status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['pending', 'analyzed', 'remediated'] },
                    wcagLevel: { type: 'string' },
                    issueCount: { type: 'integer' },
                    fixedCount: { type: 'integer' },
                    reportUrl: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/remediate/{jobId}': {
      post: {
        summary: 'Apply automatic fixes to an analysed PDF',
        operationId: 'remediatePDF',
        tags: ['Remediation'],
        parameters: [{ $ref: '#/components/parameters/jobId' }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  autoFix: {
                    type: 'boolean',
                    default: true,
                    description: 'Apply all automatically-fixable issues',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Remediation complete',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RemediationResult' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          404: { $ref: '#/components/responses/NotFound' },
          500: { $ref: '#/components/responses/ServerError' },
        },
      },
    },
    '/api/download/{jobId}': {
      get: {
        summary: 'Download the remediated PDF',
        operationId: 'downloadPDF',
        tags: ['Files'],
        parameters: [{ $ref: '#/components/parameters/jobId' }],
        responses: {
          200: {
            description: 'Remediated PDF file',
            content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
          },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/report/{jobId}/json': {
      get: {
        summary: 'Download report data as JSON',
        operationId: 'getReportJSON',
        tags: ['Reports'],
        parameters: [{ $ref: '#/components/parameters/jobId' }],
        responses: {
          200: { description: 'Raw report data', content: { 'application/json': {} } },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/report/{jobId}/csv': {
      get: {
        summary: 'Download accessibility issues as CSV',
        operationId: 'getReportCSV',
        tags: ['Reports'],
        parameters: [{ $ref: '#/components/parameters/jobId' }],
        responses: {
          200: { description: 'CSV file', content: { 'text/csv': {} } },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
  },
  components: {
    parameters: {
      jobId: {
        name: 'jobId',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
        description: 'Unique job identifier returned by /api/analyze',
      },
    },
    schemas: {
      Issue: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          wcagRule: { type: 'string', example: '1.3.1' },
          severity: { type: 'string', enum: ['critical', 'moderate', 'minor'] },
          title: { type: 'string' },
          description: { type: 'string' },
          element: { type: 'string' },
          page: {},
          fixable: { type: 'boolean' },
          impact: { type: 'string' },
          confident: { type: 'boolean', description: 'True when finding is from Python-enhanced analysis' },
        },
      },
      AnalysisResult: {
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid' },
          status: { type: 'string', example: 'analyzed' },
          issues: { type: 'integer', description: 'Total number of accessibility issues detected' },
          pythonEnhanced: { type: 'boolean' },
          reportUrl: { type: 'string' },
          remediationUrl: { type: 'string' },
        },
      },
      RemediationResult: {
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid' },
          status: { type: 'string', example: 'remediated' },
          originalIssues: { type: 'integer' },
          fixedIssues: { type: 'integer' },
          remainingIssues: { type: 'integer' },
          pythonEnhanced: { type: 'boolean' },
          reportUrl: { type: 'string' },
          downloadUrl: { type: 'string' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: { type: 'string', description: 'Only present in non-production environments' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'Bad request',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'Resource not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      RateLimited: {
        description: 'Too many requests',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      ServerError: {
        description: 'Internal server error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
};

module.exports = spec;
