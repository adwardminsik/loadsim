import React, { useEffect, useRef } from 'react';

/** 확인/취소 팝업. 위험한 동작(삭제 등)은 취소에 먼저 포커스가 갑니다. */
export default function ConfirmModal({ title, children, confirmLabel = '확인', busyLabel, busy = false, danger = false, onConfirm, onCancel }) {
  const cancelBtn = useRef(null);
  useEffect(() => {
    cancelBtn.current?.focus();
    const onKey = (e) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);
  return (
    <div className="modal-back" onClick={() => !busy && onCancel()}>
      <div className={`modal${danger ? ' danger' : ''}`} role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button ref={cancelBtn} className="btn ghost" onClick={onCancel} disabled={busy}>취소</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel || '처리 중…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
