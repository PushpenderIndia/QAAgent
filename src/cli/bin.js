#!/usr/bin/env node

/**
 * QAAgent CLI
 *
 * Scaffold new BDD projects with AI-powered test automation
 */

import { Command } from 'commander';
import { init } from './init.js';
import { generate } from './generate.js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import net from 'net';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('qa-agent')
  .description('AI-powered browser automation with QAAgent')
  .version(packageJson.version);

program
  .command('init [framework]')
  .description('Initialize a new QAAgent project')
  .option('-d, --dir <directory>', 'Project directory (default: current directory)')
  .action(async (framework, options) => {
    await init(framework, options);
  });

program
  .command('generate [paths...]')
  .description('Generate Playwright tests from YAML files')
  .option('-w, --watch', 'Watch for changes and regenerate automatically')
  .option('-v, --verbose', 'Verbose output', true)
  .action(async (paths, options) => {
    await generate(paths, options);
  });

const DEFAULT_STUDIO_PORT = 4590;

function runCommand(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

/** Checks whether a TCP port is free on 127.0.0.1 by attempting to bind to it. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

/** Finds a free port to bind an ephemeral server to, then releases it. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', reject);
    tester.once('listening', () => {
      const { port } = tester.address();
      tester.close(() => resolve(port));
    });
    tester.listen(0, '127.0.0.1');
  });
}

async function resolveStudioPort(preferredPort) {
  const candidate = preferredPort ?? DEFAULT_STUDIO_PORT;
  if (await isPortFree(candidate)) return candidate;
  return findFreePort();
}

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { shell: process.platform === 'win32', stdio: 'ignore', detached: true }).unref();
  } catch {
    // Best-effort — not fatal if the OS doesn't have a handler.
  }
}

/** Polls the studio URL until it responds or the timeout elapses. */
function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for Studio server at ${url}`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    }
    attempt();
  });
}

program
  .command('studio')
  .description('Launch QAAgent Studio — a local web UI to describe a test in plain English and watch it run')
  .option('-p, --port <port>', 'Port to run the studio server on')
  .option('--no-open', 'Do not automatically open the browser')
  .action(async (options) => {
    const webDir = join(__dirname, '../studio/web');

    if (!existsSync(join(webDir, 'node_modules'))) {
      console.log('📦 Installing Studio UI dependencies (first run only)...');
      await runCommand('npm', ['install'], { cwd: webDir });
    }

    const nextBin = join(webDir, 'node_modules', '.bin', 'next');
    if (!existsSync(nextBin)) {
      throw new Error(`Could not find the Next.js binary at ${nextBin}. Try deleting src/studio/web/node_modules and re-running.`);
    }

    console.log('🏗️  Building Studio UI...');
    await runCommand(nextBin, ['build'], { cwd: webDir });

    const port = await resolveStudioPort(options.port ? Number(options.port) : undefined);
    const studioUrl = `http://localhost:${port}`;

    const child = spawn(nextBin, ['start', '-p', String(port)], {
      cwd: webDir,
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let settled = false;
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (!settled && /ready/i.test(text)) {
        settled = true;
      }
    });

    child.on('error', (err) => {
      console.error('Failed to start Studio server:', err.message);
      process.exit(1);
    });

    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error(`Studio server exited with code ${code}`);
        process.exit(code);
      }
    });

    let cleanedUp = false;
    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      if (!child.killed) child.kill();
    }
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    process.on('exit', cleanup);

    try {
      await waitForServer(studioUrl);
    } catch (err) {
      cleanup();
      throw err;
    }

    console.log(`\n🧪 QAAgent Studio running at ${studioUrl}\n`);

    if (options.open) {
      openInBrowser(studioUrl);
    }
  });

program.parse();
