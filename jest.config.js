'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    'server.js',
    '!src/python/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  // Give each test file a fresh module registry so DB state doesn't bleed
  resetModules: false,
  testTimeout: 30000,
  verbose: true,
};
