/**
 * Custom Hook - useAuth
 * Управление состоянием аутентификации
 */
import { useState, useCallback, useEffect } from 'react';
import { api } from '../utils/api';

export default function useAuth() {
  const [user, setUser] = useState(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (!token || !savedUser) {
      return null;
    }

    try {
      return JSON.parse(savedUser);
    } catch {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Синхронизация состояния между вкладками браузера
  useEffect(() => {
    const onStorage = () => {
      const token = localStorage.getItem('token');
      const savedUser = localStorage.getItem('user');

      if (!token || !savedUser) {
        setUser(null);
        return;
      }

      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const register = useCallback(async (email, password, fullName) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.register(email, password, fullName);
      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));
      setUser(response.user);
      return response.user;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.login(email, password);
      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));
      setUser(response.user);
      return response.user;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    api.clearCache();
  }, []);

  return { user, loading, error, register, login, logout, isAuthenticated: !!user };
}
