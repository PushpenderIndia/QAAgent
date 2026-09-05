'use client';

const STATUS_META = {
  idle: { icon: 'radio_button_unchecked', cls: '', label: 'IDLE' },
  running: { icon: 'progress_activity', cls: 'badge-running', label: 'RUNNING' },
  pass: { icon: 'check_circle', cls: 'badge-pass', label: 'PASSED' },
  fail: { icon: 'cancel', cls: 'badge-fail', label: 'FAILED' },
  cancelled: { icon: 'block', cls: 'badge-fail', label: 'CANCELLED' },
};

export default function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.idle;
  return (
    <span className={'badge ' + meta.cls}>
      <span className={'material-symbols-outlined' + (status === 'running' ? ' spin' : '')}>
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}
