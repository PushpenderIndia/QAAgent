'use client';

import StatusBadge from './StatusBadge';

export default function Header({ status, onOpenSettings }) {
  return (
    <header className="topbar">
      <span className="topbar-eyebrow">Studio session</span>
      <div className="topbar-actions">
        <button type="button" className="btn-icon" onClick={onOpenSettings} aria-label="Open settings">
          <span className="material-symbols-outlined">settings</span>
        </button>
        <StatusBadge status={status} />
      </div>
    </header>
  );
}
