'use client';

import { useEffect, useRef, useState } from 'react';
import Header from '../components/Header';
import PromptForm from '../components/PromptForm';
import RecentRuns from '../components/RecentRuns';
import LiveLog from '../components/LiveLog';
import ResultPanel from '../components/ResultPanel';
import VideoModal from '../components/VideoModal';
import SettingsModal from '../components/SettingsModal';

const DEFAULT_PROMPT =
  'Go to https://demo.playwright.dev/todomvc, add a todo called "Buy milk", and check it off.';

// Non-secret settings persisted across sessions — auth credentials are deliberately excluded.
const SETTINGS_STORAGE_KEY = 'qaagent-settings';

function statusForBadge(running, run) {
  if (running) return 'running';
  if (!run) return 'idle';
  if (run.status === 'passed') return 'pass';
  if (run.status === 'failed') return 'fail';
  if (run.status === 'cancelled') return 'cancelled';
  return 'idle';
}

export default function Page() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [engine, setEngine] = useState('claudeCode');
  const [model, setModel] = useState('claude-haiku-4-5');
  const [testType, setTestType] = useState('ui');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState('none');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [authHeaderName, setAuthHeaderName] = useState('');
  const [authHeaderValue, setAuthHeaderValue] = useState('');
  const [instructions, setInstructions] = useState('');

  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [currentRun, setCurrentRun] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [runs, setRuns] = useState([]);
  const [videoUrl, setVideoUrl] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [baseUrlError, setBaseUrlError] = useState(false);

  // Tracks the run id whose live 'log' SSE events we should accept — kept in a
  // ref (not state) so the EventSource handler set up once in the mount effect
  // always sees the latest value instead of a stale closure.
  const currentRunIdRef = useRef(null);
  // The run actually in progress — unlike currentRunIdRef, unaffected by browsing history.
  const activeRunIdRef = useRef(null);

  async function loadRuns() {
    try {
      const data = await fetch('/api/runs').then((r) => r.json());
      setRuns(data.runs || []);
      if (data.running) {
        setRunning(true);
        // On refresh mid-run, the 'run-start' SSE event already fired before we connected.
        const activeId = data.runs?.[0]?.id;
        if (activeId) activeRunIdRef.current = activeId;
      }
    } catch {
      // Best-effort — the SSE stream is the source of truth for live state.
    }
  }

  useEffect(() => {
    if (localStorage.getItem('qaagent-sidebar-collapsed') === '1') {
      setSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('qaagent-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
      if (saved.engine) setEngine(saved.engine);
      if (saved.model) setModel(saved.model);
      if (saved.testType) setTestType(saved.testType);
      if (saved.baseUrl) setBaseUrl(saved.baseUrl);
      if (saved.authType) setAuthType(saved.authType);
      if (saved.instructions) setInstructions(saved.instructions);
    } catch {
      // Corrupt/missing storage — fall back to defaults.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ engine, model, testType, baseUrl, authType, instructions })
    );
  }, [engine, model, testType, baseUrl, authType, instructions]);

  useEffect(() => {
    loadRuns();

    const evtSource = new EventSource('/api/stream');

    evtSource.addEventListener('run-start', (e) => {
      const rec = JSON.parse(e.data);
      currentRunIdRef.current = rec.id;
      activeRunIdRef.current = rec.id;
      setLogLines([]);
      setSubmitError(null);
      setCurrentRun(rec);
      setRunning(true);
      loadRuns();
    });

    evtSource.addEventListener('log', (e) => {
      const { runId, line } = JSON.parse(e.data);
      if (runId !== currentRunIdRef.current) return;
      setLogLines((prev) => [...prev, line]);
    });

    evtSource.addEventListener('run-complete', (e) => {
      const rec = JSON.parse(e.data);
      activeRunIdRef.current = null;
      setRunning(false);
      setCurrentRun(rec);
      loadRuns();
    });

    return () => evtSource.close();
  }, []);

  function buildAuth() {
    if (testType !== 'api') return undefined;
    if (authType === 'basic' && (authUsername || authPassword)) {
      return { type: 'basic', username: authUsername, password: authPassword };
    }
    if (authType === 'bearer' && authToken.trim()) {
      return { type: 'bearer', token: authToken.trim() };
    }
    if (authType === 'header' && authHeaderName.trim() && authHeaderValue) {
      return { type: 'header', name: authHeaderName.trim(), value: authHeaderValue };
    }
    return undefined;
  }

  async function handleRun() {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    if (!baseUrl.trim()) {
      setSubmitError('Base URL is required — set it in Settings before running.');
      setBaseUrlError(true);
      setShowSettings(true);
      return;
    }

    setSubmitError(null);
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: trimmed,
        provider: engine,
        model,
        testType,
        baseUrl: baseUrl.trim() || undefined,
        auth: buildAuth(),
        instructions: testType === 'api' ? (instructions.trim() || undefined) : undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setSubmitError(err.error || 'Failed to start run.');
    }
  }

  function handleSelectRun(run) {
    currentRunIdRef.current = null;
    setSubmitError(null);
    setCurrentRun(run);
    setLogLines(run.logLines || []);
    setPrompt(run.prompt);
    setEngine(run.provider);
    setModel(run.model);
    setTestType(run.testType || 'ui');
    setBaseUrl(run.baseUrl || '');
    setInstructions(run.instructions || '');
    // Credentials are never stored server-side, so there's nothing to restore — reset the
    // auth fields rather than leaving a stale value that no longer reflects this run.
    setAuthType('none');
    setAuthUsername('');
    setAuthPassword('');
    setAuthToken('');
    setAuthHeaderName('');
    setAuthHeaderValue('');
  }

  async function handleStop() {
    const runId = activeRunIdRef.current;
    if (!runId) return;
    try {
      await fetch('/api/run/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
    } catch {
      // Best-effort — the SSE 'run-complete' event is the source of truth.
    }
  }

  async function handleOpenTrace(runId) {
    await fetch('/api/open-trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
  }

  return (
    <div className={'app-shell' + (sidebarCollapsed ? ' sidebar-collapsed' : '')}>
      <RecentRuns
        runs={runs}
        onSelect={handleSelectRun}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />

      <div className="main-col">
        <Header status={statusForBadge(running, currentRun)} onOpenSettings={() => setShowSettings(true)} />

        <main>
          <PromptForm
            prompt={prompt}
            setPrompt={setPrompt}
            engine={engine}
            model={model}
            testType={testType}
            onRun={handleRun}
            onStop={handleStop}
            running={running}
          />

          <div className="results-grid">
            <LiveLog lines={logLines} />
            <ResultPanel
              run={currentRun}
              submitError={submitError}
              onWatchVideo={setVideoUrl}
              onOpenTrace={handleOpenTrace}
            />
          </div>
        </main>
      </div>

      <VideoModal videoUrl={videoUrl} onClose={() => setVideoUrl(null)} />

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        engine={engine}
        setEngine={setEngine}
        model={model}
        setModel={setModel}
        testType={testType}
        setTestType={setTestType}
        baseUrl={baseUrl}
        setBaseUrl={(v) => { setBaseUrl(v); setBaseUrlError(false); }}
        baseUrlError={baseUrlError}
        authType={authType}
        setAuthType={setAuthType}
        authUsername={authUsername}
        setAuthUsername={setAuthUsername}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        authToken={authToken}
        setAuthToken={setAuthToken}
        authHeaderName={authHeaderName}
        setAuthHeaderName={setAuthHeaderName}
        authHeaderValue={authHeaderValue}
        setAuthHeaderValue={setAuthHeaderValue}
        instructions={instructions}
        setInstructions={setInstructions}
      />
    </div>
  );
}
