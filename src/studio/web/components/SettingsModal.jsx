'use client';

import { useEffect, useState } from 'react';

const AUTH_LABELS = {
  none: 'No auth',
  basic: 'Basic (username/password)',
  bearer: 'Bearer token',
  header: 'Custom header',
};

export default function SettingsModal({
  open,
  onClose,
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
}) {
  const [modelOptions, setModelOptions] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);

  // Model IDs come live from the installed SDK for the selected engine (never hardcoded
  // here), so the list always reflects whatever models that SDK currently supports.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);

    fetch(`/api/models?engine=${engine}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setModelsError(data.error);
          setModelOptions([]);
          return;
        }
        setModelOptions(data.models || []);
        if (data.models?.length && !data.models.some((m) => m.value === model)) {
          setModel(data.models[0].value);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setModelsError(err.message || 'Failed to load models.');
          setModelOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, engine]);

  function handleEngineChange(e) {
    setEngine(e.target.value);
  }

  return (
    <div className={'modal-backdrop' + (open ? ' open' : '')}>
      <div className="modal settings-modal">
        <div className="settings-head">
          <h2>Settings</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close settings">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="form-row">
          <label className="field">
            Target
            <select value={testType} onChange={(e) => setTestType(e.target.value)}>
              <option value="ui">UI (browser)</option>
              <option value="api">API (backend)</option>
            </select>
          </label>
          <label className="field">
            Engine
            <select value={engine} onChange={handleEngineChange}>
              <option value="claudeCode">Claude Code</option>
              <option value="openCode">OpenCode</option>
            </select>
          </label>
          <label className="field">
            Model
            {modelsLoading ? (
              <select disabled>
                <option>Loading models…</option>
              </select>
            ) : modelsError ? (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                title={modelsError}
              />
            ) : (
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {!modelOptions.some((m) => m.value === model) && model && (
                  <option value={model}>{model} (custom)</option>
                )}
                {modelOptions.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            )}
            {modelsError && (
              <span className="field-error">Couldn&rsquo;t load live models — enter an ID manually.</span>
            )}
          </label>
        </div>

        {testType === 'api' && (
          <div className="api-options">
            <div className="form-row">
              <label className="field">
                Base URL
                <input
                  type="text"
                  placeholder="http://localhost:3000"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </label>
              <label className="field">
                Auth
                <select value={authType} onChange={(e) => setAuthType(e.target.value)}>
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
              className="instructions-textarea"
              placeholder="Additional instructions (optional) — e.g. &quot;First POST /login with these creds to get a token&quot;, or endpoint-specific context the agent wouldn't otherwise know."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
        )}

        <p className="hint">
          Saved on this device for next time — auth credentials are never persisted, re-enter them per session.
        </p>

        <div className="settings-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
