/**
 * Modal Component - Подтверждение действий
 */
import React, { useEffect } from 'react';
import { Trash2, X } from 'lucide-react';

export default function ConfirmModal({ 
  isOpen, 
  title, 
  message, 
  confirmLabel = 'Удалить', 
  cancelLabel = 'Отмена', 
  danger = false, 
  onConfirm, 
  onCancel 
}) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        {danger && (
          <div className="modal-icon-wrap modal-icon-danger">
            <Trash2 size={22} />
          </div>
        )}
        <div className="modal-body">
          <h3 className="modal-title">{title}</h3>
          {message && <p className="modal-message">{message}</p>}
        </div>
        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onCancel}>{cancelLabel}</button>
          <button className={`modal-btn ${danger ? 'modal-btn-danger' : 'modal-btn-confirm'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
