import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Unit tests for the dashboard's hooks and components. Deliberately NOT vite.config.ts:
// that one carries vike() and telefunc(), which serve the app and only get in the way
// here. All the unit tests need is the JSX transform and the `@` alias.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**'],
  },
})
