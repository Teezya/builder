import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Sparkles,
  Layout,
  User,
  CreditCard,
  Save,
  CheckCircle2,
  ShieldCheck,
  Wallet,
  Building2,
  Crown,
  Receipt,
} from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';
import Loading from '../components/Loading';

export default function Profile() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const showToast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingPlan, setProcessingPlan] = useState('');
  const [profile, setProfile] = useState(null);
  const [plans, setPlans] = useState([]);
  const [billingHistory, setBillingHistory] = useState([]);
  const [fullName, setFullName] = useState('');
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') === 'billing' ? 'billing' : 'overview');

  useEffect(() => {
    const load = async () => {
      try {
        const [profileData, subscription, planList] = await Promise.all([
          api.getAccountProfile(),
          api.getSubscription(),
          api.getPlans(),
        ]);

        const mergedProfile = {
          ...(profileData || {}),
          ...((subscription && subscription.user) || {}),
        };

        setProfile(mergedProfile);
        setFullName(mergedProfile.fullName || '');
        setPlans(Array.isArray(planList) ? planList : []);
        setBillingHistory(Array.isArray(subscription?.billingHistory) ? subscription.billingHistory : []);
      } catch (error) {
        showToast(error || 'Не удалось загрузить профиль', 'error');
        navigate('/dashboard');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [navigate, showToast]);

  useEffect(() => {
    const queryTab = searchParams.get('tab');
    if (queryTab === 'billing' || queryTab === 'overview') {
      setActiveTab(queryTab);
    }
  }, [searchParams]);

  const openTab = (tab) => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    setSearchParams(nextParams, { replace: true });
  };

  const sortedPlans = useMemo(() => {
    const weights = { free: 0, pro: 1, business: 2, enterprise: 3 };
    return [...plans].sort((a, b) => (weights[a.code] ?? 999) - (weights[b.code] ?? 999));
  }, [plans]);

  const usagePercent = useMemo(() => {
    const used = Number(profile?.creditsUsed ?? 0);
    const limit = Number(profile?.creditsLimit ?? 0);
    if (!limit) return 0;
    return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
  }, [profile]);

  const companyName = useMemo(() => {
    return profile?.email?.split('@')?.[1]?.split('.')?.[0] || 'startup';
  }, [profile]);

  const handleSave = async (event) => {
    event.preventDefault();
    if (!fullName.trim()) {
      showToast('Введите имя', 'error');
      return;
    }

    try {
      setSaving(true);
      const result = await api.updateAccountProfile(fullName.trim());
      const nextUser = result.user;
      setProfile(nextUser);
      localStorage.setItem('user', JSON.stringify(nextUser));
      showToast('Профиль обновлен', 'success');
    } catch (error) {
      showToast(error || 'Ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckout = async (planCode) => {
    try {
      setProcessingPlan(planCode);
      const result = await api.checkoutSubscription(planCode);
      setProfile(result.user);
      setBillingHistory(Array.isArray(result.billingHistory) ? result.billingHistory : []);
      localStorage.setItem('user', JSON.stringify(result.user));
      showToast(result.message || 'Подписка обновлена', 'success');
    } catch (error) {
      showToast(error || 'Ошибка обновления подписки', 'error');
    } finally {
      setProcessingPlan('');
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="logo"><Sparkles size={24} /> AI Builder</div>
        <nav>
          <Link to="/dashboard" className="nav-item"><Layout size={20} /> Проекты</Link>
          <Link to="/profile" className="nav-item active"><User size={20} /> Личный кабинет</Link>
        </nav>
      </aside>

      <main className="main-content">
        <div className="account-page account-hub">
          <section className="account-hero account-card">
            <div className="account-hero-main">
              <div className="account-avatar">{(fullName || profile?.email || 'U').slice(0, 1).toUpperCase()}</div>
              <div>
                <h1>Личный кабинет</h1>
                <p className="subtitle">Управление аккаунтом, корпоративной подпиской и расходом токенов в одном месте.</p>
              </div>
            </div>

            <div className="account-hero-badges">
              <span className="account-badge"><Building2 size={14} /> {companyName}</span>
              <span className="account-badge"><ShieldCheck size={14} /> SOC2-ready</span>
              <span className="account-badge"><Wallet size={14} /> {Math.max(0, Number(profile?.creditsRemaining || 0))} токенов</span>
            </div>
          </section>

          <section className="account-tabs">
            <button
              type="button"
              className={`account-tab-btn${activeTab === 'overview' ? ' active' : ''}`}
              onClick={() => openTab('overview')}
            >
              <User size={16} /> Профиль
            </button>
            <button
              type="button"
              className={`account-tab-btn${activeTab === 'billing' ? ' active' : ''}`}
              onClick={() => openTab('billing')}
            >
              <CreditCard size={16} /> Подписка
            </button>
          </section>

          {activeTab === 'overview' && (
            <section className="account-overview-grid">
              <form onSubmit={handleSave} className="account-card">
                <h2>Данные профиля</h2>
                <div className="form-group">
                  <label>Имя</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    maxLength={80}
                  />
                </div>

                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={profile?.email || ''} disabled />
                </div>

                <div className="profile-grid">
                  <div className="profile-stat">
                    <span>Текущий план</span>
                    <strong>{String(profile?.plan || 'free').toUpperCase()}</strong>
                  </div>
                  <div className="profile-stat">
                    <span>AI режим</span>
                    <strong>{profile?.aiMode === 'lite' ? 'LITE' : 'FULL'}</strong>
                  </div>
                  <div className="profile-stat">
                    <span>Осталось токенов</span>
                    <strong>{Math.max(0, Number(profile?.creditsRemaining || 0))}</strong>
                  </div>
                  <div className="profile-stat">
                    <span>Реферальный код</span>
                    <strong>{profile?.referralCode || 'нет'}</strong>
                  </div>
                </div>

                <button type="submit" className="btn-primary" disabled={saving}>
                  <Save size={16} />
                  {saving ? 'Сохранение...' : 'Сохранить профиль'}
                </button>
              </form>

              <div className="account-card account-side-card">
                <h2>Использование цикла</h2>
                <div className="usage-meter">
                  <div className="usage-meter-row">
                    <span>{Math.max(0, Number(profile?.creditsUsed || 0))} / {Math.max(0, Number(profile?.creditsLimit || 0))}</span>
                    <strong>{usagePercent}%</strong>
                  </div>
                  <div className="usage-meter-track">
                    <div className="usage-meter-fill" style={{ width: `${usagePercent}%` }} />
                  </div>
                </div>

                <div className="account-security-grid">
                  <div className="security-item">
                    <ShieldCheck size={16} />
                    <span>JWT + hash-защита аккаунта</span>
                  </div>
                  <div className="security-item">
                    <CheckCircle2 size={16} />
                    <span>Мгновенное применение лимитов после смены плана</span>
                  </div>
                  <div className="security-item">
                    <Receipt size={16} />
                    <span>Прозрачная история биллинга в кабинете</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'billing' && (
            <section>
              <div className="account-card billing-summary-corp">
                <div>
                  <p className="billing-label">Current contract</p>
                  <h2>{String(profile?.plan || 'free').toUpperCase()}</h2>
                  <p className="subtitle">{profile?.subscriptionStatus === 'active' ? 'Подписка активна' : 'Ожидает активации'}</p>
                </div>
                <div className="billing-summary-stats">
                  <div className="profile-stat">
                    <span>Лимит токенов</span>
                    <strong>{Math.max(0, Number(profile?.creditsLimit || 0))}</strong>
                  </div>
                  <div className="profile-stat">
                    <span>Остаток</span>
                    <strong>{Math.max(0, Number(profile?.creditsRemaining || 0))}</strong>
                  </div>
                  <div className="profile-stat">
                    <span>AI режим</span>
                    <strong>{profile?.aiMode === 'lite' ? 'LITE' : 'FULL'}</strong>
                  </div>
                </div>
              </div>

              <div className="plans-grid plans-grid-corp">
                {sortedPlans.map((plan) => {
                  const isCurrent = profile?.plan === plan.code;
                  const isProcessing = processingPlan === plan.code;
                  const isPriority = plan.code === 'business' || plan.code === 'enterprise';

                  return (
                    <article key={plan.code} className={`plan-card${isCurrent ? ' active' : ''}${isPriority ? ' highlighted' : ''}`}>
                      <div className="plan-head">
                        <h3>{plan.name}</h3>
                        {isPriority && <span className="plan-chip"><Crown size={13} /> Corporate</span>}
                      </div>

                      <p className="plan-price">
                        {plan.monthlyPrice === null ? 'По запросу' : `$${plan.monthlyPrice}/мес`}
                      </p>
                      <p className="plan-credits">{plan.creditsLimit} токенов / цикл</p>

                      <ul>
                        {(plan.features || []).map((feature) => (
                          <li key={feature}><CheckCircle2 size={14} /> {feature}</li>
                        ))}
                      </ul>

                      <button
                        className={isCurrent ? 'btn-secondary' : 'btn-primary'}
                        disabled={isCurrent || isProcessing}
                        onClick={() => handleCheckout(plan.code)}
                      >
                        {isCurrent ? 'Текущий тариф' : isProcessing ? 'Обновление...' : 'Перейти на тариф'}
                      </button>
                    </article>
                  );
                })}
              </div>

              <div className="account-card">
                <h2>История биллинга</h2>
                {billingHistory.length === 0 ? (
                  <p className="subtitle">Покупок пока нет. После первой оплаты здесь появятся транзакции.</p>
                ) : (
                  <div className="billing-history-list">
                    {billingHistory
                      .slice()
                      .reverse()
                      .slice(0, 8)
                      .map((entry) => (
                        <div className="billing-history-row" key={entry.id || `${entry.plan}-${entry.createdAt}`}>
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
        </div>
      </main>
    </div>
  );
}
