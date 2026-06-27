/**
 * Toast Notification System
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';

let _toastDispatch = null;

export function useToast() {
  return useCallback((message, type = 'error') => {
    if (_toastDispatch) _toastDispatch({ message, type });
  }, []);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  useEffect(() => {
    _toastDispatch = ({ message, type = 'error', duration = 4000 }) => {
      const id = ++counter.current;
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    };
    return () => { _toastDispatch = null; };
  }, []);

  const icons = { 
    error: <AlertTriangle size={16} />, 
    success: <CheckCircle size={16} />, 
    info: <Info size={16} /> 
  };

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">{icons[t.type] || icons.info}</span>
          <span className="toast-text">{t.message}</span>
          <button 
            className="toast-close" 
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
