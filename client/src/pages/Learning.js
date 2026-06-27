import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Layout, Server, Database, Code, Zap, BookOpen, User, CreditCard } from 'lucide-react';

export default function Learning() {
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="logo"><Sparkles size={24} /> AI Builder</div>
        <nav>
          <Link to="/dashboard" className="nav-item"><Layout size={20} /> Проекты</Link>
          <Link to="/generator" className="nav-item"><Zap size={20} /> Новый проект</Link>
          <Link to="/learning" className="nav-item active"><BookOpen size={20} /> Обучение</Link>
          <Link to="/profile" className="nav-item"><User size={20} /> Личный кабинет</Link>
          <Link to="/profile?tab=billing" className="nav-item"><CreditCard size={20} /> Подписка</Link>
        </nav>
      </aside>

      <main className="main-content">
        <div className="learning-page">
          <h1>Режим обучения</h1>
          <p>Изучи основы веб-разработки</p>

          <div className="learning-grid">
            <div className="learn-card">
              <Layout size={40} className="icon-green" />
              <h3>Frontend</h3>
              <p>Клиентская часть приложения: UI, UX, роутинг и состояния.</p>
            </div>
            <div className="learn-card">
              <Server size={40} className="icon-bronze" />
              <h3>Backend</h3>
              <p>API, бизнес-логика, авторизация, интеграции и безопасность.</p>
            </div>
            <div className="learn-card">
              <Database size={40} className="icon-green" />
              <h3>Database</h3>
              <p>Хранение данных, схемы, индексы и миграции.</p>
            </div>
            <div className="learn-card">
              <Code size={40} className="icon-bronze" />
              <h3>Full Stack</h3>
              <p>Связь всех уровней в единый продуктовый поток.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
