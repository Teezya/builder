/**
 * AI Startup Builder - React Entry Point
 * Оптимизированный для production
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ToastContainer from './components/Toast';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
    <ToastContainer />
  </React.StrictMode>
);

// Service Worker для offline support (опционально)
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then(reg => console.log('✅ Service Worker registered'))
      .catch(err => console.log('Service Worker registration failed:', err));
  });
}
