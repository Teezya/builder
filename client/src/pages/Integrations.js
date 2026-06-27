import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Layout, Server, CreditCard, MessageCircle, Users, User } from 'lucide-react';

export default function Integrations() {
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="logo"><Sparkles size={24} /> AI Builder</div>
        <nav>
          <Link to="/dashboard" className="nav-item"><Layout size={20} /> Проекты</Link>
          <Link to="/integrations" className="nav-item active"><Server size={20} /> Интеграции</Link>
          <Link to="/profile" className="nav-item"><User size={20} /> Личный кабинет</Link>
          <Link to="/profile?tab=billing" className="nav-item"><CreditCard size={20} /> Подписка</Link>
        </nav>
      </aside>

      <main className="main-content">
        <div className="integrations-page">
          <h1>Интеграции</h1>
          <p>Подключайте внешние сервисы к вашему продукту.</p>

          <div className="integrations-grid">
            <div className="integration-card">
              <CreditCard size={40} />
              <h3>Stripe</h3>
              <p>Прием платежей и подписок.</p>
              <button className="btn-secondary">Подключить</button>
            </div>
            <div className="integration-card">
              <MessageCircle size={40} />
              <h3>Telegram</h3>
              <p>Уведомления и триггеры через бота.</p>
              <button className="btn-secondary">Подключить</button>
            </div>
            <div className="integration-card">
              <Users size={40} />
              <h3>CRM</h3>
              <p>Синхронизация лидов и воронки продаж.</p>
              <button className="btn-secondary">Подключить</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
