/** E2E tests — membutuhkan PostgreSQL (DATABASE_URL) dan Redis (REDIS_URL) yang terpisah dari produksi. */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 30000,
};
