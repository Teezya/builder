/**
 * 404 - Not Found Page
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="not-found-page">
      <AlertTriangle size={64} />
      <h1>404 - Страница не найдена</h1>
      <p>К сожалению, страница которую вы ищете не существует</p>
      <Link to="/" className="btn-primary">На главную</Link>
    </div>
  );
}
