// Vite + Vitest configuration for BhopCraft.
// Global context: `npm run dev` serves the game with the log-file plugin (browser logs -> logs/*.log + terminal);
// `npm test` runs the Node-only unit tests under tests/; `npm run build` emits a static site into dist/.
// Docs: https://vite.dev/config/ and https://vitest.dev/config/ (defineConfig from 'vitest/config' merges both schemas).
import { defineConfig } from 'vitest/config'; // Typed config helper that also knows the `test` block.
import { logFilePlugin } from './server/logPlugin'; // POST /__log -> logs/game_<session>.log.

export default defineConfig({
  base: './', // Relative asset URLs so dist/ works from any sub-path (e.g. GitHub Pages /repo/).
  plugins: [logFilePlugin()], // Dev/preview log endpoint.
  server: { port: 5173, strictPort: true }, // Fixed port so the launch config and docs can rely on it.
  preview: { port: 4173, strictPort: true }, // Fixed port for `vite preview`.
  test: {
    include: ['tests/**/*.test.ts'], // Only our test folder.
    environment: 'node', // Physics/world code is DOM-free, so plain Node is enough (and fast).
  },
});
