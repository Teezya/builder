import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Sparkles, Layout, Database, Server, Code, Download, Zap, User, CreditCard } from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';
import Loading from '../components/Loading';

function fallbackStructure(project) {
  const name = project?.name || 'Проект';
  return {
    pages: ['Landing', 'Dashboard', 'Profile', 'Settings'],
    components: ['Header', 'Hero', 'FeatureCard', 'Footer'],
    apiRoutes: ['GET /api/health', 'GET /api/projects', 'POST /api/projects'],
    databaseSchema: [`projects (id, userId, name, description, status)`],
    fileTree: ['client/src/App.js', 'client/src/styles.css', 'server.js'],
    summary: `${name}: базовая структура приложения с панелью управления и API.`,
  };
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('frontend');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const loadProject = async () => {
      try {
        setLoading(true);
        const data = await api.getProject(id);
        setProject(data);
      } catch (error) {
        showToast(error || 'Проект не найден', 'error');
        navigate('/dashboard');
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [id, navigate, showToast]);

  const structure = useMemo(() => {
    if (!project) return fallbackStructure(null);
    return project.structure || fallbackStructure(project);
  }, [project]);

  const generateCode = async () => {
    try {
      setGenerating(true);
      const generated = await api.generateCode(id, project);
      setProject((prev) => ({
        ...prev,
        generatedCode: {
          frontend: generated?.frontend || prev?.generatedCode?.frontend || '',
          backend: generated?.backend || prev?.generatedCode?.backend || '',
          database: generated?.database || prev?.generatedCode?.database || '',
        },
        aiModeUsed: generated?.aiMode || prev?.aiModeUsed,
      }));
      if (generated?.usage) {
        localStorage.setItem('user', JSON.stringify(generated.usage));
      }
      if (generated?.warning) {
        showToast(generated.warning, 'info');
      }
      showToast('Код сгенерирован', 'success');
    } catch (error) {
      showToast(error?.message || error || 'Ошибка генерации кода', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const downloadProject = async () => {
    try {
      const blob = await api.downloadProject(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(project?.name || 'project').replace(/\s+/g, '_')}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast('Проект скачан', 'success');
    } catch (error) {
      showToast(error || 'Ошибка скачивания', 'error');
    }
  };

  if (loading) return <Loading />;
  if (!project) return null;

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="logo"><Sparkles size={24} /> AI Builder</div>
        <nav>
          <Link to="/dashboard" className="nav-item"><Layout size={20} /> Проекты</Link>
          <Link to="/generator" className="nav-item"><Zap size={20} /> Новый проект</Link>
          <Link to="/profile" className="nav-item"><User size={20} /> Личный кабинет</Link>
          <Link to="/profile?tab=billing" className="nav-item"><CreditCard size={20} /> Подписка</Link>
        </nav>
      </aside>

      <main className="main-content">
        <div className="project-detail">
          <header className="detail-header">
            <div>
              <h1>{project.name}</h1>
              <p>{project.description}</p>
              <span className="stack-badge large">{project.template || 'custom'}</span>
            </div>
            <div className="header-actions">
              <button onClick={generateCode} className="btn-secondary" disabled={generating}>
                {generating ? 'Генерация...' : <><Code size={18} /> Сгенерировать код</>}
              </button>
              <button onClick={downloadProject} className="btn-primary">
                <Download size={18} /> Скачать
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
          </div>

          <div className="tab-content">
            {activeTab === 'frontend' && (
              <div className="structure-grid">
                <div className="structure-card">
                  <h3><Layout size={20} /> Страницы</h3>
                  <ul>{structure.pages.map((item, idx) => <li key={`p-${idx}`}>{item}</li>)}</ul>
                </div>
                <div className="structure-card">
                  <h3><Code size={20} /> Компоненты</h3>
                  <ul>{structure.components.map((item, idx) => <li key={`c-${idx}`}>{item}</li>)}</ul>
                </div>
                {project.generatedCode?.frontend && (
                  <div className="structure-card full">
                    <h3><Code size={20} /> Frontend code</h3>
                    <pre className="code-block"><code>{project.generatedCode.frontend}</code></pre>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'backend' && (
              <div className="structure-card full">
                <h3><Server size={20} /> API маршруты</h3>
                <div className="code-block">
                  {(structure.apiRoutes || []).map((item, idx) => <div key={`r-${idx}`}>{item}</div>)}
                </div>
                {project.generatedCode?.backend && (
                  <>
                    <h3 style={{ marginTop: '1rem' }}><Code size={20} /> Backend code</h3>
                    <pre className="code-block"><code>{project.generatedCode.backend}</code></pre>
                  </>
                )}
              </div>
            )}

            {activeTab === 'database' && (
              <div className="structure-card full">
                <h3><Database size={20} /> Database schema</h3>
                <div className="code-block">
                  {(structure.databaseSchema || []).map((item, idx) => <div key={`s-${idx}`}>{item}</div>)}
                </div>
                {project.generatedCode?.database && (
                  <>
                    <h3 style={{ marginTop: '1rem' }}><Code size={20} /> Database code</h3>
                    <pre className="code-block"><code>{project.generatedCode.database}</code></pre>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
