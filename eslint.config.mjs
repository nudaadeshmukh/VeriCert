import coreWebVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'tmp/**',
      'samples/**',
      'tests/fixtures/**',
    ],
  },
  ...coreWebVitals,
];

export default eslintConfig;
