'use client';

export default function RecentRuns({ runs, onSelect, collapsed, onToggleCollapse }) {
  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
      <div className="sidebar-head">
        <div className="brand">
          <span className="clay-chip clay-chip-primary clay-chip-lg brand-mark">
            <span className="material-symbols-outlined">science</span>
          </span>
          <div className="brand-copy">
            <h1>QAAgent Studio</h1>
            <p>Plain-English browser testing</p>
          </div>
        </div>
        <button
          type="button"
          className="collapse-btn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="material-symbols-outlined">{collapsed ? 'chevron_right' : 'chevron_left'}</span>
        </button>
      </div>

      <h2 className="sidebar-eyebrow">Recent runs</h2>
      <div id="runsList" className="runs-list">
        {runs.map((r) => (
          <div key={r.id} className="run-item" onClick={() => onSelect(r)} title={r.prompt}>
            <span className={'run-dot ' + r.status} />
            <span className="run-prompt">{r.prompt}</span>
          </div>
        ))}
      </div>
      {runs.length === 0 && (
        <p id="emptyHint" className="empty-hint">
          Runs you start will show up here. Nothing yet — try one below.
        </p>
      )}
    </aside>
  );
}
