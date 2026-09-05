'use client';

import { useEffect, useRef } from 'react';

// Server-side log lines are prefixed with an emoji (shared with the CLI's console
// output — see src/agent/Logger.js and the providers). Here we swap that prefix
// for a Material Symbols icon instead of rendering the raw emoji.
const LOG_PATTERNS = [
  [/^❌\s*/, 'error', 'error'],
  [/^⚠️\s*/, 'warn', 'warning'],
  [/^🔧\s*/, 'tool', 'bolt'],
  [/^💬\s*/, 'assistant', 'chat_bubble'],
  [/^✅\s*/, 'result', 'check_circle'],
  [/^🆕\s*/, 'session', 'fiber_new'],
  [/^♻️\s*/, 'session', 'autorenew'],
  [/^🤖\s*/, 'session', 'smart_toy'],
];

function classifyLog(line) {
  for (const [re, cls, icon] of LOG_PATTERNS) {
    if (re.test(line)) return { cls, icon, text: line.replace(re, '') };
  }
  return { cls: '', icon: 'chevron_right', text: line };
}

export default function LiveLog({ lines }) {
  const logRef = useRef(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="card flex-card">
      <p className="panel-title">Live Log</p>
      <div id="log" ref={logRef}>
        {lines.length === 0 ? (
          <span className="placeholder">Agent output will stream here while a run is in progress…</span>
        ) : (
          lines.map((line, i) => {
            const { cls, icon, text } = classifyLog(line);
            return (
              <div key={i} className={'log-line ' + cls}>
                <span className="material-symbols-outlined log-icon">{icon}</span>
                <span className="log-text">{text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
