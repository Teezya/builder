/**
 * Project Editor Page - Редактор проекта
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Settings } from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';
import Loading from '../components/Loading';

export default function ProjectEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadProject();
  }, [id]);

  const loadProject = async () => {
    try {
      setLoading(true);
      const data = await api.getProject(id);
      setProject(data);
    } catch (error) {
      showToast(error || 'Ошибка загрузки проекта', 'error');
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await api.updateProject(id, project);
      showToast('Проект сохранен!', 'success');
    } catch (error) {
      showToast(error || 'Ошибка сохранения', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = async () => {
    try {
      const blob = await api.downloadProject(id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name}.zip`;
      a.click();
      showToast('Проект скачан', 'success');
    } catch (error) {
      showToast(error || 'Ошибка скачивания', 'error');
    }
  };

  if (loading) return <Loading />;
  if (!project) return <div>Проект не найден</div>;

  return (
    <div className="project-editor">
      <nav className="editor-nav">
        <div className="nav-left">
          <button className="btn-icon" onClick={() => navigate('/dashboard')}>
            <ArrowLeft size={20} />
          </button>
          <h2>{project.name}</h2>
        </div>
        <div className="nav-right">
          <button className="btn-secondary" onClick={handleDownload}>
            <Download size={18} /> Скачать
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
            <Settings size={18} /> {isSaving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </nav>

      <div className="editor-container">
        <div className="editor-panel">
          <h3>Параметры проекта</h3>
          
          <div className="form-group">
            <label>Название</label>
            <input
              type="text"
              value={project.name}
              onChange={(e) => setProject({ ...project, name: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Описание</label>
            <textarea
              value={project.description}
              onChange={(e) => setProject({ ...project, description: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Статус</label>
            <select
              value={project.status}
              onChange={(e) => setProject({ ...project, status: e.target.value })}
            >
              <option value="draft">Черновик</option>
              <option value="in-progress">В разработке</option>
              <option value="completed">Завершено</option>
            </select>
          </div>
        </div>

        <div className="editor-preview">
          <h3>Предпросмотр</h3>
          <div className="preview-content">
            <p>JSON проекта:</p>
            <pre>{JSON.stringify(project, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
