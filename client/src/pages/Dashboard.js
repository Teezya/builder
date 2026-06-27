/**
 * Dashboard Page - Центр продукта
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Plus,
  Trash2,
  Download,
  LogOut,
  FolderOpen,
  Clock3,
  TrendingUp,
} from 'lucide-react';
import useAuth from '../hooks/useAuth';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import Loading from '../components/Loading';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const showToast = useToast();

  const [projects, setProjects] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, projectId: null });

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getProjects();
      setProjects(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast(error || 'Ошибка загрузки проектов', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const fetchUsage = useCallback(async () => {
    try {
      const data = await api.getAccountUsage();
      setUsage(data);
      localStorage.setItem('user', JSON.stringify(data));
    } catch {
      // usage is optional for backward compatibility
    }
  }, []);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    fetchProjects();
    fetchUsage();
  }, [user, navigate, fetchProjects, fetchUsage]);

  const stats = useMemo(() => {
    const total = projects.length;
    const drafts = projects.filter((p) => p.status === 'draft').length;
    const completed = projects.filter((p) => p.status === 'completed').length;

    return { total, drafts, completed };
  }, [projects]);

  const recentProjects = useMemo(() => {
    return [...projects]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
      .slice(0, 5);
  }, [projects]);

  const handleCreateProject = async (event) => {
    event.preventDefault();

    if (!description.trim()) {
      showToast('Опишите идею проекта, чтобы начать', 'error');
      return;
    }

    try {
      setIsCreating(true);
      const newProject = await api.createProject(description.trim());
      setProjects((prev) => [newProject, ...prev]);
      setDescription('');
      if (newProject?.usage) {
        setUsage(newProject.usage);
        localStorage.setItem('user', JSON.stringify(newProject.usage));
      }
      if (newProject?.warning) {
        showToast(newProject.warning, 'info');
      }
      showToast('Проект создан', 'success');
      navigate(`/projects/${newProject.id}`);
    } catch (error) {
      showToast(error?.message || error || 'Ошибка создания проекта', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (projectId) => {
    try {
      await api.deleteProject(projectId);
      setProjects((prev) => prev.filter((project) => project.id !== projectId));
      setDeleteModal({ open: false, projectId: null });
      showToast('Проект удален', 'success');
    } catch (error) {
      showToast(error || 'Ошибка удаления проекта', 'error');
    }
  };

  const handleDownloadProject = async (projectId) => {
    try {
      const blob = await api.downloadProject(projectId);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `project-${projectId}.zip`;
      anchor.click();
      window.URL.revokeObjectURL(url);
      showToast('Архив проекта готов', 'success');
    } catch (error) {
      showToast(error || 'Ошибка скачивания', 'error');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  if (loading) return <Loading />;

  return (
    <div className="dashboard-page">
      <nav className="nav">
        <div className="logo">
          <Sparkles size={24} />
          AI Startup Builder
        </div>

        <div className="nav-actions">
          <span className="dashboard-user">{user?.fullName || user?.email}</span>
          <Link to="/profile" className="btn-secondary">Личный кабинет</Link>
          <Link to="/profile?tab=billing" className="btn-secondary">Подписка</Link>
          <button className="btn-secondary" onClick={handleLogout}>
            <LogOut size={16} />
            Выход
          </button>
        </div>
      </nav>

      <main className="dashboard-main">
        <section className="dashboard-hero">
          <h1>Ваш рабочий центр</h1>
          <p>Создавайте и улучшайте продукты быстрее: идея, структура, экспорт в один поток.</p>
          <div className="dashboard-quick-links">
            <Link to="/generator" className="btn-secondary">Новый проект</Link>
            <Link to="/learning" className="btn-secondary">Обучение</Link>
            <Link to="/integrations" className="btn-secondary">Интеграции</Link>
            <Link to="/profile?tab=billing" className="btn-secondary">Тарифы</Link>
          </div>
        </section>

        <section className="dashboard-stats-grid">
          <article className="dashboard-stat-card">
            <FolderOpen size={18} />
            <div>
              <p>Всего проектов</p>
              <strong>{stats.total}</strong>
            </div>
          </article>

          <article className="dashboard-stat-card">
            <Clock3 size={18} />
            <div>
              <p>Черновики</p>
              <strong>{stats.drafts}</strong>
            </div>
          </article>

          <article className="dashboard-stat-card">
            <TrendingUp size={18} />
            <div>
              <p>Завершенные</p>
              <strong>{stats.completed}</strong>
            </div>
          </article>

          <article className="dashboard-stat-card">
            <TrendingUp size={18} />
            <div>
              <p>Токены</p>
              <strong>{Math.max(0, Number(usage?.creditsRemaining ?? user?.creditsRemaining ?? 0))}</strong>
            </div>
          </article>
        </section>

        <section className="dashboard-create-card">
          <h2>Что делать дальше</h2>
          <p>Опишите новую идею и получите проект за минуту.</p>

          <form onSubmit={handleCreateProject} className="create-form">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Пример: SaaS для планирования контента с AI-ассистентом, командной работой и аналитикой"
              disabled={isCreating}
            />

            <button type="submit" className="btn-primary" disabled={isCreating}>
              <Plus size={18} />
              {isCreating ? 'Создание...' : 'Создать проект'}
            </button>
          </form>
        </section>

        <section className="projects-section">
          <div className="projects-section-header">
            <h2>Последние проекты</h2>
            <span>{projects.length} всего</span>
          </div>

          {recentProjects.length === 0 ? (
            <div className="empty-state">
              <p>Проектов пока нет. Начните с первой идеи выше.</p>
            </div>
          ) : (
            <div className="projects-grid-new">
              {recentProjects.map((project) => (
                <article key={project.id} className="project-card-new">
                  <Link to={`/project/${project.id}`} className="project-card-link">
                    <h3>{project.name}</h3>
                    <p>{project.description}</p>
                    <span className="project-status-badge">{project.status || 'draft'}</span>
                  </Link>

                  <div className="project-actions-row">
                    <button
                      className="btn-icon"
                      onClick={() => handleDownloadProject(project.id)}
                      title="Скачать"
                    >
                      <Download size={16} />
                    </button>

                    <button
                      className="btn-icon btn-danger"
                      onClick={() => setDeleteModal({ open: true, projectId: project.id })}
                      title="Удалить"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <ConfirmModal
        isOpen={deleteModal.open}
        title="Удалить проект?"
        message="Действие нельзя отменить."
        danger
        onConfirm={() => handleDeleteProject(deleteModal.projectId)}
        onCancel={() => setDeleteModal({ open: false, projectId: null })}
      />
    </div>
  );
}
