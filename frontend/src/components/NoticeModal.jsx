import React, { useEffect, useRef } from 'react';

/** 확인 버튼 하나짜리 알림 팝업 */
export default function NoticeModal({ title, children, onClose }) {
  const btn = useRef(null);
  useEffect(() => {
    btn.current?.focus();
    const onKey = (e) => (e.key === 'Escape' || e.key === 'Enter') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{children}</p>
        <div className="modal-actions">
          <button ref={btn} className="btn primary" onClick={onClose}>확인</button>
        </div>
      </div>
    </div>
  );
}
