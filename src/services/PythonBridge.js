'use strict';

/**
 * PythonBridge — spawns Python scripts for deep PDF analysis and remediation.
 * Degrades gracefully to null when Python or its libraries are unavailable.
 */

const { spawn } = require('child_process');
const path = require('path');
const logger = require('../logger');

const SCRIPTS_DIR = path.join(__dirname, '..', 'python');
const PYTHON_CMD = process.env.PYTHON_PATH || 'python3';
const TIMEOUT_MS = parseInt(process.env.PYTHON_TIMEOUT_MS || '60000', 10);

/**
 * Run a Python script and return its parsed stdout as a JS object.
 * Rejects on non-zero exit, parse error, or timeout.
 */
function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const child = spawn(PYTHON_CMD, [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Python script timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(
          `Python script exited with code ${code}: ${stderr.trim() || stdout.trim()}`
        ));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (_) {
        reject(new Error(`Failed to parse Python output: ${stdout.slice(0, 300)}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(
          `Python interpreter not found ('${PYTHON_CMD}'). ` +
          'Install Python 3 and set the PYTHON_PATH environment variable.'
        ));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Analyze a PDF for accessibility data.
 * Returns the analysis object or null if Python is unavailable.
 */
async function analyzePDF(pdfPath) {
  try {
    const result = await runScript('analyze_pdf.py', [pdfPath]);
    if (result.errors && result.errors.length > 0) {
      logger.warn({ pdfPath, errors: result.errors }, 'Python analysis completed with warnings');
    }
    return result;
  } catch (err) {
    logger.warn({ err: err.message }, 'Python analysis unavailable — falling back to basic analysis');
    return null;
  }
}

/**
 * Apply structural fixes to a PDF using Python/pikepdf.
 * Returns the remediation result object, or throws on hard failure.
 */
async function remediatePDF(inputPath, outputPath, fixes) {
  const result = await runScript('remediate_pdf.py', [
    inputPath,
    outputPath,
    JSON.stringify(fixes),
  ]);
  if (!result.success && result.errors && result.errors.length > 0) {
    logger.warn({ errors: result.errors }, 'Python remediation completed with errors');
  }
  return result;
}

module.exports = { analyzePDF, remediatePDF };
