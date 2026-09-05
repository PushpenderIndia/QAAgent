#!/usr/bin/env node

/**
 * npm install lifecycle hook — best-effort, must never fail the install.
 * See src/cli/ensureOpencodeCli.js for why this is needed.
 */

import { ensureOpencodeCli } from '../src/cli/ensureOpencodeCli.js';

ensureOpencodeCli({ log: console.log }).catch(() => {});
