import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Ensure a clean DOM and storage between tests.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
