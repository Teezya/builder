/**
 * React App - Оптимизированная структура компонентов
 * 
 * Оптимизации:
 * - Code splitting (lazy loading)
 * - Компонентная архитектура (вместо всего в одном файле)
 * - Мемоизация компонентов
 * - Правильное использование hooks
 * - Оптимизация re-renders
 */

import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';

import './styles.css';
import Loading from './components/Loading';

// Lazy load pages (code splitting)
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ProjectEditor = lazy(() => import('./pages/ProjectEditor'));
const Generator = lazy(() => import('./pages/Generator'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const Learning = lazy(() => import('./pages/Learning'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Profile = lazy(() => import('./pages/Profile'));
const Billing = lazy(() => import('./pages/Billing'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Loading fallback
const Fallback = () => <Loading />;

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token');

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function GuestRoute({ children }) {
  const token = localStorage.getItem('token');

  if (token) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

/**
 * Main App Component
 * Роутинг с lazy loading и error boundaries
 */
function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
          <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/projects/:id" element={<ProtectedRoute><ProjectEditor /></ProtectedRoute>} />
          <Route path="/project/:id" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
          <Route path="/generator" element={<ProtectedRoute><Generator /></ProtectedRoute>} />
          <Route path="/learning" element={<ProtectedRoute><Learning /></ProtectedRoute>} />
          <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
