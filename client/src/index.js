/**
 * AI Startup Builder - Frontend
 * React App (Single File Architecture)
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { 
  Sparkles, Layout, Database, Server, Code, Download, 
  Trash2, Plus, LogOut, User, ChevronRight, BookOpen, 
  CreditCard, MessageCircle, Users, Zap, Shield, CheckCircle,
  Menu, X, Copy, ExternalLink
} from 'lucide-react';
import './styles.css';

// ==================== CONFIG ====================
const API_URL = 'http://localhost:5000/api';

const parseStoredUser = () => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
};

const API_BASE_URL = process.env.REACT_APP_API_URL || API_URL;

axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

axios.interceptors.response.use(
  response => response,
  error => {
    if (error?.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

const SIDEBAR_ITEMS = [
  { to: '/dashboard', label: 'Проекты', icon: Layout },
  { to: '/generator', label: 'Новый проект', icon: Zap },
  { to: '/profile', label: 'Личный кабинет', icon: User },
];

const SidebarNav = ({ user, usage, onLogout }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isProjectDetailPage = location.pathname.startsWith('/project/');
  const sidebarUser = user || parseStoredUser();
  const sidebarUsage = usage || sidebarUser;
  const fullLimit = Math.max(0, Number(sidebarUsage?.fullAiLimit || 0));
  const fullUsed = Math.max(0, Number(sidebarUsage?.fullAiUsed || 0));
  const fullRemaining = Math.max(0, Number(sidebarUsage?.fullAiRemaining ?? (fullLimit - fullUsed)));

  const handleLogout = () => {
    if (typeof onLogout === 'function') {
      onLogout();
      return;
    }

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/');
  };

  return (
    <aside className="sidebar">
      <div className="logo"><Sparkles size={24} /> AI Builder</div>
      <nav>
        {SIDEBAR_ITEMS.map(item => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/dashboard'}
              className={({ isActive }) => {
                const active = isActive || (item.to === '/dashboard' && isProjectDetailPage);
                return `nav-item${active ? ' active' : ''}`;
              }}
            >
              <Icon size={20} /> {item.label}
            </NavLink>
          );
        })}
      </nav>
      {sidebarUser && (
        <div className="user-section">
          <div className="user-meta">
            <span><User size={16} /> {sidebarUser?.email}</span>
            {sidebarUsage?.plan && (
              <span className="usage-badge">
                {sidebarUsage.plan.toUpperCase()} · {Math.max(0, sidebarUsage.creditsRemaining || 0)} cr
              </span>
            )}
            {fullLimit > 0 && (
              <span className="usage-badge">
                Full AI: {fullLimit} бесплатных, осталось {fullRemaining}
              </span>
            )}
          </div>
          <button onClick={handleLogout} className="btn-icon"><LogOut size={16} /></button>
        </div>
      )}
    </aside>
  );
};

// ==================== COMPONENTS ====================

// Landing Page
const Landing = () => {
  const navigate = useNavigate();
  
  return (
    <div className="landing">
      <nav className="nav">
        <div className="logo"><Sparkles size={28} /> AI Startup Builder</div>
        <div className="nav-links">
          <Link to="/login" className="btn-secondary">Войти</Link>
          <Link to="/register" className="btn-primary">Начать бесплатно</Link>
        </div>
      </nav>
      
      <header className="hero">
        <h1>Преврати идею в работающее приложение за минуты</h1>
        <p>AI Startup Builder генерирует структуру веб и мобильных приложений из текстового описания</p>
        <button onClick={() => navigate('/register')} className="btn-hero">
          Создать проект <ChevronRight size={20} />
        </button>
      </header>

      <section className="features">
        <div className="feature-card">
          <Zap className="icon-bronze" size={40} />
          <h3>Мгновенная генерация</h3>
          <p>Опиши идею — получи готовую структуру приложения сразу</p>
        </div>
        <div className="feature-card">
          <Code className="icon-bronze" size={40} />
          <h3>Чистый код</h3>
          <p>Генерация лучших практик и современных паттернов разработки</p>
        </div>
        <div className="feature-card">
          <Layout className="icon-bronze" size={40} />
          <h3>Полный стек</h3>
          <p>Frontend, Backend и Database схемы в одном месте</p>
        </div>
      </section>

      <section className="how-it-works">
        <h2>Как это работает</h2>
        <div className="steps">
          <div className="step"><span>1</span><p>Опиши свою идею</p></div>
          <div className="step"><span>2</span><p>Выбери технологический стек</p></div>
          <div className="step"><span>3</span><p>Полни готовую структуру</p></div>
          <div className="step"><span>4</span><p>Начни разработку</p></div>
        </div>
      </section>

      <section className="audience">
        <h2>Для кого это</h2>
        <div className="audience-grid">
          <div><Users size={32} /> <h4>Стартаперы</h4><p>Быстрая валидация идей</p></div>
          <div><BookOpen size={32} /> <h4>Студенты</h4><p>Изучение архитектуры приложений</p></div>
          <div><Code size={32} /> <h4>Разработчики</h4><p>Прототипирование MVP</p></div>
        </div>
      </section>

      <footer className="footer">
        <p>© 2024 AI Startup Builder. Дипломный проект.</p>
      </footer>
    </div>
  );
};

// Auth Forms
const Login = () => {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post(`${API_BASE_URL}/auth/login`, form);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка входа');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h2>Вход</h2>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <input type="email" placeholder="Email" required 
            value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
          <input type="password" placeholder="Пароль" required 
            value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
          <button type="submit" className="btn-primary">Войти</button>
        </form>
        <p>Нет аккаунта? <Link to="/register">Зарегистрироваться</Link></p>
      </div>
    </div>
  );
};

const Register = () => {
  const [form, setForm] = useState({ email: '', password: '', referralCode: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post(`${API_BASE_URL}/auth/register`, form);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      if (form.referralCode.trim()) {
        try {
          await axios.post(`${API_BASE_URL}/referrals/apply`, { referralCode: form.referralCode.trim() });
        } catch {
          // Referral is optional and should not block onboarding
        }
      }

      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка регистрации');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h2>Регистрация</h2>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <input type="email" placeholder="Email" required 
            value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
          <input type="password" placeholder="Пароль" required 
            value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
          <input type="text" placeholder="Реферальный код (опционально)"
            value={form.referralCode}
            onChange={e => setForm({...form, referralCode: e.target.value})} />
          <button type="submit" className="btn-primary">Создать аккаунт</button>
        </form>
        <p>Уже есть аккаунт? <Link to="/login">Войти</Link></p>
      </div>
    </div>
  );
};

// Dashboard
const Dashboard = () => {
  const [projects, setProjects] = useState([]);
  const [user, setUser] = useState(null);
  const [usage, setUsage] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const u = parseStoredUser();
    if (!u) return navigate('/login');
    setUser(u);
    loadProjects();
    loadUsage();
  }, []);

  const loadProjects = async () => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/projects`);
      setProjects(data);
    } catch (err) {
      if (err.response?.status === 401) navigate('/login');
    }
  };

  const loadUsage = async () => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/account/usage`);
      setUsage(data);
      localStorage.setItem('user', JSON.stringify({ ...parseStoredUser(), ...data }));
    } catch {
      // usage is optional for backward compatibility
    }
  };

  const deleteProject = async (id) => {
    if (!window.confirm('Удалить проект?')) return;
    await axios.delete(`${API_BASE_URL}/projects/${id}`);
    loadProjects();
  };

  const logout = () => {
    localStorage.clear();
    navigate('/');
  };

  return (
    <div className="dashboard">
      <SidebarNav user={user} usage={usage} onLogout={logout} />

      <main className="main-content">
        <header className="page-header">
          <h1>Мои проекты</h1>
          <Link to="/generator" className="btn-primary"><Plus size={20} /> Новый проект</Link>
        </header>

        {projects.length === 0 ? (
          <div className="empty-state">
            <Layout size={64} className="icon-muted" />
            <h3>Пока нет проектов</h3>
            <p>Создай свой первый проект с помощью ИИ</p>
            <Link to="/generator" className="btn-secondary">Создать проект</Link>
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map(p => (
              <div key={p._id} className="project-card">
                <div className="project-header">
                  <h3>{p.name}</h3>
                  <span className={`status ${p.status}`}>{p.status}</span>
                </div>
                <p className="project-desc">{p.description}</p>
                <div className="project-meta">
                  <span className="stack-badge">{p.stack}</span>
                  <span className="date">{new Date(p.createdAt).toLocaleDateString('ru-RU')}</span>
                </div>
                <div className="project-actions">
                  <Link to={`/project/${p._id}`} className="btn-text">Открыть <ChevronRight size={16} /></Link>
                  <button onClick={() => deleteProject(p._id)} className="btn-icon danger"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

// Generator
const Generator = () => {
  const [form, setForm] = useState({ description: '', stack: 'React + Node.js' });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/projects`, form);
      if (data?.usage) {
        localStorage.setItem('user', JSON.stringify({ ...parseStoredUser(), ...data.usage }));
      }
      if (data?.warning) {
        alert(data.warning);
      }
      navigate(`/project/${data._id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка генерации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <SidebarNav />

      <main className="main-content">
        <div className="generator-page">
          <h1>Генератор проекта</h1>
          <p className="subtitle">Опиши свою идею и выбери технологии</p>
          
          <form onSubmit={handleSubmit} className="generator-form">
            <div className="form-group">
              <label>Описание приложения</label>
              <textarea 
                placeholder="Например: Интернет-магазин одежды с каталогом, корзиной и оплатой..."
                required
                rows={5}
                value={form.description}
                onChange={e => setForm({...form, description: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label>Технологический стек</label>
              <select value={form.stack} onChange={e => setForm({...form, stack: e.target.value})}>
                <option value="React + Node.js">React + Node.js</option>
                <option value="HTML + CSS + JS">HTML + CSS + JS</option>
                <option value="Python + Flask">Python + Flask</option>
                <option value="Vue + Node.js">Vue + Node.js</option>
                <option value="Flutter">Flutter (Mobile)</option>
              </select>
            </div>

            <button type="submit" className="btn-primary btn-large" disabled={loading}>
              {loading ? <><span className="spinner" /> Генерация...</> : <><Sparkles size={20} /> Сгенерировать проект</>}
            </button>
          </form>

          <div className="tips">
            <h4><Zap size={16} /> Советы по описанию:</h4>
            <ul>
              <li>Укажи тип приложения (магазин, блог, соцсеть)</li>
              <li>Опиши ключевые функции</li>
              <li>Упомяни целевую аудиторию</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
};


// Project Details
const ProjectDetail = () => {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [activeTab, setActiveTab] = useState('frontend');
  const [generating, setGenerating] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [aiNotice, setAiNotice] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    loadProject();
  }, [id]);

  const loadProject = async () => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/projects/${id}`);
      setProject(data);
      setPreviewHtml(data.previewHtml || '');
    } catch (err) {
      navigate('/dashboard');
    }
  };

  const generateCode = async () => {
    setGenerating(true);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/projects/${id}/generate-code`);
      setProject({
        ...project,
        generatedCode: {
          frontend: data?.frontend || project?.generatedCode?.frontend,
          backend: data?.backend || project?.generatedCode?.backend,
          database: data?.database || project?.generatedCode?.database,
        },
      });
      if (data?.usage) {
        localStorage.setItem('user', JSON.stringify({ ...parseStoredUser(), ...data.usage }));
      }
      if (data?.warning) {
        setAiNotice(data.warning);
        alert(data.warning);
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка генерации кода');
    } finally {
      setGenerating(false);
    }
  };

  const generatePreview = async () => {
    setPreviewLoading(true);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/projects/${id}/generate-preview`);
      setPreviewHtml(data?.html || '');
      setProject(prev => ({ ...prev, previewHtml: data?.html || prev?.previewHtml }));
      if (data?.usage) {
        localStorage.setItem('user', JSON.stringify({ ...parseStoredUser(), ...data.usage }));
      }
      if (data?.warning) {
        setAiNotice(data.warning);
        alert(data.warning);
      }
      setActiveTab('preview');
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка генерации предпросмотра');
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadProject = async () => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/projects/${id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(project?.name || 'project').replace(/\s+/g, '_')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка скачивания ZIP');
    }
  };

  const downloadPreviewHtml = async () => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/projects/${id}/preview-download`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(project?.name || 'project').replace(/\s+/g, '_')}_preview.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка скачивания HTML примера');
    }
  };

  if (!project) return <div className="loading">Загрузка...</div>;

  const structure = project.structure || {
    pages: [],
    components: [],
    apiRoutes: [],
    databaseSchema: [],
  };

  return (
    <div className="dashboard">
      <SidebarNav />

      <main className="main-content">
        <div className="project-detail">
          {aiNotice && <div className="error" style={{ marginBottom: '1rem' }}>{aiNotice}</div>}
          <header className="detail-header">
            <div>
              <h1>{project.name}</h1>
              <p>{project.description}</p>
              <span className="stack-badge large">{project.stack}</span>
            </div>
            <div className="header-actions">
              <button 
                onClick={generateCode} 
                className="btn-secondary"
                disabled={generating}
              >
                {generating ? <><span className="spinner" /> Генерация...</> : <><Code size={18} /> Сгенерировать код</>}
              </button>
              <button
                onClick={generatePreview}
                className="btn-secondary"
                disabled={previewLoading}
              >
                {previewLoading ? <><span className="spinner" /> Preview...</> : <><ExternalLink size={18} /> Показ сайта</>}
              </button>
              <button onClick={downloadProject} className="btn-primary">
                <Download size={18} /> Скачать ZIP
              </button>
              <button onClick={downloadPreviewHtml} className="btn-secondary">
                <ExternalLink size={18} /> Скачать пример сайта
              </button>
            </div>
          </header>

          <div className="tabs">
            <button className={activeTab === 'frontend' ? 'active' : ''} onClick={() => setActiveTab('frontend')}>
              <Layout size={18} /> Frontend
            </button>
            <button className={activeTab === 'backend' ? 'active' : ''} onClick={() => setActiveTab('backend')}>
              <Server size={18} /> Backend
            </button>
            <button className={activeTab === 'database' ? 'active' : ''} onClick={() => setActiveTab('database')}>
              <Database size={18} /> Database
            </button>
            <button className={activeTab === 'preview' ? 'active' : ''} onClick={() => setActiveTab('preview')}>
              <ExternalLink size={18} /> Preview
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'frontend' && (
              <div className="structure-grid">
                <div className="structure-card">
                  <h3><Layout size={20} /> Страницы</h3>
                  <ul>{structure.pages.map((p, i) => <li key={i}><CheckCircle size={14} /> {p}</li>)}</ul>
                </div>
                <div className="structure-card">
                  <h3><Code size={20} /> Компоненты</h3>
                  <ul>{structure.components.map((c, i) => <li key={i}><CheckCircle size={14} /> {c}</li>)}</ul>
                </div>
                {project.generatedCode?.frontend && (
                  <div className="structure-card full">
                    <h3><Code size={20} /> Сгенерированный код Frontend</h3>
                    <pre className="code-block"><code>{project.generatedCode.frontend}</code></pre>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'backend' && (
              <div className="structure-card full">
                <h3><Server size={20} /> API Маршруты</h3>
                <div className="code-block">
                  {structure.apiRoutes.map((r, i) => (
                    <div key={i} className="code-line"><span className="method">{r.split(' ')[0]}</span> {r.split(' ')[1]}</div>
                  ))}
                </div>
                {project.generatedCode?.backend && (
                  <>
                    <h3 style={{marginTop: '2rem'}}><Code size={20} /> Сгенерированный код Backend</h3>
                    <pre className="code-block"><code>{project.generatedCode.backend}</code></pre>
                  </>
                )}
              </div>
            )}

            {activeTab === 'database' && (
              <div className="structure-card full">
                <h3><Database size={20} /> Схема базы данных</h3>
                <div className="code-block">
                  {structure.databaseSchema.map((s, i) => (
                    <div key={i} className="schema-item">
                      <span className="table-name">{s.split(' ')[0]}</span>
                      <span className="fields">{s.substring(s.indexOf('('))}</span>
                    </div>
                  ))}
                </div>
                {project.generatedCode?.database && (
                  <>
                    <h3 style={{marginTop: '2rem'}}><Code size={20} /> Сгенерированный код Database</h3>
                    <pre className="code-block"><code>{project.generatedCode.database}</code></pre>
                  </>
                )}
              </div>
            )}

            {activeTab === 'preview' && (
              <div className="structure-card full">
                <h3><ExternalLink size={20} /> Примерный показ сайта</h3>
                {!previewHtml ? (
                  <div>
                    <p style={{ marginBottom: '0.75rem' }}>Предпросмотр пока не сгенерирован.</p>
                    <button className="btn-secondary" onClick={generatePreview} disabled={previewLoading}>
                      {previewLoading ? 'Генерация...' : 'Сгенерировать preview'}
                    </button>
                  </div>
                ) : (
                  <iframe
                    title="project-preview"
                    srcDoc={previewHtml}
                    style={{ width: '100%', height: '72vh', border: '1px solid #2a2a2a', borderRadius: '8px' }}
                    sandbox="allow-same-origin allow-scripts"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
// Learning Mode
const Learning = () => (
  <div className="dashboard">
    <SidebarNav />

    <main className="main-content">
      <div className="learning-page">
        <h1>Режим обучения</h1>
        <p>Изучи основы веб-разработки</p>

        <div className="learning-grid">
          <div className="learn-card">
            <Layout size={40} className="icon-green" />
            <h3>Frontend</h3>
            <p>Клиентская часть приложения — то, что видит пользователь. Включает HTML, CSS, JavaScript и фреймворки вроде React или Vue.</p>
          </div>
          <div className="learn-card">
            <Server size={40} className="icon-bronze" />
            <h3>Backend</h3>
            <p>Серверная логика — обработка данных, аутентификация, бизнес-логика. Node.js, Python, базы данных.</p>
          </div>
          <div className="learn-card">
            <Database size={40} className="icon-green" />
            <h3>Database</h3>
            <p>Хранилище данных. SQL (PostgreSQL, MySQL) или NoSQL (MongoDB) базы для сохранения информации пользователей и контента.</p>
          </div>
          <div className="learn-card">
            <Code size={40} className="icon-bronze" />
            <h3>Full Stack</h3>
            <p>Разработка всех уровней приложения — от базы данных до пользовательского интерфейса.</p>
          </div>
        </div>
      </div>
    </main>
  </div>
);

// Integrations (Mock)
const Integrations = () => (
  <div className="dashboard">
    <SidebarNav />

    <main className="main-content">
      <div className="integrations-page">
        <h1>Интеграции</h1>
        <p>Подключи дополнительные сервисы к своему проекту</p>

        <div className="integrations-grid">
          <div className="integration-card">
            <CreditCard size={40} />
            <h3>Stripe</h3>
            <p>Платежная система для приема онлайн-платежей</p>
            <button className="btn-secondary">Подключить</button>
          </div>
          <div className="integration-card">
            <MessageCircle size={40} />
            <h3>Telegram Bot</h3>
            <p>Уведомления и управление через Telegram</p>
            <button className="btn-secondary">Подключить</button>
          </div>
          <div className="integration-card">
            <Users size={40} />
            <h3>CRM</h3>
            <p>Интеграция с системами управления клиентами</p>
            <button className="btn-secondary">Подключить</button>
          </div>
        </div>
      </div>
    </main>
  </div>
);

const Billing = () => {
  const [activeTab, setActiveTab] = useState(window.location.pathname === '/billing' ? 'billing' : 'overview');
  const [profile, setProfile] = useState(null);
  const [plans, setPlans] = useState([]);
  const [billingHistory, setBillingHistory] = useState([]);
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processingPlan, setProcessingPlan] = useState('');
  const [processingPayment, setProcessingPayment] = useState(false);
  const [selectedPlanForPayment, setSelectedPlanForPayment] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    cardNumber: '4242 4242 4242 4242',
    cardHolder: '',
    expiry: '12/30',
    cvc: '123',
  });
  const [feedback, setFeedback] = useState('');

  const loadAccount = async () => {
    try {
      setLoading(true);
      const [profileRes, subscriptionRes, plansRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/account/profile`).catch(async (err) => {
          if (err.response?.status === 404) {
            return axios.get(`${API_BASE_URL}/account/usage`);
          }
          throw err;
        }),
        axios.get(`${API_BASE_URL}/account/subscription`),
        axios.get(`${API_BASE_URL}/plans`),
      ]);

      const merged = {
        ...(profileRes?.data || {}),
        ...(subscriptionRes?.data?.user || {}),
      };

      setProfile(merged);
      setFullName(merged.fullName || '');
      setPlans(Array.isArray(plansRes?.data) ? plansRes.data : []);
      setBillingHistory(Array.isArray(subscriptionRes?.data?.billingHistory) ? subscriptionRes.data.billingHistory : []);
      localStorage.setItem('user', JSON.stringify({ ...parseStoredUser(), ...merged }));
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Не удалось загрузить личный кабинет');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccount();
  }, []);

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    if (!fullName.trim()) {
      setFeedback('Введите имя');
      return;
    }

    try {
      setSaving(true);
      const { data } = await axios.patch(`${API_BASE_URL}/account/profile`, { fullName: fullName.trim() });
      setProfile(data.user);
      localStorage.setItem('user', JSON.stringify({ ...parseStoredUser(), ...data.user }));
      setFeedback('Профиль обновлен');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Ошибка сохранения профиля');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckout = async (planCode) => {
    try {
      setProcessingPlan(planCode);
      const { data } = await axios.post(`${API_BASE_URL}/account/subscription/checkout`, { plan: planCode });
      setProfile(data.user);
      setBillingHistory(Array.isArray(data.billingHistory) ? data.billingHistory : []);
      localStorage.setItem('user', JSON.stringify({ ...parseStoredUser(), ...data.user }));
      setFeedback(data.message || 'Подписка обновлена');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Не удалось обновить подписку');
    } finally {
      setProcessingPlan('');
    }
  };

  const openPaymentSimulation = (plan) => {
    if (!plan) {
      return;
    }

    if (plan.code === 'free') {
      handleCheckout('free');
      return;
    }

    setSelectedPlanForPayment(plan);
    setPaymentForm(prev => ({
      ...prev,
      cardHolder: fullName || prev.cardHolder,
    }));
    setFeedback('');
  };

  const closePaymentSimulation = () => {
    if (processingPayment) {
      return;
    }

    setSelectedPlanForPayment(null);
  };

  const submitPaymentSimulation = async (event) => {
    event.preventDefault();
    if (!selectedPlanForPayment) {
      return;
    }

    if (!paymentForm.cardHolder.trim()) {
      setFeedback('Введите имя владельца карты для демо-оплаты');
      return;
    }

    if (paymentForm.cardNumber.replace(/\D/g, '').length < 16) {
      setFeedback('Введите корректный номер карты (16 цифр)');
      return;
    }

    if (!/^\d{2}\/\d{2}$/.test(paymentForm.expiry)) {
      setFeedback('Введите срок действия в формате MM/YY');
      return;
    }

    if (paymentForm.cvc.replace(/\D/g, '').length < 3) {
      setFeedback('Введите корректный CVC');
      return;
    }

    setProcessingPayment(true);
    setFeedback('Имитация оплаты... подтверждаем платеж');

    try {
      await new Promise(resolve => setTimeout(resolve, 1200));

      const sanitizedCard = paymentForm.cardNumber.replace(/\D/g, '');
      if (sanitizedCard === '4000000000000002') {
        throw new Error('Тестовая карта отклонена банком');
      }

      await handleCheckout(selectedPlanForPayment.code);
      setSelectedPlanForPayment(null);
      setFeedback(`Оплата имитирована: тариф ${selectedPlanForPayment.name} активирован`);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Имитация оплаты не удалась');
    } finally {
      setProcessingPayment(false);
    }
  };

  const setCardNumber = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 16);
    const chunks = digits.match(/.{1,4}/g) || [];
    setPaymentForm(prev => ({ ...prev, cardNumber: chunks.join(' ') }));
  };

  const setExpiry = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) {
      setPaymentForm(prev => ({ ...prev, expiry: digits }));
      return;
    }

    setPaymentForm(prev => ({ ...prev, expiry: `${digits.slice(0, 2)}/${digits.slice(2)}` }));
  };

  const setCvc = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    setPaymentForm(prev => ({ ...prev, cvc: digits }));
  };

  const applyTestCard = (type) => {
    if (type === 'success') {
      setPaymentForm(prev => ({
        ...prev,
        cardNumber: '4242 4242 4242 4242',
        expiry: '12/30',
        cvc: '123',
      }));
      return;
    }

    setPaymentForm(prev => ({
      ...prev,
      cardNumber: '4000 0000 0000 0002',
      expiry: '12/30',
      cvc: '123',
    }));
  };

  const usagePercent = (() => {
    const used = Number(profile?.creditsUsed || 0);
    const limit = Number(profile?.creditsLimit || 0);
    if (!limit) return 0;
    return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
  })();

  const fullUsed = Math.max(0, Number(profile?.fullAiUsed || 0));
  const fullLimit = Math.max(0, Number(profile?.fullAiLimit || 0));
  const fullRemaining = Math.max(0, Number(profile?.fullAiRemaining ?? (fullLimit - fullUsed)));
  const fullUsagePercent = fullLimit > 0
    ? Math.min(100, Math.max(0, Math.round((fullUsed / fullLimit) * 100)))
    : 0;
  const showFullUsage = fullLimit > 0;
  const subscribePrompt = profile?.subscribePrompt || '';

  if (loading) {
    return (
      <div className="dashboard">
        <SidebarNav />
        <main className="main-content"><p>Загрузка личного кабинета...</p></main>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <SidebarNav />

      <main className="main-content">
        <div className="account-page account-hub">
          <section className="account-hero account-card">
            <div className="account-hero-main">
              <div className="account-avatar">{(fullName || profile?.email || 'U').slice(0, 1).toUpperCase()}</div>
              <div>
                <h1>Личный кабинет</h1>
                <p className="subtitle">Управление профилем, подпиской и токенами.</p>
              </div>
            </div>
          </section>

          <section className="account-tabs">
            <button type="button" className={`account-tab-btn${activeTab === 'overview' ? ' active' : ''}`} onClick={() => setActiveTab('overview')}>
              <User size={16} /> Профиль
            </button>
            <button type="button" className={`account-tab-btn${activeTab === 'billing' ? ' active' : ''}`} onClick={() => setActiveTab('billing')}>
              <CreditCard size={16} /> Подписка
            </button>
          </section>

          {subscribePrompt && (
            <div className="error" style={{ marginTop: '0.25rem' }}>
              {subscribePrompt}
            </div>
          )}

          {activeTab === 'overview' && (
            <section className="account-overview-grid">
              <form onSubmit={handleSaveProfile} className="account-card">
                <h2>Профиль</h2>
                <div className="form-group">
                  <label>Имя</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={profile?.email || ''} disabled />
                </div>
                <div className="profile-grid">
                  <div className="profile-stat"><span>План</span><strong>{String(profile?.plan || 'free').toUpperCase()}</strong></div>
                  <div className="profile-stat"><span>AI режим</span><strong>{profile?.aiMode === 'lite' ? 'LITE' : 'FULL'}</strong></div>
                  <div className="profile-stat"><span>Токенов осталось</span><strong>{Math.max(0, Number(profile?.creditsRemaining || 0))}</strong></div>
                  <div className="profile-stat"><span>Full AI попытки</span><strong>{showFullUsage ? `${fullUsed}/${fullLimit}` : '-'}</strong></div>
                  <div className="profile-stat"><span>Рефкод</span><strong>{profile?.referralCode || '-'}</strong></div>
                </div>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Сохранение...' : 'Сохранить профиль'}</button>
              </form>

              <div className="account-card account-side-card">
                <h2>Использование токенов</h2>
                <div className="usage-meter">
                  <div className="usage-meter-row">
                    <span>{Math.max(0, Number(profile?.creditsUsed || 0))} / {Math.max(0, Number(profile?.creditsLimit || 0))}</span>
                    <strong>{usagePercent}%</strong>
                  </div>
                  <div className="usage-meter-track">
                    <div className="usage-meter-fill" style={{ width: `${usagePercent}%` }} />
                  </div>
                </div>
                {showFullUsage && (
                  <div className="usage-meter" style={{ marginTop: '1rem' }}>
                    <div className="usage-meter-row">
                      <span>Full AI: {fullUsed} / {fullLimit} (осталось {fullRemaining})</span>
                      <strong>{fullUsagePercent}%</strong>
                    </div>
                    <div className="usage-meter-track">
                      <div className="usage-meter-fill" style={{ width: `${fullUsagePercent}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'billing' && (
            <section>
              <div className="account-card billing-summary-corp">
                <div>
                  <p className="billing-label">Current plan</p>
                  <h2>{String(profile?.plan || 'free').toUpperCase()}</h2>
                  <p className="subtitle">{profile?.subscriptionStatus === 'active' ? 'Подписка активна' : 'Подписка не активна'}</p>
                </div>
                <div className="billing-summary-stats">
                  <div className="profile-stat"><span>Лимит токенов</span><strong>{Math.max(0, Number(profile?.creditsLimit || 0))}</strong></div>
                  <div className="profile-stat"><span>Остаток</span><strong>{Math.max(0, Number(profile?.creditsRemaining || 0))}</strong></div>
                  <div className="profile-stat"><span>AI режим</span><strong>{profile?.aiMode === 'lite' ? 'LITE' : 'FULL'}</strong></div>
                </div>
              </div>

              <div className="plans-grid plans-grid-corp">
                {plans.map(plan => {
                  const isCurrent = profile?.plan === plan.code;
                  const isProcessing = processingPlan === plan.code;
                  const isPriority = plan.code === 'business' || plan.code === 'enterprise';

                  return (
                    <article className={`plan-card${isCurrent ? ' active' : ''}${isPriority ? ' highlighted' : ''}`} key={plan.code}>
                      <div className="plan-head">
                        <h3>{plan.name}</h3>
                        {isPriority && <span className="plan-chip">Corporate</span>}
                      </div>
                      <p className="plan-price">{plan.monthlyPrice === null ? 'По запросу' : `$${plan.monthlyPrice}/мес`}</p>
                      <p className="plan-credits">{plan.creditsLimit} токенов / цикл</p>
                      <button className={isCurrent ? 'btn-secondary' : 'btn-primary'} disabled={isCurrent || isProcessing || processingPayment} onClick={() => openPaymentSimulation(plan)}>
                        {isCurrent ? 'Текущий тариф' : isProcessing ? 'Обновление...' : (plan.code === 'free' ? 'Перейти на free' : 'Оплатить (демо)')}
                      </button>
                    </article>
                  );
                })}
              </div>

              <div className="account-card">
                <h2>История биллинга</h2>
                {!billingHistory.length ? (
                  <p className="subtitle">Транзакций пока нет.</p>
                ) : (
                  <div className="billing-history-list">
                    {billingHistory.slice().reverse().slice(0, 8).map((entry, idx) => (
                      <div className="billing-history-row" key={entry.id || `${entry.plan}-${entry.createdAt || idx}`}>
                        <div>
                          <strong>{String(entry.plan || 'plan').toUpperCase()}</strong>
                          <p>{new Date(entry.createdAt || Date.now()).toLocaleString('ru-RU')}</p>
                        </div>
                        <div className="billing-history-right">
                          <span>{Number(entry.amount || 0)} USD</span>
                          <span className="billing-status">{entry.status || 'paid'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {feedback && <div className="error">{feedback}</div>}
        </div>

        {selectedPlanForPayment && (
          <div className="modal-overlay" onClick={closePaymentSimulation}>
            <div className="modal-card payment-modal-card" onClick={(event) => event.stopPropagation()}>
              <div className="payment-modal-head">
                <div>
                  <h3 className="modal-title">Имитация оплаты</h3>
                  <p className="modal-message">Тариф: {selectedPlanForPayment.name} {selectedPlanForPayment.monthlyPrice === null ? '' : `- $${selectedPlanForPayment.monthlyPrice}/мес`}</p>
                </div>
                <button type="button" className="btn-icon" onClick={closePaymentSimulation} disabled={processingPayment}>
                  <X size={16} />
                </button>
              </div>

              <div className="payment-test-cards">
                <button type="button" className="modal-btn modal-btn-confirm" onClick={() => applyTestCard('success')} disabled={processingPayment}>
                  Тест: успешная
                </button>
                <button type="button" className="modal-btn modal-btn-cancel" onClick={() => applyTestCard('decline')} disabled={processingPayment}>
                  Тест: отклонение
                </button>
              </div>

              <form onSubmit={submitPaymentSimulation} className="payment-form-grid">
                <div className="form-group payment-field-full">
                  <label>Номер карты</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={paymentForm.cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="4242 4242 4242 4242"
                    required
                  />
                </div>

                <div className="form-group payment-field-full">
                  <label>Имя владельца</label>
                  <input
                    type="text"
                    value={paymentForm.cardHolder}
                    onChange={(e) => setPaymentForm({ ...paymentForm, cardHolder: e.target.value.toUpperCase() })}
                    placeholder="IVAN IVANOV"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Срок (MM/YY)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={paymentForm.expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    placeholder="12/30"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>CVC</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={paymentForm.cvc}
                    onChange={(e) => setCvc(e.target.value)}
                    placeholder="123"
                    required
                  />
                </div>

                <div className="modal-actions payment-modal-actions payment-field-full">
                  <button type="button" className="modal-btn modal-btn-cancel" onClick={closePaymentSimulation} disabled={processingPayment}>
                    Отмена
                  </button>
                  <button type="submit" className="modal-btn modal-btn-confirm" disabled={processingPayment || !!processingPlan}>
                    {processingPayment ? 'Подтверждение...' : `Оплатить ${selectedPlanForPayment.monthlyPrice === null ? '' : `$${selectedPlanForPayment.monthlyPrice}`}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

// App Router
const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/generator" element={<Generator />} />
      <Route path="/project/:id" element={<ProjectDetail />} />
      <Route path="/learning" element={<Learning />} />
      <Route path="/profile" element={<Billing />} />
      <Route path="/billing" element={<Billing />} />
      <Route path="/integrations" element={<Integrations />} />
    </Routes>
  </BrowserRouter>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);