/**
 * Register Page
 */
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Sparkles, UserPlus } from 'lucide-react';
import useAuth from '../hooks/useAuth';
import { useToast } from '../components/Toast';

export default function Register() {
  const navigate = useNavigate();
  const { register, loading } = useAuth();
  const showToast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const name = fullName || email.split('@')[0];
      await register(email, password, name);
      navigate('/dashboard');
      showToast('Аккаунт создан успешно!', 'success');
    } catch (error) {
      showToast(error || 'Ошибка регистрации', 'error');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <Sparkles size={32} />
          <h1>Создай аккаунт</h1>
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
            <label htmlFor="password">Пароль (минимум 6 символов)</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength="6"
              required
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn-primary btn-large" disabled={loading}>
            <UserPlus size={18} />
            {loading ? 'Загрузка...' : 'Создать аккаунт'}
          </button>
        </form>

        <p className="auth-footer">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </div>
    </div>
  );
}
