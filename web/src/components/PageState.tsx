import React from 'react';
import { AlertIcon, InboxIcon } from './Icons';

interface StateProps {
  title: string;
  message: string;
  children?: React.ReactNode;
}

/** Empty state: what is missing, when it will appear, and a next step. */
export const EmptyState: React.FC<StateProps> = ({ title, message, children }) => (
  <div className="state">
    <span className="state-icon">
      <InboxIcon />
    </span>
    <h2 className="t-heading">{title}</h2>
    <p className="t-small">{message}</p>
    {children && <div className="state-actions">{children}</div>}
  </div>
);

/** Error state: what failed in plain words, plus a way to try again. */
export const ErrorState: React.FC<StateProps> = ({ title, message, children }) => (
  <div className="state" role="alert">
    <span className="state-icon state-icon--error">
      <AlertIcon />
    </span>
    <h2 className="t-heading">{title}</h2>
    <p className="t-small">{message}</p>
    {children && <div className="state-actions">{children}</div>}
  </div>
);

/** Inline error alert with an optional action (dismiss by default). */
export const ErrorAlert: React.FC<{
  message: string;
  onDismiss?: () => void;
  actionLabel?: string;
}> = ({ message, onDismiss, actionLabel = 'Dismiss' }) => (
  <div className="alert alert-error page-alert" role="alert">
    <AlertIcon />
    <span className="alert-body">{message}</span>
    {onDismiss && (
      <button type="button" className="btn btn-quiet btn-sm" onClick={onDismiss}>
        {actionLabel}
      </button>
    )}
  </div>
);
