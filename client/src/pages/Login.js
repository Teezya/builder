/**
 * Login Page
 */
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Sparkles, LogIn } from 'lucide-react';
import useAuth from '../hooks/useAuth';
import { useToast } from '../components/Toast';

export default function Login() {
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const showToast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(email, password);
      navigate('/dashboard');
      showToast('Успешный вход!', 'success');
    } catch (error) {
      showToast(error || 'Ошибка входа', 'error');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <Sparkles size={32} />
          <h1>Вход в аккаунт</h1>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ваш@email.com"
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn-primary btn-large" disabled={loading}>
            <LogIn size={18} />
            {loading ? 'Загрузка...' : 'Войти'}
          </button>
        </form>

        <p className="auth-footer">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
  );
}
