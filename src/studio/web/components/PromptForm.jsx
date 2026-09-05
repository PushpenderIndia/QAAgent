'use client';

import { useState } from 'react';

const ENGINE_LABELS = {
  claudeCode: 'Claude Code',
  openCode: 'OpenCode',
};

export default function PromptForm({
  prompt,
  setPrompt,
  engine,
  model,
  testType,
  onRun,
  onStop,
  running,
}) {
  const [mode, setMode] = useState('scenario'); // 'scenario' | 'pr'

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onRun();
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setPrompt('');
  }

  return (
    <div className="card">
      <div className="mode-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'scenario'}
          className={'mode-tab' + (mode === 'scenario' ? ' active' : '')}
          onClick={() => switchMode('scenario')}
        >
          <span className="material-symbols-outlined">edit_note</span>
          Test a scenario
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'pr'}
          className={'mode-tab' + (mode === 'pr' ? ' active' : '')}
          onClick={() => switchMode('pr')}
        >
          <span className="material-symbols-outlined">merge</span>
          Test a PR
        </button>
      </div>

      {mode === 'scenario' ? (
        <textarea
          id="prompt"
          placeholder={
            testType === 'api'
              ? 'e.g. POST /users with {"name":"Ada"} should return 201 with an id, then GET /users/:id should return that same user.'
              : 'e.g. Go to https://demo.playwright.dev/todomvc, add a todo called "Buy milk", and check it off.'
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <>
          <input
            id="prompt"
            type="url"
            className="pr-url-input"
            placeholder="https://github.com/org/repo/pull/123"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <p className="hint pr-hint">
            <span className="material-symbols-outlined">info</span>
            Studio fetches this PR&rsquo;s diff and plans what to test from the change itself
            — no scenario needed. Requires the <code>gh</code> CLI installed and authenticated
            (<code>gh auth login</code>) with access to that PR/repository.
          </p>
        </>
      )}

      <div className="form-row">
        <div className="settings-summary">
          <span className="material-symbols-outlined">tune</span>
          {testType === 'api' ? 'API (backend)' : 'UI (browser)'} · {ENGINE_LABELS[engine] || engine} · {model}
        </div>
        <div className="spacer" />
        {running && (
          <label className="field">
            &nbsp;
            <button id="stopBtn" type="button" className="btn-secondary" onClick={onStop}>
              <span className="material-symbols-outlined">stop_circle</span>
              <span>Stop</span>
            </button>
          </label>
        )}
        <label className="field">
          &nbsp;
          <button id="runBtn" className="btn-run" disabled={running} onClick={onRun}>
            <span className={'material-symbols-outlined' + (running ? ' spin' : '')}>
              {running ? 'progress_activity' : 'play_arrow'}
            </span>
            <span>{running ? 'Running…' : 'Run'}</span>
          </button>
        </label>
      </div>
      <p className="hint">
        Tip: press ⌘/Ctrl + Enter to run. Uses your existing <code>claude login</code> /{' '}
        <code>opencode auth login</code> session.
      </p>
    </div>
  );
}
