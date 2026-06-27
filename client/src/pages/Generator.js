import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Layout, Zap, BookOpen } from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';

export default function Generator() {
  const [form, setForm] = useState({ description: '', template: 'blank' });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const showToast = useToast();

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.description.trim()) {
      showToast('Добавьте описание проекта', 'error');
      return;
    }

    setLoading(true);
    try {
      const project = await api.createProject(form.description.trim(), form.template);
      if (project?.usage) {
        localStorage.setItem('user', JSON.stringify(project.usage));
      }
      if (project?.warning) {
        showToast(project.warning, 'info');
      }
      showToast('Проект создан', 'success');
      navigate(`/project/${project.id}`);
    } catch (error) {
      showToast(error?.message || error || 'Ошибка генерации проекта', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="logo"><Sparkles size={24} /> AI Builder</div>
        <nav>
          <Link to="/dashboard" className="nav-item"><Layout size={20} /> Проекты</Link>
          <Link to="/generator" className="nav-item active"><Zap size={20} /> Новый проект</Link>
          <Link to="/learning" className="nav-item"><BookOpen size={20} /> Обучение</Link>
        </nav>
      </aside>

      <main className="main-content">
        <div className="generator-page">
          <h1>Генератор проекта</h1>
          <p className="subtitle">Опишите идею и получите структуру продукта</p>

          <form onSubmit={handleSubmit} className="generator-form">
            <div className="form-group">
              <label>Описание приложения</label>
              <textarea
                placeholder="Например: Маркетплейс для автоуслуг с рейтингами и бронированием"
                required
                rows={5}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Шаблон</label>
              <select
                value={form.template}
                onChange={(e) => setForm({ ...form, template: e.target.value })}
              >
                <option value="blank">Blank</option>
                <option value="ecommerce">E-commerce</option>
                <option value="blog">Blog</option>
                <option value="dashboard">Dashboard</option>
              </select>
            </div>

            <button type="submit" className="btn-primary btn-large" disabled={loading}>
              {loading ? 'Генерация...' : 'Создать проект'}
            </button>
          </form>

          <div className="tips">
            <h4><Zap size={16} /> Советы:</h4>
            <ul>
              <li>Опишите ценность продукта в одном предложении.</li>
              <li>Добавьте ключевые пользовательские сценарии.</li>
              <li>Укажите важные интеграции и ограничения.</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
