/**
 * Loading Component - Спиннер загрузки
 */
import React from 'react';

export default function Loading() {
  return (
    <div className="loading-container">
      <div className="spinner"></div>
      <p>Загрузка...</p>
    </div>
  );
}
