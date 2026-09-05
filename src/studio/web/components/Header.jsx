'use client';

import StatusBadge from './StatusBadge';

export default function Header({ status }) {
  return (
    <header className="topbar">
      <span className="topbar-eyebrow">Studio session</span>
      <StatusBadge status={status} />
    </header>
  );
}
