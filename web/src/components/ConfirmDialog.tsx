import React, { useEffect, useRef } from 'react';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation on a native <dialog>: focus stays inside, Escape and the backdrop cancel. */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="confirm-dialog-content">
        <h2 id="confirm-dialog-title" className="t-heading">
          {title}
        </h2>
        <p className="t-body">{message}</p>
        <div className="confirm-dialog-footer">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            {cancelText}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} autoFocus>
            {confirmText}
          </button>
        </div>
      </div>
    </dialog>
  );
};

export default ConfirmDialog;
