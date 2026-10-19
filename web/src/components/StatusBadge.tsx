import React from 'react';

export type RunStatus = 'success' | 'failed' | 'running' | 'pending';

const BADGES: Record<RunStatus, { className: string; label: string }> = {
  success: { className: 'badge-success', label: 'Success' },
  failed: { className: 'badge-error', label: 'Failed' },
  running: { className: 'badge-info', label: 'Running' },
  pending: { className: 'badge-neutral', label: 'Pending' },
};

/** Run status as a dot plus a word, never color alone. */
const StatusBadge: React.FC<{ status: RunStatus }> = ({ status }) => {
  const badge = BADGES[status] ?? BADGES.pending;
  return <span className={`badge ${badge.className}`}>{badge.label}</span>;
};

export default StatusBadge;
