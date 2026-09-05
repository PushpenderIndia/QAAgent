/**
 * Best-effort installer for the `opencode` CLI binary.
 *
 * `@opencode-ai/sdk`'s createOpencode() always shells out to a global `opencode`
 * executable (cross-spawn('opencode', ['serve', ...])) — the SDK package itself
 * does not ship that binary, it lives in the separate `opencode-ai` npm package.
 * Without it, the openCode engine fails at runtime with `spawn opencode ENOENT`.
 *
 * This never throws and never blocks the caller: a failed/skipped install just
 * means the openCode engine won't work until the user installs it themselves —
 * it must not break `npm install` or `qa-agent studio` for Claude Code-only users.
 */

import { execFileSync } from 'child_process';

function isOpencodeInstalled() {
  try {
    execFileSync('opencode', ['--version'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ log?: (msg: string) => void }} [options]
 * @returns {Promise<boolean>} true if `opencode` is available after this call
 */
export async function ensureOpencodeCli({ log = () => {} } = {}) {
  if (isOpencodeInstalled()) return true;

  log('📦 opencode CLI not found — installing "opencode-ai" globally (needed for the OpenCode engine)...');
  try {
    execFileSync('npm', ['install', '-g', 'opencode-ai'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
  } catch (err) {
    log(`⚠️  Could not auto-install the opencode CLI (${err.message}).`);
    log('   The openCode engine will be unavailable until you run: npm install -g opencode-ai');
    return false;
  }

  if (isOpencodeInstalled()) {
    log('✅ opencode CLI installed. Run "opencode auth login" once to authenticate it.');
    return true;
  }

  log('⚠️  Installed opencode-ai but the "opencode" binary still isn\'t on PATH.');
  return false;
}
