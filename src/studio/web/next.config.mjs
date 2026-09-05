import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `@playwright/test` (and its transitive deps, e.g. fsevents, chromium-bidi)
  // ships native binaries and dynamic requires that Next's webpack bundler
  // can't process. Route handlers run in the Node.js runtime, so keep these
  // as real `require()` calls instead of trying to bundle them.
  serverExternalPackages: ['@playwright/test', 'playwright-core', 'playwright'],
  // This nested package.json lives inside the qa-agent repo, which has its
  // own root lockfile — pin the tracing root so Next doesn't guess.
  outputFileTracingRoot: join(__dirname, '../../..'),
};

export default nextConfig;
