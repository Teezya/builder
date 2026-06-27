/**
 * Landing Page - Главная страница
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Zap, Code, Rocket, ChevronRight } from 'lucide-react';

export default function Landing() {
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
          <h3>Быстро</h3>
          <p>Генерируй полную структуру приложения за 2-3 минуты вместо недель работы</p>
        </div>
        <div className="feature-card">
          <Code className="icon-silver" size={40} />
          <h3>Production-ready код</h3>
          <p>Получи чистый, современный, оптимизированный код готовый к деплою</p>
        </div>
        <div className="feature-card">
          <Rocket className="icon-gold" size={40} />
          <h3>Масштабируемо</h3>
          <p>Расширяй функциональность, добавляй модули и интегрируй внешние сервисы</p>
        </div>
      </section>

      <footer className="footer">
        <p>&copy; 2024 AI Startup Builder. Все права защищены.</p>
      </footer>
    </div>
  );
}
