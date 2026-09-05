'use client';

import { useState } from 'react';

const ENGINE_DEFAULT_MODELS = {
  claudeCode: 'claude-haiku-4-5',
  openCode: 'anthropic/claude-haiku-4-5',
};

const AUTH_LABELS = {
  none: 'No auth',
  basic: 'Basic (username/password)',
  bearer: 'Bearer token',
  header: 'Custom header',
};

export default function PromptForm({
  prompt,
  setPrompt,
  engine,
  setEngine,
  model,
  setModel,
  testType,
  setTestType,
  baseUrl,
  setBaseUrl,
  authType,
  setAuthType,
  authUsername,
  setAuthUsername,
  authPassword,
  setAuthPassword,
  authToken,
  setAuthToken,
  authHeaderName,
  setAuthHeaderName,
  authHeaderValue,
  setAuthHeaderValue,
  instructions,
  setInstructions,
  onRun,
  onStop,
  running,
}) {
  const [mode, setMode] = useState('scenario'); // 'scenario' | 'pr'

  function handleEngineChange(e) {
    const nextEngine = e.target.value;
    setEngine(nextEngine);
    setModel(ENGINE_DEFAULT_MODELS[nextEngine]);
  }

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

      {testType === 'api' && (
        <div className="api-options">
          <div className="form-row">
            <label className="field">
              Base URL
              <input
                id="baseUrl"
                type="text"
                placeholder="http://localhost:3000"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>
            <label className="field">
              Auth
              <select id="authType" value={authType} onChange={(e) => setAuthType(e.target.value)}>
                {Object.entries(AUTH_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            {authType === 'basic' && (
              <>
                <label className="field">
                  Username
                  <input type="text" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} />
                </label>
                <label className="field">
                  Password
                  <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
                </label>
              </>
            )}
            {authType === 'bearer' && (
              <label className="field">
                Token
                <input type="password" placeholder="eyJhbGciOi..." value={authToken} onChange={(e) => setAuthToken(e.target.value)} />
              </label>
            )}
            {authType === 'header' && (
              <>
                <label className="field">
                  Header name
                  <input type="text" placeholder="X-Api-Key" value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} />
                </label>
                <label className="field">
                  Header value
                  <input type="password" value={authHeaderValue} onChange={(e) => setAuthHeaderValue(e.target.value)} />
                </label>
              </>
            )}
          </div>
          <textarea
            id="instructions"
            className="instructions-textarea"
            placeholder="Additional instructions (optional) — e.g. &quot;First POST /login with these creds to get a token&quot;, or endpoint-specific context the agent wouldn't otherwise know."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </div>
      )}

      <div className="form-row">
        <label className="field">
          Target
          <select id="testType" value={testType} onChange={(e) => setTestType(e.target.value)}>
            <option value="ui">UI (browser)</option>
            <option value="api">API (backend)</option>
          </select>
        </label>
        <label className="field">
          Engine
          <select id="engine" value={engine} onChange={handleEngineChange}>
            <option value="claudeCode">Claude Code</option>
            <option value="openCode">OpenCode</option>
          </select>
        </label>
        <label className="field">
          Model
          <input
            id="model"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
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
