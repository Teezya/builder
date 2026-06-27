/**
 * AI Startup Builder - Backend
 * Express + JWT Auth + xAI Grok + JSON Storage + ZIP Export
 */

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const multer = require('multer');
const postgresMirror = require('./src/postgres-mirror');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ==================== MULTER SETUP ====================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed'));
    }
  }
});

// ==================== CONFIG ====================
const JWT_SECRET = process.env.JWT_SECRET || 'ai_startup_diplom_2024_secret_key_xyz789';
const PORT = process.env.PORT || 5000;
const DB_PATH = path.join(__dirname, 'db.json');
const XAI_API_BASE = process.env.XAI_API_BASE || 'https://api.x.ai/v1';
const XAI_DEFAULT_MODEL = normalizeText(process.env.XAI_MODEL || process.env.XAI_DEFAULT_MODEL || 'grok-4.3') || 'grok-4.3';
const XAI_GROK_MODELS = parseModelList(process.env.XAI_GROK_MODELS || process.env.XAI_GROK_MODEL || 'grok-4.3,grok-4.20,grok-4,grok-4.3-mini,grok-4-mini,grok-4.1');
const XAI_MODELS_TIMEOUT_MS = Math.max(1000, Number(process.env.XAI_MODELS_TIMEOUT_MS || 8000));
const XAI_REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.XAI_REQUEST_TIMEOUT_MS || 45000));
const PLAN_LIMITS = {
  free: 200,
  pro: 2000,
  business: 10000,
  enterprise: 100000,
};
const PLAN_PRICES = {
  free: 0,
  pro: 29,
  business: 99,
  enterprise: null,
};
const PLAN_FEATURES = {
  free: ['Базовые AI генерации', 'До 3 активных проектов', 'Экспорт проекта', 'Lite AI после исчерпания токенов'],
  pro: ['Приоритетная генерация', 'Расширенные шаблоны', 'Больше AI кредитов', 'Профиль и аналитика использования'],
  business: ['Командная работа', 'Роли пользователей', 'AI аналитика продукта', 'Высокий лимит токенов'],
  enterprise: ['SSO', 'SLA', 'Выделенная инфраструктура', 'Кастомные лимиты и интеграции'],
};
const CREDIT_COSTS = {
  createProject: 5,
  generateCode: 12,
  generatePreview: 6,
};
const FREE_FULL_AI_REQUESTS = 5;
const REFERRAL_BONUS_CREDITS = 120;
const BILLING_CYCLE_DAYS = 30;
const LITE_AI_NOTICE = 'Кредиты закончились: включен Lite AI режим с упрощенной генерацией.';
const FREE_LAST_FULL_NOTICE = 'Это был последний бесплатный запрос с full AI. Следующие запросы будут в Lite режиме. Подпишитесь для продолжения full AI.';
const SUBSCRIBE_AFTER_TOKENS_NOTICE = 'Бесплатные full-запросы закончились. Доступен Lite AI. Оформите подписку, чтобы вернуть full AI.';
const PG_ADMIN_TOKEN = process.env.PG_ADMIN_TOKEN || '';
const PG_PRIMARY_ENABLED = String(process.env.PG_PRIMARY_ENABLED || '').toLowerCase() === 'true';
const PG_WRITE_JSON_FALLBACK = String(process.env.PG_WRITE_JSON_FALLBACK || 'true').toLowerCase() !== 'false';

console.log('[xAI] XAI_API_BASE=', XAI_API_BASE);
console.log('[xAI] XAI_GROK_MODELS=', XAI_GROK_MODELS.join(', '));
console.log('[xAI] XAI_DEFAULT_MODEL=', XAI_DEFAULT_MODEL);
console.log('[xAI] XAI_API_KEY present=', Boolean(process.env.XAI_API_KEY));

function parseModelList(value) {
  return String(value || '')
    .split(/[;,\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

let xaiConnected = false;
let xaiAvailableModels = [...XAI_GROK_MODELS];

function uniqueModels(models) {
  return [...new Set((models || []).map(item => normalizeText(item)).filter(Boolean))];
}

function prioritizeModel(models, preferred) {
  const unique = uniqueModels(models);
  const preferredModel = normalizeText(preferred);
  if (!preferredModel) return unique;

  const preferredIndex = unique.findIndex(item => item === preferredModel);
  if (preferredIndex === -1) {
    return [preferredModel, ...unique];
  }

  if (preferredIndex === 0) {
    return unique;
  }

  return [unique[preferredIndex], ...unique.slice(0, preferredIndex), ...unique.slice(preferredIndex + 1)];
}

function getXaiModels() {
  const models = Array.isArray(xaiAvailableModels) && xaiAvailableModels.length
    ? xaiAvailableModels
    : XAI_GROK_MODELS;
  return prioritizeModel(models, XAI_DEFAULT_MODEL);
}

async function loadXaiModels() {
  const xaiKey = process.env.XAI_API_KEY;
  if (!xaiKey) {
    xaiConnected = false;
    xaiAvailableModels = prioritizeModel(XAI_GROK_MODELS, XAI_DEFAULT_MODEL);
    return {
      connected: false,
      models: xaiAvailableModels,
      error: 'XAI_API_KEY is not configured',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), XAI_MODELS_TIMEOUT_MS);

  try {
    const response = await fetch(`${XAI_API_BASE}/models`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${xaiKey}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const modelIds = Array.isArray(data?.data)
      ? data.data.map(item => normalizeText(item?.id)).filter(Boolean)
      : [];
    const grokModels = modelIds.filter(item => /grok/i.test(item));
    const nextModels = prioritizeModel(grokModels.length ? grokModels : modelIds, XAI_DEFAULT_MODEL);

    xaiAvailableModels = nextModels.length ? nextModels : prioritizeModel(XAI_GROK_MODELS, XAI_DEFAULT_MODEL);
    xaiConnected = true;
    return {
      connected: true,
      models: xaiAvailableModels,
    };
  } catch (error) {
    xaiConnected = false;
    xaiAvailableModels = prioritizeModel(XAI_GROK_MODELS, XAI_DEFAULT_MODEL);
    return {
      connected: false,
      models: xaiAvailableModels,
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function tryXaiGrokRequest(payload, label) {
  const xaiKey = process.env.XAI_API_KEY;
  if (!xaiKey) return null;

  const bodyPayload = { ...payload };
  if (bodyPayload.messages && !bodyPayload.input) {
    bodyPayload.input = bodyPayload.messages;
    delete bodyPayload.messages;
  }

  for (const model of getXaiModels()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), XAI_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${XAI_API_BASE}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${xaiKey}`,
        },
        body: JSON.stringify({ ...bodyPayload, model }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[xAI Grok ${label}] ${model} HTTP ${response.status}: ${errorText.slice(0, 200)}`);
        if (/model|invalid|not found|unsupported|rate limit/i.test(errorText)) {
          continue;
        }
        return null;
      }

      const data = await response.json();
      let content = '';

      if (Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            for (const block of item.content) {
              if (block.type === 'output_text' && block.text) {
                content += block.text;
              }
            }
          }
          if (!content && item.type === 'output_text' && item.text) {
            content += item.text;
          }
        }
      }

      if (!content) {
        content = (data.output?.[0]?.content?.[0]?.text || data.output?.[0]?.content?.[0]?.html || data.output?.[0]?.content?.[0]?.payload?.text || data.choices?.[0]?.message?.content || data.choices?.[0]?.text || data.text || data.output_text || '').trim();
      }

      content = content.trim();
      if (!content) {
        console.log(`[xAI Grok ${label}] ${model} returned empty content`);
        continue;
      }

      console.log(`[xAI Grok ${label}] ${model} succeeded (${content.length} chars)`);
      return content;
    } catch (err) {
      console.log(`[xAI Grok ${label}] ${model} error: ${err.message.slice(0, 120)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

// ==================== JSON DATABASE ====================
function readJsonDB() {
  const initialData = { users: [], projects: [] };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
    return initialData;
  }
}

async function readDB() {
  if (PG_PRIMARY_ENABLED) {
    try {
      await postgresMirror.init();
      const snapshot = await postgresMirror.readSnapshot();
      if (snapshot && Array.isArray(snapshot.users) && Array.isArray(snapshot.projects)) {
        return snapshot;
      }
    } catch (error) {
      console.log('[PG Primary] read failed, fallback to JSON:', error.message);
    }
  }

  return readJsonDB();
}

async function writeDB(data) {
  if (PG_PRIMARY_ENABLED) {
    try {
      const result = await postgresMirror.writeSnapshot(data, 'primary_write');
      if (!result?.ok) {
        throw new Error(result?.error || 'Unknown PG write error');
      }
    } catch (error) {
      console.log('[PG Primary] write failed, fallback to JSON:', error.message);
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
      return;
    }

    if (PG_WRITE_JSON_FALLBACK) {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    }
    return;
  }

  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  postgresMirror.queueSync(data, 'write_db');
}

function isPgAdmin(req) {
  if (!PG_ADMIN_TOKEN) return false;
  const token = req.header('x-admin-token');
  return token === PG_ADMIN_TOKEN;
}

function genId() {
  return crypto.randomBytes(12).toString('hex');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePlan(value) {
  const plan = normalizeText(value).toLowerCase();
  return PLAN_LIMITS[plan] ? plan : 'free';
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function getPlansCatalog() {
  return Object.keys(PLAN_LIMITS).map(code => ({
    code,
    name: code === 'free' ? 'Free' : code === 'pro' ? 'Pro' : code === 'business' ? 'Business' : 'Enterprise',
    monthlyPrice: PLAN_PRICES[code],
    creditsLimit: PLAN_LIMITS[code],
    features: PLAN_FEATURES[code],
  }));
}

function ensureUserSaaSFields(user) {
  const plan = normalizePlan(user.plan || 'free');
  const creditsLimit = Number.isFinite(Number(user.creditsLimit))
    ? Number(user.creditsLimit)
    : PLAN_LIMITS[plan];
  const creditsUsed = Number.isFinite(Number(user.creditsUsed))
    ? Math.max(0, Number(user.creditsUsed))
    : 0;
  const now = Date.now();
  let nextBillingAt = normalizeText(user.nextBillingAt) || addDaysIso(BILLING_CYCLE_DAYS);
  let parsedNextBilling = Date.parse(nextBillingAt);
  if (Number.isNaN(parsedNextBilling)) {
    nextBillingAt = addDaysIso(BILLING_CYCLE_DAYS);
    parsedNextBilling = Date.parse(nextBillingAt);
  }

  let rolledCreditsUsed = creditsUsed;
  if (now >= parsedNextBilling) {
    rolledCreditsUsed = 0;
    nextBillingAt = addDaysIso(BILLING_CYCLE_DAYS);
  }

  return {
    ...user,
    fullName: normalizeText(user.fullName) || normalizeText(user.email).split('@')[0],
    plan,
    creditsLimit,
    creditsUsed: rolledCreditsUsed,
    creditsSpentTotal: Number.isFinite(Number(user.creditsSpentTotal)) ? Math.max(0, Number(user.creditsSpentTotal)) : rolledCreditsUsed,
    nextBillingAt,
    aiMode: rolledCreditsUsed >= creditsLimit ? 'lite' : 'full',
    referralCode: normalizeText(user.referralCode) || `ref_${user._id.slice(0, 8)}`,
    referralsCount: Number.isFinite(Number(user.referralsCount)) ? Number(user.referralsCount) : 0,
    referredBy: normalizeText(user.referredBy),
    referralBonusReceived: Boolean(user.referralBonusReceived),
    subscriptionStatus: normalizeText(user.subscriptionStatus) || (plan === 'free' ? 'inactive' : 'active'),
    lastPaymentAt: normalizeText(user.lastPaymentAt),
    fullAiLimit: Number.isFinite(Number(user.fullAiLimit)) ? Math.max(1, Number(user.fullAiLimit)) : FREE_FULL_AI_REQUESTS,
    fullAiUsed: Number.isFinite(Number(user.fullAiUsed)) ? Math.max(0, Number(user.fullAiUsed)) : 0,
  };
}

function publicUser(user) {
  const normalized = ensureUserSaaSFields(user);
  const isFreeWithoutSubscription = normalized.plan === 'free' && normalized.subscriptionStatus !== 'active';
  const visibleLimit = isFreeWithoutSubscription ? normalized.fullAiLimit : normalized.creditsLimit;
  const visibleUsed = isFreeWithoutSubscription ? Math.min(normalized.fullAiUsed, visibleLimit) : normalized.creditsUsed;
  const visibleRemaining = Math.max(0, visibleLimit - visibleUsed);

  return {
    id: normalized._id,
    email: normalized.email,
    fullName: normalized.fullName,
    plan: normalized.plan,
    subscriptionStatus: normalized.subscriptionStatus,
    nextBillingAt: normalized.nextBillingAt,
    lastPaymentAt: normalized.lastPaymentAt || null,
    aiMode: normalized.aiMode,
    creditsLimit: visibleLimit,
    creditsUsed: visibleUsed,
    creditsRemaining: visibleRemaining,
    creditsSpentTotal: normalized.creditsSpentTotal,
    fullAiLimit: normalized.fullAiLimit,
    fullAiUsed: normalized.fullAiUsed,
    fullAiRemaining: Math.max(0, normalized.fullAiLimit - normalized.fullAiUsed),
    subscribePrompt: isFreeWithoutSubscription && normalized.fullAiUsed >= normalized.fullAiLimit
      ? SUBSCRIBE_AFTER_TOKENS_NOTICE
      : null,
    referralCode: normalized.referralCode,
    referralsCount: normalized.referralsCount,
    referredBy: normalized.referredBy || null,
    referralBonusReceived: normalized.referralBonusReceived,
  };
}

function consumeCredits(db, userId, amount, reason, options = {}) {
  const { allowLite = false } = options;
  const userIndex = db.users.findIndex(item => item._id === userId);
  if (userIndex === -1) {
    return { ok: false, status: 404, error: 'Пользователь не найден' };
  }

  const user = ensureUserSaaSFields(db.users[userIndex]);

  const isFreeWithoutSubscription = user.plan === 'free' && user.subscriptionStatus !== 'active';
  if (isFreeWithoutSubscription) {
    const remainingFull = Math.max(0, user.fullAiLimit - user.fullAiUsed);
    if (remainingFull <= 0) {
      if (allowLite) {
        user.aiMode = 'lite';
        user.updatedAt = new Date().toISOString();
        db.users[userIndex] = user;
        return {
          ok: true,
          lite: true,
          warning: SUBSCRIBE_AFTER_TOKENS_NOTICE,
          usage: publicUser(user),
          subscribeRequired: true,
        };
      }

      return {
        ok: false,
        status: 402,
        error: SUBSCRIBE_AFTER_TOKENS_NOTICE,
        usage: publicUser(user),
      };
    }

    user.fullAiUsed += 1;
    user.aiMode = 'full';
    user.lastUsageReason = reason;
    user.updatedAt = new Date().toISOString();
    db.users[userIndex] = user;

    const isLastFull = user.fullAiUsed >= user.fullAiLimit;
    return {
      ok: true,
      usage: publicUser(user),
      warning: isLastFull ? FREE_LAST_FULL_NOTICE : null,
      subscribeRequired: isLastFull,
    };
  }

  const remaining = user.creditsLimit - user.creditsUsed;
  if (remaining < amount) {
    if (allowLite) {
      user.aiMode = 'lite';
      user.updatedAt = new Date().toISOString();
      db.users[userIndex] = user;
      return {
        ok: true,
        lite: true,
        warning: LITE_AI_NOTICE,
        usage: publicUser(user),
      };
    }

    return {
      ok: false,
      status: 402,
      error: `Недостаточно кредитов: нужно ${amount}, доступно ${Math.max(0, remaining)}`,
      usage: publicUser(user),
    };
  }

  user.creditsUsed += amount;
  user.creditsSpentTotal = (Number(user.creditsSpentTotal) || 0) + amount;
  user.aiMode = 'full';
  user.lastUsageReason = reason;
  user.updatedAt = new Date().toISOString();
  db.users[userIndex] = user;

  return {
    ok: true,
    usage: publicUser(user),
  };
}

function shortDesc(value, maxLen = 180) {
  let s = String(value || '').trim();
  // Убираем "ПРОМТ:" и подобные префиксы
  s = s.replace(/^(промт|prompt|описание|description)\s*:\s*/i, '');
  // Берём только первое предложение или первые maxLen символов
  const dot = s.search(/[.!?]/);
  if (dot > 20 && dot < maxLen) s = s.slice(0, dot + 1);
  else if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
  return s;
}

function normalizeList(value, fallback = []) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const cleaned = value
    .map(item => String(item || '').trim())
    .filter(Boolean);

  return cleaned.length ? cleaned : [...fallback];
}

function stripCodeBlocks(text) {
  return String(text || '')
    .replace(/```(?:[\w-]+)?\n?/g, '')
    .replace(/```$/g, '')
    .trim();
}

function extractHtmlSegment(raw) {
  const text = String(raw || '').trim();
  const startMatch = text.match(/<!doctype|<html|<body|<head|<style/i);
  if (!startMatch) return text;
  const start = startMatch.index;
  let segment = text.slice(start).trim();
  const endMatch = segment.match(/<\/html>/i);
  if (endMatch) {
    segment = segment.slice(0, endMatch.index + endMatch[0].length).trim();
  }
  return segment;
}

function looksLikeHtmlContent(html) {
  if (!html || typeof html !== 'string') return false;
  const normalized = html.toLowerCase();
  return /<!doctype|<html|<body|<head|<style|<script|<div|<section|<main|<header|<footer|<nav/.test(normalized);
}

function extractJsonObject(text) {
  const source = String(text || '').trim();
  if (!source) return null;

  const codeBlock = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let jsonText = codeBlock ? codeBlock[1].trim() : source;

  if (!jsonText) return null;

  const tryParse = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const findBalancedJson = (input) => {
    const start = input.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < input.length; i += 1) {
      const char = input[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return input.slice(start, i + 1);
        }
      }
    }
    return null;
  };

  const cleanJson = (value) => {
    let cleaned = value.trim();
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
    cleaned = cleaned.replace(/([{,\s])([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
    cleaned = cleaned.replace(/:\s*'([^']*)'/g, ': "$1"');
    cleaned = cleaned.replace(/'([^']*)'/g, '"$1"');
    return cleaned;
  };

  let result = tryParse(jsonText);
  if (result) return result;

  const balanced = findBalancedJson(jsonText);
  if (balanced) {
    result = tryParse(balanced);
    if (result) return result;
    const cleaned = cleanJson(balanced);
    result = tryParse(cleaned);
    if (result) return result;
  }

  const cleaned = cleanJson(jsonText);
  result = tryParse(cleaned);
  return result;
}

function enhanceUserPrompt(description) {
  const prompt = normalizeText(description);
  if (!prompt) return '';
  if (prompt.length < 120) {
    return `${prompt}. Сохрани смысл и тему. Добавь указания на premium дизайн, modern responsive layout, продуманную визуальную иерархию, consistent spacing, качественные CTA, а также правильную структуру сайта с логичными секциями и семантическими блоками.`;
  }
  return prompt;
}

function buildAiMessages(taskName, userInstructions) {
  return [
    {
      role: 'system',
      content: `Ты senior product designer и frontend architect. Твоя задача — генерировать premium, современный, responsive и production-ready дизайн, структуру и код. Всегда следуй пользовательскому запросу, не меняй тему, не пропускай секции и не создавай незавершенные интерфейсы. Сайт должен выглядеть дорогим, качественным и профессиональным, а не дешёвым шаблоном. Используй логичную архитектуру: header, hero, секции с ценностным предложением, блок преимуществ/фич, pricing/cta и footer. Применяй семантические теги, доступность, типографику и четкую визуальную иерархию. Никогда не делай страницу выглядеть как простая демка или копипаст-макет.`
    },
    {
      role: 'system',
      content: `Ты инженер. Сначала создавай layout-план, затем structure-секцию, потом UI-компоненты, стили, анимации и адаптивность. Используй semantic HTML, reusable React/TypeScript компоненты и системные классы. Запрещено inline-style и устаревшие решения. Дизайн должен быть чистым, качественным и продуманным, с правильной структурой контента и понятной навигацией. Не используй шаблонные секции без смысла, не добавляй лишние блоки, каждый блок должен иметь понятную цель.`
    },
    {
      role: 'user',
      content: `${taskName}\n\n${userInstructions}`
    }
  ];
}

function validateHtmlOutput(html) {
  if (!html || typeof html !== 'string') return false;
  const normalized = html.toLowerCase();
  if (normalized.includes('style="') || normalized.includes("style =") || normalized.includes('style=\'')) {
    return false;
  }
  const hasRoot = normalized.includes('<html') || normalized.includes('<!doctype') || normalized.includes('<body') || normalized.includes('<head') || normalized.includes('<style');
  if (!hasRoot) return false;
  const hasStructure = normalized.includes('<body') || normalized.includes('<main') || normalized.includes('<section') || normalized.includes('<header') || normalized.includes('<footer') || normalized.includes('<nav') || normalized.includes('<div');
  if (!hasStructure) return false;
  const hasCss = normalized.includes('<style') || /--[a-z0-9-]+:/.test(normalized);
  if (!hasCss) return false;
  return true;
}

function validateCodeOutput(code) {
  if (!code || typeof code !== 'string') return false;
  const cleaned = stripCodeBlocks(code);
  if (cleaned.length < 300) return false;
  if (/style\s*=/.test(cleaned)) return false;
  if (cleaned.includes('TODO') || cleaned.includes('FIXME')) return false;
  return true;
}

function generateProjectName(description, fallback = 'Новый проект') {
  const source = normalizeText(description).replace(/[^\w\u0400-\u04FF\s-]/g, '');
  if (!source) {
    return fallback;
  }

  const words = source.split(/\s+/).filter(Boolean).slice(0, 4);
  if (!words.length) {
    return fallback;
  }

  return words
    .map((word, index) => {
      if (!word.length) {
        return word;
      }

      const normalized = word.charAt(0).toUpperCase() + word.slice(1);
      return index === 0 ? normalized : normalized.toLowerCase() === word ? normalized.toLowerCase() : normalized;
    })
    .join(' ');
}

function slugify(value) {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return slug || 'project';
}

function sanitizeArchiveBaseName(value) {
  const baseName = normalizeText(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return baseName || 'project';
}

function toAsciiArchiveBaseName(value) {
  const asciiName = sanitizeArchiveBaseName(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return asciiName || 'project';
}

function encodeRFC5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function toPascalCase(value, fallback = 'Section') {
  const parts = normalizeText(value)
    .split(/[^a-zA-Z0-9\u0400-\u04FF]+/)
    .filter(Boolean);

  if (!parts.length) {
    return fallback;
  }

  return parts
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function safeRoutePath(value, index = 0) {
  const slug = slugify(value);
  return index === 0 ? '/' : `/${slug}`;
}

function parseRoute(route) {
  const match = normalizeText(route).match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i);
  return {
    method: (match?.[1] || 'GET').toLowerCase(),
    path: match?.[2] || '/api/resource'
  };
}

function parseSchemaFields(schemaLine) {
  const fieldsSection = normalizeText(schemaLine).match(/\(([^)]*)\)/)?.[1] || '';
  return fieldsSection
    .split(',')
    .map(field => field.trim())
    .filter(Boolean)
    .filter(field => field.toLowerCase() !== 'id');
}

function inferFieldType(field) {
  const normalized = field.toLowerCase();

  if (/(count|price|amount|total|order|version|index|score|size)/.test(normalized)) {
    return 'Number';
  }

  if (/(enabled|published|archived|active|private|public|completed)/.test(normalized)) {
    return 'Boolean';
  }

  if (/(date|time|created|updated|publishedat|deployedat|lastlogin)/.test(normalized)) {
    return 'Date';
  }

  if (/(config|settings|props|metadata|schema|layout)/.test(normalized)) {
    return 'mongoose.Schema.Types.Mixed';
  }

  if (/(items|sections|blocks|roles|permissions|components|pages|members|tags)/.test(normalized)) {
    return '[String]';
  }

  return 'String';
}

function isNoCodeBuilderIdea(description) {
  const normalized = normalizeText(description).toLowerCase();
  const keywords = [
    'no-code',
    'nocode',
    'конструктор',
    'создатель проектов',
    'генератор проектов',
    'builder',
    'визуальный редактор',
    'drag and drop',
    'drag-and-drop',
    'без кода'
  ];

  return keywords.some(keyword => normalized.includes(keyword));
}

// ==================== AUTH MIDDLEWARE ====================
const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Нет токена' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Неверный токен' });
  }
};

// ==================== AI GENERATION ====================
const templates = {
  noCodeBuilder: {
    kind: 'no-code-builder',
    name: 'NoCode Project Builder',
    pages: [
      'Landing',
      'Dashboard',
      'Template Library',
      'Visual Editor',
      'Data Models',
      'Publish Center',
      'Billing',
      'Workspace Settings'
    ],
    components: [
      'HeroSection',
      'ProjectWizard',
      'TemplateMarketplace',
      'EditorCanvas',
      'BlockPalette',
      'PropertiesPanel',
      'LivePreview',
      'PublishDrawer',
      'BillingCard',
      'TeamWorkspaceCard'
    ],
    apiRoutes: [
      'GET /api/templates',
      'POST /api/projects',
      'GET /api/projects/:id',
      'PUT /api/projects/:id/layout',
      'PUT /api/projects/:id/schema',
      'POST /api/projects/:id/publish',
      'POST /api/projects/:id/deploy',
      'GET /api/deployments/:id/status'
    ],
    databaseSchema: [
      'users (id, email, password, fullName, role, plan)',
      'projects (id, userId, name, slug, status, templateId, stack)',
      'pages (id, projectId, name, path, sections, seoTitle)',
      'blocks (id, projectId, pageId, type, props, order)',
      'dataSources (id, projectId, name, provider, config)',
      'deployments (id, projectId, target, url, status, deployedAt)',
      'templates (id, name, category, description, previewImage)'
    ],
    productModules: [
      'Онбординг и мастер создания проекта',
      'Библиотека шаблонов и маркетплейс блоков',
      'Визуальный drag-and-drop редактор страниц',
      'Конструктор data model и API ресурсов',
      'Совместная работа команды и роли доступа',
      'Публикация, деплой и управление версиями'
    ],
    fileTree: [
      'client/src/App.js',
      'client/src/styles.css',
      'client/src/data/templates.js',
      'server/index.js',
      'server/routes/projects.js',
      'server/routes/templates.js',
      'server/models/index.js',
      'shared/blueprint.json'
    ]
  },
  ecommerce: {
    kind: 'ecommerce',
    name: 'Ecommerce MVP',
    pages: ['Главная', 'Каталог', 'Карточка товара', 'Корзина', 'Оформление заказа', 'Личный кабинет'],
    components: ['Header', 'ProductCard', 'CartItem', 'FilterSidebar', 'SearchBar', 'Footer'],
    apiRoutes: ['GET /api/products', 'GET /api/products/:id', 'POST /api/cart', 'POST /api/orders', 'GET /api/user/profile'],
    databaseSchema: ['users (id, email, password, name)', 'products (id, title, price, image, category)', 'orders (id, userId, items, total, status)', 'cart (id, userId, productId, quantity)'],
    productModules: ['Каталог товаров', 'Корзина и оформление заказа', 'Управление заказами'],
    fileTree: ['client/src/App.js', 'server/index.js', 'server/models/index.js']
  },
  blog: {
    kind: 'blog',
    name: 'Content Blog Platform',
    pages: ['Главная', 'Статья', 'Категории', 'О нас', 'Контакты'],
    components: ['ArticleCard', 'CommentSection', 'Sidebar', 'TagCloud', 'NewsletterForm'],
    apiRoutes: ['GET /api/posts', 'GET /api/posts/:id', 'POST /api/comments', 'GET /api/categories'],
    databaseSchema: ['posts (id, title, content, author, createdAt)', 'comments (id, postId, author, text)', 'categories (id, name, slug)'],
    productModules: ['Редактор публикаций', 'Категории и теги', 'Комментарии'],
    fileTree: ['client/src/App.js', 'server/index.js', 'server/models/index.js']
  },
  dashboard: {
    kind: 'dashboard',
    name: 'Analytics Dashboard',
    pages: ['Обзор', 'Аналитика', 'Пользователи', 'Настройки'],
    components: ['StatCard', 'ChartWidget', 'DataTable', 'Sidebar', 'Header'],
    apiRoutes: ['GET /api/stats', 'GET /api/users', 'GET /api/analytics', 'PUT /api/settings'],
    databaseSchema: ['users (id, email, role, lastLogin)', 'analytics (id, date, pageViews, uniqueVisitors)', 'settings (id, userId, theme, notifications)'],
    productModules: ['Дашборд KPI', 'Таблицы данных', 'Настройки'],
    fileTree: ['client/src/App.js', 'server/index.js', 'server/models/index.js']
  },
  social: {
    kind: 'social',
    name: 'Social Network MVP',
    pages: ['Лента', 'Профиль', 'Сообщения', 'Уведомления', 'Поиск'],
    components: ['PostCard', 'StoryViewer', 'ChatWindow', 'UserAvatar', 'LikeButton'],
    apiRoutes: ['GET /api/feed', 'POST /api/posts', 'GET /api/messages', 'POST /api/follow', 'GET /api/notifications'],
    databaseSchema: ['users (id, username, avatar, bio)', 'posts (id, userId, content, likes, createdAt)', 'messages (id, senderId, receiverId, text, createdAt)', 'followers (id, userId, followerId)'],
    productModules: ['Лента активности', 'Профили пользователей', 'Сообщения'],
    fileTree: ['client/src/App.js', 'server/index.js', 'server/models/index.js']
  }
};

function getFallbackTemplate(description, stack) {
  const desc = normalizeText(description).toLowerCase();
  let template = templates.dashboard;

  if (isNoCodeBuilderIdea(desc)) {
    template = templates.noCodeBuilder;
  } else if (desc.includes('магазин') || desc.includes('ecommerce') || desc.includes('товар') || desc.includes('купить') || desc.includes('продаж')) {
    template = templates.ecommerce;
  } else if (desc.includes('блог') || desc.includes('стать') || desc.includes('новост') || desc.includes('пост')) {
    template = templates.blog;
  } else if (desc.includes('соц') || desc.includes('чат') || desc.includes('лента') || desc.includes('друг')) {
    template = templates.social;
  }

  return {
    name: template.kind === 'no-code-builder' ? template.name : generateProjectName(description, template.name),
    description: normalizeText(description),
    stack,
    kind: template.kind,
    pages: [...template.pages],
    components: [...template.components],
    apiRoutes: [...template.apiRoutes],
    databaseSchema: [...template.databaseSchema],
    productModules: [...(template.productModules || [])],
    fileTree: [...(template.fileTree || [])]
  };
}

function getSpecializedTemplate(description, stack) {
  if (isNoCodeBuilderIdea(description)) {
    return getFallbackTemplate(description, stack);
  }

  return null;
}

// ==================== IMAGE ANALYSIS ====================
async function analyzePhotoStyle(photoBuffer, contentType = 'image/jpeg') {
  if (!photoBuffer) return null;

  try {
    const base64Photo = photoBuffer.toString('base64');
    const photoDataUrl = `data:${contentType};base64,${base64Photo}`;

    // Use xAI Grok to analyze photo style, colors, and design direction
    const analysisPrompt = `Analyze this design/UI photo and provide:\n1. Dominant color palette (primary, secondary, accent colors in hex)\n2. Design style (minimalist, luxury, playful, corporate, modern, etc.)\n3. Layout style (grid-based, asymmetric, centered, etc.)\n4. Typography impression (bold, elegant, casual, technical, etc.)\n5. Specific UI element style (buttons, cards, inputs recommendation)\n6. Mood and brand feeling (professional, creative, friendly, etc.)\n\nRespond in JSON format:\n{\n  "dominantColors": ["#RRGGBB", ...],\n  "designStyle": "...",\n  "layoutStyle": "...",\n  "typographyStyle": "...",\n  "uiElementStyle": "...",\n  "mood": "...",\n  "recommendations": "..."\n}`;

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: photoDataUrl
            }
          },
          {
            type: 'text',
            text: analysisPrompt
          }
        ]
      }
    ];

    const response = await tryXaiGrokRequest({
      messages,
      max_output_tokens: 500,
      temperature: 0.3
    }, 'ImageAnalysis');

    if (!response) return null;

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.log('[analyzePhotoStyle] JSON parse failed, using raw response');
    }

    return {
      dominantColors: [],
      designStyle: response.split('\n')[0] || 'modern',
      layoutStyle: 'balanced',
      typographyStyle: 'elegant',
      uiElementStyle: 'clean',
      mood: 'professional',
      recommendations: response
    };
  } catch (err) {
    console.log('[analyzePhotoStyle] Error:', err.message);
    return null;
  }
}

async function generateWithAI(description, stack) {
  const fallback = getFallbackTemplate(description, stack);

  const buildResult = (generated) => {
    const modules = normalizeList(generated.productModules, fallback.productModules);
    const apis = normalizeList(generated.apiRoutes, fallback.apiRoutes);
    const comps = normalizeList(generated.components, fallback.components);
    const pricingTiers = Array.isArray(generated.pricingTiers) && generated.pricingTiers.length >= 2
      ? generated.pricingTiers
      : [
          { name: 'Старт', price: '0 ₽/мес', features: ['До 3 проектов', '5 ГБ хранилища', 'Базовые функции', 'Email поддержка'] },
          { name: 'Про', price: '990 ₽/мес', features: ['Безлимит проектов', '50 ГБ хранилища', 'Все функции', 'Приоритет поддержка', 'REST API'] },
          { name: 'Бизнес', price: '3 490 ₽/мес', features: ['Всё из Про', 'Командный доступ', 'Аналитика', 'SLA 99.9%', 'Персональный менеджер'] },
        ];
    const keyStats = Array.isArray(generated.keyStats) && generated.keyStats.length >= 3
      ? generated.keyStats
      : [
          { value: (modules.length || comps.length || 8) + '+', label: 'Возможностей' },
          { value: (apis.length || 10) + '+', label: 'API методов' },
          { value: '99.9%', label: 'Uptime' },
          { value: '<2с', label: 'Время ответа' },
        ];
    return {
      name: normalizeText(generated.name) || fallback.name,
      tagline: normalizeText(generated.tagline) || '',
      targetAudience: normalizeText(generated.targetAudience) || '',
      description: normalizeText(description),
      stack,
      kind: normalizeText(generated.kind) || fallback.kind,
      pages: normalizeList(generated.pages, fallback.pages),
      components: comps,
      apiRoutes: apis,
      databaseSchema: normalizeList(generated.databaseSchema, fallback.databaseSchema),
      productModules: modules,
      pricingTiers,
      keyStats,
      fileTree: normalizeList(generated.fileTree, fallback.fileTree),
    };
  };

  // 🚀 Попытка 1: xAI Grok (ПРЕМИУМ)
  try {
    const xaiGenerated = await tryXaiGrokStructure(description, stack);
    if (xaiGenerated) {
      console.log('[AI Priority] Using xAI Grok for structure');
      return buildResult(xaiGenerated);
    }
  } catch (e) {
    console.log('[AI] xAI Grok structure failed:', e.message.slice(0, 100));
  }

  console.log('xAI structure unavailable — using local template');
  return fallback;
}

function generateNoCodeBuilderCode(structure) {
  const pages = normalizeList(structure.pages, templates.noCodeBuilder.pages);
  const modules = normalizeList(structure.productModules, templates.noCodeBuilder.productModules);
  const routes = normalizeList(structure.apiRoutes, templates.noCodeBuilder.apiRoutes);
  const schemas = normalizeList(structure.databaseSchema, templates.noCodeBuilder.databaseSchema);

  const frontend = `import React, { useState } from 'react';
import './styles.css';

const modules = ${JSON.stringify(modules, null, 2)};
const builderPages = ${JSON.stringify(pages, null, 2)};
const builderRoutes = ${JSON.stringify(routes, null, 2)};
const builderSchemas = ${JSON.stringify(schemas, null, 2)};
const starterTemplates = [
  { id: 'saas', name: 'SaaS Workspace', description: 'Мульти-тенант SaaS с ролями и биллингом' },
  { id: 'marketplace', name: 'Marketplace', description: 'Каталог, карточки и управление заказами' },
  { id: 'crm', name: 'CRM Console', description: 'Лиды, сделки, команды и отчёты' }
];

function StatCard({ label, value, caption }) {
  return (
    <div className="card stat-card">
      <span className="muted-label">{label}</span>
      <strong>{value}</strong>
      <p>{caption}</p>
    </div>
  );
}

function ModuleCard({ title, index }) {
  return (
    <div className="card module-card">
      <span className="module-index">0{index + 1}</span>
      <h3>{title}</h3>
      <p>Готовый модуль в конструкторе проекта с настраиваемым UI и API.</p>
    </div>
  );
}

function App() {
  const [selectedTemplate, setSelectedTemplate] = useState(starterTemplates[0]);
  const [selectedPage, setSelectedPage] = useState(builderPages[0]);

  return (
    <div className="builder-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">No-code Platform</span>
          <h1>NoCode Project Builder</h1>
        </div>
        <button className="primary-button">Publish MVP</button>
      </header>

      <section className="hero-panel">
        <div>
          <h2>Собирай продукт из модулей, а не из пустых файлов.</h2>
          <p>Этот шаблон показывает, как должен выглядеть no-code конструктор проектов: шаблоны, редактор, модели данных и публикация.</p>
        </div>
        <div className="hero-badges">
          <span>Templates</span>
          <span>Visual Editor</span>
          <span>Deploy</span>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Сценарий" value="No-code" caption="Готовый специализированный blueprint" />
        <StatCard label="Страницы" value={builderPages.length} caption="Преднастроенные экраны продукта" />
        <StatCard label="Модули" value={modules.length} caption="Ключевые бизнес-функции" />
      </section>

      <section className="workspace-grid">
        <div className="card templates-panel">
          <div className="section-head">
            <h3>Template library</h3>
            <span>{starterTemplates.length} шаблона</span>
          </div>
          <div className="template-list">
            {starterTemplates.map(template => (
              <button
                key={template.id}
                className={template.id === selectedTemplate.id ? 'template-item active' : 'template-item'}
                onClick={() => setSelectedTemplate(template)}
              >
                <strong>{template.name}</strong>
                <p>{template.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="card editor-panel">
          <div className="section-head">
            <h3>Visual editor</h3>
            <span>{selectedPage}</span>
          </div>
          <div className="editor-layout">
            <aside className="editor-sidebar">
              {builderPages.map(page => (
                <button
                  key={page}
                  className={page === selectedPage ? 'nav-pill active' : 'nav-pill'}
                  onClick={() => setSelectedPage(page)}
                >
                  {page}
                </button>
              ))}
            </aside>
            <div className="editor-canvas">
              <div className="canvas-frame">
                <span className="canvas-tag">Selected template</span>
                <h4>{selectedTemplate.name}</h4>
                <p>Редактируй страницы, подключай блоки, меняй модели данных и публикуй продукт без ручной сборки структуры.</p>
                <ul>
                  {builderRoutes.slice(0, 4).map(route => <li key={route}>{route}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="modules-grid">
        {modules.map((moduleName, index) => <ModuleCard key={moduleName} title={moduleName} index={index} />)}
      </section>

      <section className="card data-panel">
        <div className="section-head">
          <h3>Data and deployment blueprint</h3>
          <span>{builderSchemas.length} сущностей</span>
        </div>
        <div className="code-grid">
          <div>
            <h4>Database</h4>
            <ul>
              {builderSchemas.map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div>
            <h4>Output</h4>
            <ul>
              <li>Клиентское приложение с дашбордом и редактором</li>
              <li>Express API для шаблонов, проектов и публикации</li>
              <li>Mongoose модели для масштабирования после MVP</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;`;

  const backend = `const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const templates = [
  { id: 'saas', name: 'SaaS Workspace', category: 'B2B', blocks: ['Hero', 'Pricing', 'Dashboard shell'] },
  { id: 'marketplace', name: 'Marketplace', category: 'Commerce', blocks: ['Catalog', 'Cart', 'Checkout'] },
  { id: 'crm', name: 'CRM Console', category: 'Operations', blocks: ['Pipeline', 'Tasks', 'Reports'] }
];

const projects = [];
const deployments = [];

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'no-code-builder-api' });
});

app.get('/api/templates', (req, res) => {
  res.json(templates);
});

app.get('/api/projects', (req, res) => {
  res.json(projects);
});

app.post('/api/projects', (req, res) => {
  const project = {
    id: String(Date.now()),
    name: req.body.name || 'Untitled project',
    templateId: req.body.templateId || 'saas',
    status: 'draft',
    layout: [],
    schema: []
  };

  projects.push(project);
  res.status(201).json(project);
});

app.get('/api/projects/:id', (req, res) => {
  const project = projects.find(item => item.id === req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Проект не найден' });
  }

  res.json(project);
});

app.put('/api/projects/:id/layout', (req, res) => {
  const project = projects.find(item => item.id === req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Проект не найден' });
  }

  project.layout = req.body.layout || [];
  res.json(project);
});

app.put('/api/projects/:id/schema', (req, res) => {
  const project = projects.find(item => item.id === req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Проект не найден' });
  }

  project.schema = req.body.schema || [];
  res.json(project);
});

app.post('/api/projects/:id/publish', (req, res) => {
  const project = projects.find(item => item.id === req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Проект не найден' });
  }

  project.status = 'published';
  project.publishedAt = new Date().toISOString();
  res.json(project);
});

app.post('/api/projects/:id/deploy', (req, res) => {
  const project = projects.find(item => item.id === req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Проект не найден' });
  }

  const deployment = {
    id: String(Date.now()),
    projectId: project.id,
    status: 'building',
    url: 'https://preview.example.com/' + project.id
  };

  deployments.push(deployment);
  res.status(201).json(deployment);
});

app.get('/api/deployments/:id/status', (req, res) => {
  const deployment = deployments.find(item => item.id === req.params.id);
  if (!deployment) {
    return res.status(404).json({ error: 'Деплой не найден' });
  }

  res.json({ ...deployment, status: 'ready' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('No-code builder API on port ' + PORT));`;

  const database = `const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
  role: { type: String, default: 'owner' },
  plan: { type: String, default: 'starter' }
}, { timestamps: true });

const ProjectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  status: { type: String, default: 'draft' },
  templateId: { type: String, required: true },
  stack: { type: String, default: 'React + Node.js' }
}, { timestamps: true });

const PageSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  name: { type: String, required: true },
  path: { type: String, required: true },
  sections: [{ type: String }],
  seoTitle: { type: String }
}, { timestamps: true });

const BlockSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  pageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Page', required: true },
  type: { type: String, required: true },
  props: { type: mongoose.Schema.Types.Mixed, default: {} },
  order: { type: Number, default: 0 }
}, { timestamps: true });

const DeploymentSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  target: { type: String, required: true },
  url: { type: String },
  status: { type: String, default: 'queued' },
  deployedAt: { type: Date }
}, { timestamps: true });

module.exports = {
  User: mongoose.model('User', UserSchema),
  Project: mongoose.model('Project', ProjectSchema),
  Page: mongoose.model('Page', PageSchema),
  Block: mongoose.model('Block', BlockSchema),
  Deployment: mongoose.model('Deployment', DeploymentSchema)
};`;

  return { frontend, backend, database };
}

function generateGenericCode(structure) {
  const pages = normalizeList(structure.pages, ['Главная', 'О проекте']);
  const components = normalizeList(structure.components, ['Header', 'Footer']);
  const routes = normalizeList(structure.apiRoutes, ['GET /api/health']);
  const schemas = normalizeList(structure.databaseSchema, ['items (id, name)']);
  const componentShowcase = components
    .map(component => `      <div className="card"><strong>${component}</strong><p>Готовый UI-блок для страницы и пользовательского сценария.</p></div>`)
    .join('\n');
  const pageBlocks = pages
    .map(page => {
      const componentPreview = components
        .slice(0, 3)
        .map(component => `        <li>${component}</li>`)
        .join('\n');

      return `const ${toPascalCase(page)}Page = () => (
  <section className="page-panel">
    <h2>${page}</h2>
    <p>Экран подготовлен на основе описания проекта и может быть расширен реальными данными.</p>
    <ul>
${componentPreview}
    </ul>
  </section>
);`;
    })
    .join('\n\n');
  const navLinks = pages
    .map((page, index) => `          <Link to="${safeRoutePath(page, index)}">${page}</Link>`)
    .join('\n');
  const routeDefinitions = pages
    .map((page, index) => `          <Route path="${safeRoutePath(page, index)}" element={<${toPascalCase(page)}Page />} />`)
    .join('\n');
  const backendRoutes = routes
    .map(route => {
      const parsed = parseRoute(route);
      return `app.${parsed.method}('${parsed.path}', (req, res) => {
  res.json({ ok: true, route: '${route}' });
});`;
    })
    .join('\n\n');
  const schemaBlocks = schemas
    .map(schemaLine => {
      const modelName = toPascalCase(schemaLine.split(' ')[0], 'Entity');
      const fields = parseSchemaFields(schemaLine);
      const fieldLines = fields.length
        ? fields.map(field => `  ${field}: { type: ${inferFieldType(field)}, required: true }`).join(',\n')
        : '  name: { type: String, required: true }';

      return `const ${modelName}Schema = new mongoose.Schema({
${fieldLines}
}, { timestamps: true });

const ${modelName} = mongoose.model('${modelName}', ${modelName}Schema);`;
    })
    .join('\n\n');
  const exportedModels = schemas.map(schemaLine => toPascalCase(schemaLine.split(' ')[0], 'Entity')).join(', ') || 'Entity';

  const frontend = `import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import './styles.css';

${pageBlocks}

const App = () => (
  <BrowserRouter>
    <div className="app-shell">
      <header className="top-nav">
        <div>
          <span className="eyebrow">Generated project</span>
          <h1>${normalizeText(structure.name) || 'Project'}</h1>
        </div>
        <nav className="nav-links">
${navLinks}
        </nav>
      </header>

      <main className="content-grid">
        <section className="showcase-grid">
${componentShowcase}
        </section>
        <Routes>
${routeDefinitions}
        </Routes>
      </main>
    </div>
  </BrowserRouter>
);

export default App;`;

  const backend = `const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

${backendRoutes}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('API listening on ' + PORT));`;

  const database = `const mongoose = require('mongoose');

${schemaBlocks}

module.exports = { ${exportedModels} };`;

  return { frontend, backend, database };
}

function generateFallbackCode(structure) {
  if (structure.kind === 'no-code-builder') {
    return generateNoCodeBuilderCode(structure);
  }

  return generateGenericCode(structure);
}

function generateLitePreviewHtml(project) {
  const title = normalizeText(project?.name) || 'AI Startup Builder Project';
  const description = normalizeText(project?.description) || 'Проект сгенерирован в Lite режиме.';
  const modules = normalizeList(project?.structure?.productModules, ['Базовый лендинг', 'Ключевые фичи', 'Контактная форма']);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root { --bg:#f4f8ff; --card:#fff; --text:#0f172a; --muted:#475569; --accent:#2563eb; }
    body { margin:0; font-family: Inter, sans-serif; background:var(--bg); color:var(--text); }
    .wrap { max-width:960px; margin:0 auto; padding:2rem 1rem; }
    .hero, .card { background:var(--card); border:1px solid #dbe7ff; border-radius:14px; padding:1.2rem; }
    .hero h1 { margin:0 0 .5rem; }
    .hero p { margin:0; color:var(--muted); }
    .grid { margin-top:1rem; display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:.8rem; }
    .card h3 { margin:.2rem 0; color:var(--accent); }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <h1>${title}</h1>
      <p>${description}</p>
      <p style="margin-top:.6rem;color:var(--accent)">Lite AI: упрощенный режим генерации.</p>
    </section>
    <section class="grid">
      ${modules.map(item => `<article class="card"><h3>${item}</h3><p>Секция подготовлена в облегчённой версии генерации.</p></article>`).join('')}
    </section>
  </main>
</body>
</html>`;
}

async function generateFullCode(structure, stack) {
  if (structure.kind === 'no-code-builder') {
    return generateNoCodeBuilderCode(structure);
  }

  // 🚀 Попытка 1: xAI Grok (ПРЕМИУМ КОД)
  try {
    const xaiCode = await tryXaiGrokCode(structure, stack);
    if (xaiCode && xaiCode.frontend && xaiCode.backend) {
      console.log('[Code Gen] ✅ Using xAI Grok');
      return xaiCode;
    }
  } catch (error) {
    console.log('[Code Gen] xAI failed:', error.message.slice(0, 80));
  }

  return generateFallbackCode(structure);
}

function buildReadme(project) {
  const structure = project.structure || {};
  const productModules = normalizeList(structure.productModules);
  const pages = normalizeList(structure.pages);
  const routes = normalizeList(structure.apiRoutes);

  return `# ${project.name}

${project.description}

## Stack

- ${project.stack}
- Client: React
- Server: Express
- Database models: Mongoose

## Product modules

${productModules.map(item => `- ${item}`).join('\n') || '- Core module set'}

## Pages

${pages.map(item => `- ${item}`).join('\n') || '- Landing'}

## API routes

${routes.map(item => `- ${item}`).join('\n') || '- GET /api/health'}

## Local run

1. Install dependencies inside client and server folders.
2. Run server with npm start in server.
3. Run client with npm start in client.

## Notes

Этот пакет экспортирован из AI Startup Builder и служит стартовой базой для реальной разработки.`;
}

function buildRootPackage(projectName) {
  return JSON.stringify({
    name: slugify(projectName),
    private: true,
    scripts: {
      bootstrap: 'npm install --prefix client && npm install --prefix server',
      'dev:client': 'npm --prefix client start',
      'dev:server': 'npm --prefix server start'
    }
  }, null, 2);
}

function buildClientPackage(projectName) {
  return JSON.stringify({
    name: `${slugify(projectName)}-client`,
    version: '1.0.0',
    private: true,
    dependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      'react-router-dom': '^6.15.0',
      'react-scripts': '^5.0.1'
    },
    scripts: {
      start: 'react-scripts start',
      build: 'react-scripts build'
    }
  }, null, 2);
}

function buildServerPackage(projectName) {
  return JSON.stringify({
    name: `${slugify(projectName)}-server`,
    version: '1.0.0',
    main: 'index.js',
    scripts: {
      start: 'node index.js',
      dev: 'nodemon index.js'
    },
    dependencies: {
      cors: '^2.8.5',
      express: '^4.18.2',
      mongoose: '^7.5.0'
    },
    devDependencies: {
      nodemon: '^3.0.1'
    }
  }, null, 2);
}

function buildPublicHtml(projectName) {
  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
}

function buildClientIndexFile() {
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);`;
}

function buildGenericStyles() {
  return `* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #f5f7fb; color: #101828; }
a { color: inherit; text-decoration: none; }
ul { margin: 0; padding-left: 18px; }
.app-shell { min-height: 100vh; }
.top-nav { display: flex; justify-content: space-between; gap: 24px; align-items: center; padding: 24px 32px; background: #ffffff; border-bottom: 1px solid #e4e7ec; }
.eyebrow { display: inline-block; margin-bottom: 8px; color: #475467; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
.top-nav h1 { margin: 0; font-size: 32px; }
.nav-links { display: flex; gap: 12px; flex-wrap: wrap; }
.nav-links a { padding: 10px 14px; background: #eef4ff; border-radius: 999px; color: #175cd3; }
.content-grid { padding: 32px; display: grid; gap: 24px; }
.showcase-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.card { background: #ffffff; border: 1px solid #eaecf0; border-radius: 20px; padding: 20px; box-shadow: 0 8px 24px rgba(16, 24, 40, 0.06); }
.page-panel { background: #ffffff; border-radius: 24px; padding: 28px; border: 1px solid #eaecf0; }
.page-panel h2 { margin-top: 0; }
@media (max-width: 768px) {
  .top-nav { flex-direction: column; align-items: flex-start; }
  .content-grid { padding: 20px; }
}`;
}

function buildNoCodeStyles() {
  return `* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: linear-gradient(180deg, #f5f7fb 0%, #eef2ff 100%); color: #0f172a; }
button { font: inherit; }
ul { margin: 0; padding-left: 18px; }
.builder-shell { min-height: 100vh; padding: 32px; display: grid; gap: 24px; }
.topbar, .hero-panel, .card { background: rgba(255,255,255,0.92); border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 28px; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08); }
.topbar { padding: 28px 32px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.topbar h1 { margin: 8px 0 0; font-size: 40px; line-height: 1.05; }
.eyebrow { color: #475467; text-transform: uppercase; font-size: 12px; letter-spacing: 0.12em; }
.primary-button { background: #111827; color: #fff; border: none; border-radius: 999px; padding: 14px 22px; cursor: pointer; }
.hero-panel { padding: 32px; display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
.hero-panel h2 { margin: 0 0 12px; font-size: 34px; max-width: 620px; }
.hero-panel p { margin: 0; max-width: 620px; color: #475467; }
.hero-badges { display: flex; flex-wrap: wrap; gap: 10px; }
.hero-badges span, .nav-pill { padding: 10px 14px; background: #eef2ff; border: none; border-radius: 999px; color: #3730a3; }
.stats-grid, .modules-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.workspace-grid { display: grid; grid-template-columns: 360px 1fr; gap: 16px; }
.card { padding: 24px; }
.stat-card strong { display: block; margin: 12px 0 6px; font-size: 34px; }
.stat-card p, .muted-label { color: #667085; }
.section-head { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 18px; }
.section-head h3 { margin: 0; font-size: 20px; }
.section-head span { color: #667085; font-size: 14px; }
.template-list, .editor-sidebar { display: grid; gap: 12px; }
.template-item { width: 100%; text-align: left; border: 1px solid #e4e7ec; border-radius: 20px; background: #fff; padding: 16px; cursor: pointer; }
.template-item.active { border-color: #4f46e5; background: #eef2ff; }
.template-item strong { display: block; margin-bottom: 6px; }
.template-item p { margin: 0; color: #667085; }
.editor-layout { display: grid; grid-template-columns: 220px 1fr; gap: 16px; }
.nav-pill { cursor: pointer; text-align: left; }
.nav-pill.active { background: #111827; color: #fff; }
.editor-canvas { min-height: 100%; }
.canvas-frame { min-height: 320px; border-radius: 24px; background: linear-gradient(135deg, #111827 0%, #312e81 100%); color: #fff; padding: 24px; }
.canvas-tag { display: inline-block; margin-bottom: 16px; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,0.16); }
.canvas-frame h4 { margin: 0 0 10px; font-size: 28px; }
.canvas-frame p { margin: 0 0 16px; color: rgba(255,255,255,0.82); }
.module-card { min-height: 180px; }
.module-index { display: inline-flex; margin-bottom: 16px; color: #6366f1; font-weight: 700; }
.module-card h3 { margin: 0 0 8px; }
.module-card p { margin: 0; color: #667085; }
.data-panel .code-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.data-panel h4 { margin-top: 0; }
@media (max-width: 960px) {
  .workspace-grid, .editor-layout { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .builder-shell { padding: 16px; }
  .topbar, .hero-panel { padding: 20px; }
  .topbar { flex-direction: column; align-items: flex-start; }
  .hero-panel { flex-direction: column; }
  .topbar h1 { font-size: 32px; }
  .hero-panel h2 { font-size: 28px; }
}`;
}

// ==================== WEBSITE HTML GENERATION ====================
function generateFallbackHtml(project) {
  const { name, description, structure } = project;
  const pages = normalizeList(structure?.pages, ['Главная', 'Возможности', 'Тарифы', 'О продукте', 'Контакты']);
  const components = normalizeList(structure?.components, []);
  const modules = normalizeList(structure?.productModules, []);
  const apiRoutes = normalizeList(structure?.apiRoutes, []);
  const pricingTiers = Array.isArray(structure?.pricingTiers) ? structure.pricingTiers : [];
  const keyStats = Array.isArray(structure?.keyStats) ? structure.keyStats : [];
  const targetAudience = normalizeText(structure?.targetAudience) || 'команды и стартапы';
  const tagline = normalizeText(structure?.tagline) || shortDesc(description, 70);
  const dv = pickDesignVariant(normalizeText(description) + normalizeText(name));
  const productName = normalizeText(name);
  const slug = productName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zа-яё0-9\-]/gi, '');
  const logoLetter = (productName[0] || 'A').toUpperCase();

  const ICONS_SVG = {
    rocket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    cpu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
    users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  };
  const ICON_KEYS = Object.keys(ICONS_SVG);

  const featureItems = (modules.length >= 3 ? modules : components.length >= 3 ? components : [...modules, ...components]).slice(0, 6);
  while (featureItems.length < 6) featureItems.push(['Масштабируемость', 'Безопасность', 'Интеграции', 'Аналитика', 'Автоматизация', 'Мониторинг'][featureItems.length] || 'Функция');

  const featureDescs = [
    `Надёжная основа для роста — ${featureItems[0].toLowerCase()} масштабируется вместе с вашим бизнесом без потери производительности.`,
    `Умные алгоритмы ${featureItems[1].toLowerCase()} экономят время команды и устраняют ручные операции.`,
    `Полная защита данных и соответствие стандартам безопасности для ${featureItems[2].toLowerCase()}.`,
    `Детальные метрики и отчёты — ${featureItems[3].toLowerCase()} помогает принимать решения на основе данных.`,
    `Бесшовная работа с экосистемой инструментов через ${featureItems[4].toLowerCase()}.`,
    `${featureItems[5]} настраивается под ваш рабочий процесс без написания кода.`,
  ];

  const featureCards = featureItems.map((f, i) => `
    <div class="fc" style="--delay:${i*60}ms">
      <div class="fc-icon-wrap">
        <div class="fc-icon-svg">${ICONS_SVG[ICON_KEYS[i % ICON_KEYS.length]]}</div>
      </div>
      <h3>${f}</h3>
      <p>${featureDescs[i] || 'Ключевая возможность платформы.'}</p>
    </div>`).join('');


  // Stats
  const statsItems = keyStats.length >= 4 ? keyStats : [
    { value: (modules.length || components.length || 8) + '+', label: 'Возможностей' },
    { value: (apiRoutes.length || 12) + '+', label: 'API методов' },
    { value: '99.9%', label: 'Uptime' },
    { value: '<2с', label: 'Время ответа' },
  ];

  // Pricing
  const defaultPricing = [
    { name: 'Старт', price: '0 ₽', period: '/мес', popular: false, features: ['До 3 проектов', '5 ГБ хранилища', 'Базовые функции', 'Email поддержка', 'Документация'] },
    { name: 'Про', price: '990 ₽', period: '/мес', popular: true, features: ['Безлимит проектов', '50 ГБ хранилища', 'Все функции', 'Приоритет поддержка', 'REST API доступ', 'Webhooks'] },
    { name: 'Бизнес', price: '3 490 ₽', period: '/мес', popular: false, features: ['Всё из Про', 'Командный доступ', 'Расширенная аналитика', 'SLA 99.9%', 'Персональный менеджер', 'White-label'] },
  ];
  const tiers = pricingTiers.length >= 2 ? pricingTiers.map((t, i) => ({ ...t, popular: i === 1 })) : defaultPricing;

  // Testimonials
  const tNames = [
    { name: 'Алексей Морозов', role: 'CEO · TechScale', avatar: 'А', photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face&q=80' },
    { name: 'Мария Соколова', role: 'Product Lead · Findev', avatar: 'М', photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&crop=face&q=80' },
    { name: 'Дмитрий Кузнецов', role: 'CTO · NovaSystems', avatar: 'Д', photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=80&h=80&fit=crop&crop=face&q=80' },
  ];
  const tTexts = [
    `${productName} кардинально изменил нашу работу. Производительность выросла на 40% уже в первый месяц.`,
    `Лучший инструмент для ${targetAudience}. Интеграции настроили за день, поддержка реагирует моментально.`,
    `Чистый API, понятная документация. ${productName} — стандарт в нашей инфраструктуре уже полгода.`,
  ];

  // Hero dashboard card SVG
  const sparkPath = 'M0,40 L15,30 L30,35 L45,20 L60,25 L75,10 L90,15 L105,5';
  const heroDashboard = `
    <div class="hero-dashboard">
      <div class="dash-header">
        <div class="dash-logo-sm">${logoLetter}</div>
        <span class="dash-title">${productName} Dashboard</span>
        <span class="dash-badge live">● Live</span>
      </div>
      <div class="dash-metrics">
        ${statsItems.slice(0,3).map((s,i) => `
        <div class="dash-metric">
          <div class="dash-metric-val">${s.value}</div>
          <div class="dash-metric-lbl">${s.label}</div>
          <svg class="spark" viewBox="0 0 110 50" preserveAspectRatio="none">
            <defs><linearGradient id="sg${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="var(--a1)" stop-opacity=".3"/><stop offset="100%" stop-color="var(--a1)" stop-opacity="1"/></linearGradient></defs>
            <polyline points="${sparkPath}" fill="none" stroke="url(#sg${i})" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>`).join('')}
      </div>
      <div class="dash-modules">
        ${featureItems.slice(0,4).map((f,i) => `
        <div class="dash-module-row">
          <div class="dm-dot" style="background:var(--a${(i%2)+1})"></div>
          <span>${f}</span>
          <span class="dm-status">✓ активен</span>
        </div>`).join('')}
      </div>
    </div>`;

  // Hero illustration — abstract SVG mesh
  const meshSvg = `
    <svg class="hero-mesh" viewBox="0 0 480 480" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="mg1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${dv.accent1}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${dv.accent1}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="mg2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${dv.accent2}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${dv.accent2}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="240" cy="240" r="200" fill="url(#mg1)"/>
      <circle cx="320" cy="160" r="120" fill="url(#mg2)"/>
      <circle cx="160" cy="320" r="100" fill="url(#mg1)" opacity=".5"/>
      <g stroke="${dv.accent1}" stroke-opacity="0.12" stroke-width="1">
        <line x1="0" y1="120" x2="480" y2="120"/>
        <line x1="0" y1="240" x2="480" y2="240"/>
        <line x1="0" y1="360" x2="480" y2="360"/>
        <line x1="120" y1="0" x2="120" y2="480"/>
        <line x1="240" y1="0" x2="240" y2="480"/>
        <line x1="360" y1="0" x2="360" y2="480"/>
        <line x1="0" y1="0" x2="480" y2="480"/>
        <line x1="480" y1="0" x2="0" y2="480"/>
      </g>
      <circle cx="240" cy="240" r="100" stroke="${dv.accent1}" stroke-opacity="0.18" stroke-width="1" fill="none" stroke-dasharray="6 6"/>
      <circle cx="240" cy="240" r="160" stroke="${dv.accent2}" stroke-opacity="0.1" stroke-width="1" fill="none" stroke-dasharray="3 9"/>
    </svg>`;

  // Steps
  const stepsData = [
    { num: '01', icon: ICONS_SVG.rocket, title: 'Быстрый старт', desc: `Зарегистрируйтесь и создайте рабочее пространство в ${productName} — занимает меньше минуты.` },
    { num: '02', icon: ICONS_SVG.cpu, title: 'Настройте под себя', desc: `Подключите нужные модули, настройте интеграции и пригласите команду.` },
    { num: '03', icon: ICONS_SVG.chart, title: 'Масштабируйтесь', desc: `Отслеживайте результаты в реальном времени и масштабируйте платформу без ограничений.` },
  ];

  // FAQ
  const faqItems = [
    { q: `Сколько времени нужно на внедрение ${productName}?`, a: `Базовое внедрение занимает от 1 до 3 часов. Наша команда помогает с настройкой и миграцией данных — бесплатно на тарифе Про и выше.` },
    { q: 'Есть ли бесплатный период?', a: `Тариф «Старт» бесплатен навсегда. Для Про и Бизнес доступна 14-дневная пробная версия без ввода карты.` },
    { q: 'Как устроена безопасность данных?', a: `Шифрование TLS 1.3 при передаче, AES-256 при хранении, ежедневные бэкапы, 2FA. Соответствие GDPR и 152-ФЗ.` },
    { q: `Какие интеграции поддерживает ${productName}?`, a: `REST API, Webhooks, SDK для популярных языков. Готовые интеграции: Slack, Telegram, Google Workspace, Jira, GitHub и 40+ сервисов.` },
    { q: 'Можно ли перенести данные из другой системы?', a: `Да — поддерживается импорт через CSV/JSON и прямое подключение к популярным источникам. Менеджер поможет с миграцией.` },
  ];

  // Contact info
  const contactInfo = [
    { icon: ICONS_SVG.globe, label: `${slug}.io` },
    { icon: ICONS_SVG.users, label: `hello@${slug}.io` },
    { icon: ICONS_SVG.target, label: 'Москва · Россия' },
    { icon: ICONS_SVG.zap, label: 'Пн–Пт 9:00–19:00' },
  ];

  // inner sections
  const innerSections = pages.slice(1).map((page, idx) => {
    const i = idx + 1;
    const isContact = /контакт|contact|связ/i.test(page);
    const isAbout = /о нас|about|команд|о продукт/i.test(page);
    const isFaq = /faq|вопрос|помощ/i.test(page);
    const isFeatures = /возможност|функц|features/i.test(page);
    const isPricing = /тариф|цен|pricing|plan/i.test(page);
    const isSteps = /как|шаг|процесс|работ/i.test(page);

    let content = '';
    if (isContact) {
      content = `
        <div class="sec-inner">
          <div class="sec-eyebrow">Контакты</div>
          <h2 class="sec-h2">${page}</h2>
          <p class="sec-sub">Свяжитесь с командой — ответим в течение 24 часов.</p>
          <div class="contact-layout">
            <div class="contact-cards">
              ${contactInfo.map(c => `<div class="cinfo-row"><div class="cinfo-icon">${c.icon}</div><span>${c.label}</span></div>`).join('')}
              <div class="cinfo-social">
                <a onclick="showToast('Telegram — скоро!')">TG</a>
                <a onclick="showToast('VK — скоро!')">VK</a>
                <a onclick="showToast('GitHub — скоро!')">GH</a>
              </div>
            </div>
            <form class="contact-form" onsubmit="handleForm(event)">
              <div class="form-row2">
                <input type="text" placeholder="Имя" class="finput" required/>
                <input type="email" placeholder="Email" class="finput" required/>
              </div>
              <input type="text" placeholder="Тема" class="finput fw" style="margin-bottom:12px"/>
              <textarea placeholder="Расскажите о вашем запросе..." class="ftxt" rows="5" required></textarea>
              <button type="submit" class="btn-p fw-btn">Отправить сообщение <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>
              <div class="form-ok" id="form-success">✓ Сообщение отправлено! Ответим в ближайшее время.</div>
            </form>
          </div>
        </div>`;
    } else if (isAbout) {
      content = `
        <div class="sec-inner">
          <div class="sec-eyebrow">О продукте</div>
          <h2 class="sec-h2">${page}</h2>
          <p class="sec-sub">${shortDesc(description)}</p>
          <div class="about-img-wrap">
            <img src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1040&h=300&fit=crop&q=80" alt="Команда ${productName}" loading="lazy" class="about-img"/>
            <div class="about-img-ov"></div>
            <div class="about-img-caption">Команда ${productName} · ${new Date().getFullYear()}</div>
          </div>
          <div class="stats-band">
            ${statsItems.map(s => `<div class="sb-item"><div class="sb-val">${s.value}</div><div class="sb-lbl">${s.label}</div></div>`).join('')}
          </div>
          <div class="mission-grid">
            <div class="mission-card"><div class="mc-icon">${ICONS_SVG.target}</div><h4>Миссия</h4><p>Помочь ${targetAudience} работать быстрее и умнее — через автоматизацию и качественные инструменты.</p></div>
            <div class="mission-card"><div class="mc-icon">${ICONS_SVG.star}</div><h4>Видение</h4><p>Стать платформой первого выбора для ${targetAudience} на рынке EMEA.</p></div>
            <div class="mission-card"><div class="mc-icon">${ICONS_SVG.shield}</div><h4>Ценности</h4><p>Надёжность, прозрачность, забота о клиенте — принципы которые мы не нарушаем.</p></div>
          </div>
        </div>`;
    } else if (isFaq) {
      content = `
        <div class="sec-inner">
          <div class="sec-eyebrow">FAQ</div>
          <h2 class="sec-h2">${page}</h2>
          <p class="sec-sub">Ответы на самые частые вопросы о ${productName}.</p>
          <div class="faq-list">
            ${faqItems.map((f,i) => `<div class="faq-item" id="fq${i}"><button class="faq-q" onclick="tFaq(${i})">${f.q}<span class="faq-arr"></span></button><div class="faq-a">${f.a}</div></div>`).join('')}
          </div>
        </div>`;
    } else if (isFeatures) {
      content = `
        <div class="sec-inner">
          <div class="sec-eyebrow">Возможности</div>
          <h2 class="sec-h2">${page}</h2>
          <p class="sec-sub">Все инструменты ${productName} — мощные, гибкие, готовые к работе.</p>
          <div class="fc-grid">${featureCards}</div>
        </div>`;
    } else if (isPricing) {
      content = `
        <div class="sec-inner sec-center">
          <div class="sec-eyebrow">Тарифы</div>
          <h2 class="sec-h2">${page}</h2>
          <p class="sec-sub">Начните бесплатно. Масштабируйтесь по мере роста.</p>
          <div class="pricing-grid">
            ${tiers.map(t => `
            <div class="pc${t.popular ? ' pc-pop' : ''}">
              ${t.popular ? '<div class="pc-badge">Популярный выбор</div>' : ''}
              <div class="pc-name">${t.name}</div>
              <div class="pc-price">${t.price}<span class="pc-period">${t.period || '/мес'}</span></div>
              <ul class="pc-feats">${(t.features||[]).map(f=>`<li>${f}</li>`).join('')}</ul>
              <button class="${t.popular?'btn-p':'btn-o'} pc-btn" onclick="showToast('Тариф «${t.name}» — скоро!')">${t.popular ? 'Начать бесплатно' : 'Выбрать'}</button>
            </div>`).join('')}
          </div>
        </div>`;
    } else if (isSteps) {
      content = `
        <div class="sec-inner sec-center">
          <div class="sec-eyebrow">Как это работает</div>
          <h2 class="sec-h2">${page}</h2>
          <p class="sec-sub">Три шага до результата с ${productName}.</p>
          <div class="steps-grid">
            ${stepsData.map(s => `
            <div class="step-card">
              <div class="step-num-badge">${s.num}</div>
              <div class="step-icon-wrap">${s.icon}</div>
              <h3>${s.title}</h3>
              <p>${s.desc}</p>
            </div>`).join('')}
          </div>
        </div>`;
    } else {
      content = `
        <div class="sec-inner">
          <div class="sec-eyebrow">0${i}</div>
          <h2 class="sec-h2">${page}</h2>
          <p class="sec-sub">Раздел «${page}» — возможности платформы ${productName} для вашего бизнеса.</p>
          <div class="fc-grid">${featureCards}</div>
        </div>`;
    }
    return `<section id="sec-${i}" class="psec">${content}</section>`;
  }).join('');

  const apiSec = apiRoutes.length > 0 ? `
    <section id="sec-api" class="psec">
      <div class="sec-inner">
        <div class="sec-eyebrow">Developer API</div>
        <h2 class="sec-h2">Интерфейс разработчика</h2>
        <p class="sec-sub">REST API для интеграции ${productName} с любыми системами.</p>
        <div class="api-list">
          ${apiRoutes.map(r => {
            const pts = r.trim().split(/\s+/);
            const m = (pts[0]||'GET').toUpperCase();
            const p = pts.slice(1).join(' ').split('—')[0].trim() || '/api/resource';
            const d = r.split('—')[1]?.trim() || 'Обработка запроса';
            return `<div class="api-row"><span class="meth m-${m.toLowerCase()}">${m}</span><code class="api-path">${p}</code><span class="api-d">${d}</span></div>`;
          }).join('')}
        </div>
      </div>
    </section>` : '';

  const allPages = apiRoutes.length > 0 ? [...pages, 'API'] : pages;
  const pagesCount = pages.length;

  const navItems = allPages.map((p,i) => {
    const sid = i < pages.length ? i : 'api';
    return `<a class="nl-a" onclick="goTo('${sid}')" data-id="${sid}">${p}</a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${productName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"/>
<style>
:root{
  --bg:${dv.bg};--sf:${dv.surface};--bd:${dv.border};
  --tx:${dv.text};--mt:${dv.muted};
  --a1:${dv.accent1};--a2:${dv.accent2};--a3:${dv.accent3};
  --nav:${dv.navBg};--btn:${dv.btnPrimary};--bsh:${dv.btnPrimaryShadow};
  --hbg:${dv.heroGradient};--hg:${dv.headingGradient};
  /* Shadow system (Apple/Vercel-style) */
  --sh:0 1px 2px rgba(0,0,0,.16),0 6px 20px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.06);
  --sh2:0 4px 10px rgba(0,0,0,.2),0 22px 60px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.09);
  --sh-btn:0 2px 8px rgba(0,0,0,.22),0 6px 20px var(--bsh);
  /* Spacing & shape */
  --r:20px;--rs:14px;--rl:26px;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif;
  background:var(--bg);color:var(--tx);min-height:100vh;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  overflow-x:hidden;line-height:1.5;
}
/* Subtle noise layer like Apple product pages */
body::before{
  content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity:.028;
}
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--a1)50;border-radius:3px}

/* ── Animations ── */
@keyframes fadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes floatY{0%,100%{transform:translateY(0)}50%{transform:translateY(-11px)}}
@keyframes pRing{0%{box-shadow:0 0 0 0 var(--a1)55}70%{box-shadow:0 0 0 12px transparent}100%{box-shadow:0 0 0 0 transparent}}
@keyframes rotSlow{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes shimTxt{0%,100%{opacity:.65}50%{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}

/* Scroll-reveal */
.appear{opacity:0;transform:translateY(22px);transition:opacity .65s cubic-bezier(.16,1,.3,1),transform .65s cubic-bezier(.16,1,.3,1)}
.appear.vis{opacity:1;transform:none}

/* Aurora blobs (Apple / Linear style) */
.au{position:fixed;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0}
.au1{width:550px;height:550px;top:-140px;right:-80px;background:radial-gradient(circle,var(--a1)22,transparent 70%);animation:rotSlow 40s linear infinite}
.au2{width:380px;height:380px;bottom:-90px;left:-60px;background:radial-gradient(circle,var(--a2)18,transparent 70%)}
.au3{width:260px;height:260px;top:40%;right:20%;background:radial-gradient(circle,var(--a2)12,transparent 70%)}

/* ══ NAV (Apple.com style) ══ */
nav{
  position:fixed;top:0;left:0;right:0;z-index:400;height:60px;
  display:flex;align-items:center;justify-content:space-between;padding:0 48px;
  background:var(--nav);
  backdrop-filter:saturate(200%) blur(22px);-webkit-backdrop-filter:saturate(200%) blur(22px);
  border-bottom:1px solid rgba(255,255,255,.05);
  transition:background .3s;
}
.nav-brand{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none}
.nav-logo{
  width:32px;height:32px;border-radius:9px;background:var(--btn);
  display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:900;color:#fff;flex-shrink:0;
  box-shadow:var(--sh-btn);
}
.nav-name{font-size:15px;font-weight:800;background:var(--hg);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-.03em}
.nav-links{display:flex;align-items:center;gap:0}
.nl-a{
  padding:6px 13px;border-radius:8px;font-size:13.5px;font-weight:500;
  color:var(--mt);cursor:pointer;transition:color .14s,background .14s;
  user-select:none;white-space:nowrap;border:none;background:none;
  letter-spacing:-.01em;
}
.nl-a:hover{color:var(--tx);background:rgba(255,255,255,.07)}
.nl-a.active{color:var(--tx);font-weight:600}
.nav-right{display:flex;align-items:center;gap:10px}
.nav-cta{
  padding:8px 18px;border-radius:9px;
  background:var(--btn);color:#fff;
  font-size:13px;font-weight:600;border:none;cursor:pointer;
  box-shadow:var(--sh-btn);
  transition:filter .16s,transform .16s;
  white-space:nowrap;letter-spacing:-.01em;
}
.nav-cta:hover{filter:brightness(1.1);transform:translateY(-1px)}
.nav-mob{
  display:none;background:rgba(255,255,255,.08);border:none;color:var(--tx);
  width:34px;height:34px;border-radius:8px;cursor:pointer;
  font-size:17px;align-items:center;justify-content:center;
}

/* ══ SECTIONS ══ */
.psec{display:none;min-height:calc(100vh - 60px);padding:80px 48px 100px;justify-content:center;align-items:flex-start;margin-top:60px;position:relative;z-index:1}
.psec.show{display:flex;animation:fadeUp .45s cubic-bezier(.16,1,.3,1) both}

/* ══ HERO ══ */
#sec-0{
  flex-direction:row;gap:64px;align-items:center;padding:0 64px;
  background:var(--hbg);min-height:100vh;overflow:hidden;
}
.hero-left{flex:1 1 0;max-width:600px;z-index:2;padding:108px 0 96px}
.hero-eyebrow{
  display:inline-flex;align-items:center;gap:8px;
  padding:5px 14px 5px 8px;border-radius:999px;
  background:var(--a1)16;border:1px solid var(--a1)38;
  font-size:11px;color:var(--a3);font-weight:700;letter-spacing:.07em;
  margin-bottom:28px;text-transform:uppercase;
  animation:shimTxt 3s ease-in-out infinite;
}
.hero-eyebrow-dot{width:6px;height:6px;border-radius:50%;background:var(--a1);animation:pRing 2.5s ease-in-out infinite;flex-shrink:0}
h1.hh1{
  font-size:clamp(50px,6.8vw,92px);font-weight:900;
  line-height:1.01;letter-spacing:-.055em;margin-bottom:24px;
  background:var(--hg);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
}
.hero-sub{
  font-size:18px;font-weight:400;color:var(--mt);
  line-height:1.76;margin-bottom:40px;max-width:520px;letter-spacing:-.012em;
}
.hero-btns{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:48px;align-items:center}
/* Primary button — Apple/TG style */
.btn-p{
  padding:13px 26px;border-radius:10px;border:none;
  background:var(--btn);color:#fff;
  font-size:14px;font-weight:600;cursor:pointer;
  box-shadow:var(--sh-btn);
  transition:filter .16s,transform .16s,box-shadow .16s;
  display:inline-flex;align-items:center;gap:8px;
  white-space:nowrap;letter-spacing:-.012em;
}
.btn-p:hover{filter:brightness(1.1);transform:translateY(-2px);box-shadow:0 8px 28px var(--bsh)}
.btn-p:active{filter:none;transform:none}
/* Ghost button — Telegram/Apple secondary */
.btn-o{
  padding:12px 24px;border-radius:10px;
  border:1.5px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.05);color:var(--tx);
  font-size:14px;font-weight:500;cursor:pointer;
  transition:border-color .16s,background .16s,color .16s;
  white-space:nowrap;letter-spacing:-.012em;
  backdrop-filter:blur(8px);
}
.btn-o:hover{border-color:var(--a1)70;background:var(--a1)0e;color:var(--a3)}
.hero-trust{display:flex;align-items:center;gap:14px;font-size:13px;color:var(--mt);letter-spacing:-.01em}
.trust-avatars{display:flex}
.trust-av{
  width:30px;height:30px;border-radius:50%;
  border:2.5px solid var(--bg);margin-left:-9px;
  display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:700;color:#fff;flex-shrink:0;
}
.trust-av:first-child{margin-left:0}
.hero-trust strong{color:var(--tx)}
.hero-right{flex:0 0 450px;display:flex;flex-direction:column;align-items:center;position:relative;z-index:2}
.hero-mesh{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  width:480px;height:480px;animation:rotSlow 90s linear infinite;opacity:.5;pointer-events:none;
}

/* ── DASHBOARD CARD (floating product preview) ── */
.hero-dashboard{
  background:rgba(255,255,255,.04);
  border-radius:var(--rl);padding:22px;width:100%;
  backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  box-shadow:0 48px 120px rgba(0,0,0,.45),0 8px 24px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.09);
  animation:floatY 7s ease-in-out infinite;
  position:relative;overflow:hidden;
}
.hero-dashboard::before{
  content:'';position:absolute;inset:0;border-radius:inherit;
  background:linear-gradient(130deg,rgba(255,255,255,.07) 0%,transparent 55%);
  pointer-events:none;
}
.dash-header{display:flex;align-items:center;gap:10px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.07)}
.dash-logo-sm{width:27px;height:27px;border-radius:8px;background:var(--btn);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#fff;flex-shrink:0;box-shadow:var(--sh-btn)}
.dash-title{font-size:12.5px;font-weight:700;color:var(--tx);flex:1;letter-spacing:-.015em}
.dash-badge{font-size:10.5px;padding:3px 10px;border-radius:999px;font-weight:600;letter-spacing:.02em}
.dash-badge.live{background:rgba(16,185,129,.15);color:#34d399;border:1px solid rgba(16,185,129,.25)}
.dash-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
.dash-metric{background:rgba(255,255,255,.04);border-radius:12px;padding:11px 10px 7px;overflow:hidden}
.dash-metric-val{font-size:18px;font-weight:800;background:var(--hg);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:2px;letter-spacing:-.03em}
.dash-metric-lbl{font-size:9.5px;color:var(--mt);font-weight:500;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
.spark{width:100%;height:24px;display:block}
.dash-modules{display:flex;flex-direction:column;gap:5px}
.dash-module-row{display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(255,255,255,.03);border-radius:8px;font-size:12px}
.dm-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.dash-module-row span:nth-child(2){flex:1;color:var(--tx);font-weight:500;letter-spacing:-.01em}
.dm-status{font-size:10.5px;color:var(--a1);font-weight:600;letter-spacing:.02em}

/* ══ SECTION BASE ══ */
.sec-inner{max-width:1040px;width:100%;padding-top:16px}
.sec-inner.sec-center{text-align:center;display:flex;flex-direction:column;align-items:center}
.sec-eyebrow{
  display:inline-block;font-size:10.5px;text-transform:uppercase;
  letter-spacing:.16em;color:var(--a1);font-weight:700;
  margin-bottom:16px;padding:4px 14px;border-radius:999px;
  background:var(--a1)14;border:1px solid var(--a1)32;
}
h2.sec-h2{
  font-size:clamp(32px,4.8vw,64px);font-weight:900;
  letter-spacing:-.05em;line-height:1.04;margin-bottom:20px;
  background:var(--hg);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
}
.sec-sub{
  font-size:17px;font-weight:400;color:var(--mt);
  line-height:1.76;margin-bottom:56px;max-width:640px;letter-spacing:-.012em;
}

/* ══ FEATURE CARDS (Google Material 3 elevation) ══ */
.fc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;width:100%}
.fc{
  background:var(--sf);border-radius:var(--r);padding:28px 26px;
  transition:transform .28s cubic-bezier(.16,1,.3,1),box-shadow .28s;
  cursor:default;box-shadow:var(--sh);
  animation:fadeUp .55s cubic-bezier(.16,1,.3,1) both;
  animation-delay:var(--delay,0ms);
}
.fc:hover{transform:translateY(-7px);box-shadow:var(--sh2)}
.fc-icon-wrap{
  width:52px;height:52px;border-radius:16px;
  background:linear-gradient(145deg,var(--a1)28,var(--a2)18);
  display:flex;align-items:center;justify-content:center;
  margin-bottom:20px;
  box-shadow:0 4px 18px var(--a1)28;
}
.fc-icon-svg{width:22px;height:22px}
.fc-icon-svg svg{width:100%;height:100%;stroke:var(--a1)}
.fc h3{font-size:16px;font-weight:700;margin-bottom:10px;color:var(--tx);letter-spacing:-.025em}
.fc p{font-size:13.5px;color:var(--mt);line-height:1.72;letter-spacing:-.005em}

/* ══ STATS BAND ══ */
.stats-band{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;width:100%;margin-bottom:52px}
.sb-item{
  background:var(--sf);border-radius:var(--r);padding:28px 20px;text-align:center;
  transition:transform .28s,box-shadow .28s;cursor:default;box-shadow:var(--sh);
}
.sb-item:hover{transform:translateY(-5px);box-shadow:var(--sh2)}
.sb-val{
  font-size:38px;font-weight:900;letter-spacing:-.04em;line-height:1.1;margin-bottom:8px;
  background:var(--btn);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
}
.sb-lbl{font-size:12.5px;color:var(--mt);font-weight:500;letter-spacing:-.01em}

/* ══ MISSION ══ */
.mission-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;width:100%}
.mission-card{background:var(--sf);border-radius:var(--r);padding:28px;transition:transform .28s,box-shadow .28s;box-shadow:var(--sh)}
.mission-card:hover{transform:translateY(-5px);box-shadow:var(--sh2)}
.mc-icon{width:48px;height:48px;border-radius:14px;background:linear-gradient(145deg,var(--a1)28,var(--a2)18);display:flex;align-items:center;justify-content:center;margin-bottom:18px;box-shadow:0 4px 18px var(--a1)28}
.mc-icon svg{width:20px;height:20px;stroke:var(--a1)}
.mission-card h4{font-size:15.5px;font-weight:700;margin-bottom:10px;color:var(--tx);letter-spacing:-.025em}
.mission-card p{font-size:13.5px;color:var(--mt);line-height:1.7}

/* ══ STEPS ══ */
.steps-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;width:100%;position:relative}
.steps-grid::after{content:'';position:absolute;top:72px;left:22%;right:22%;height:1px;background:linear-gradient(90deg,transparent,var(--a1)50,transparent);pointer-events:none}
.step-card{
  background:var(--sf);border-radius:var(--r);padding:32px 26px;text-align:center;
  transition:transform .28s cubic-bezier(.16,1,.3,1),box-shadow .28s;position:relative;
  box-shadow:var(--sh);
}
.step-card:hover{transform:translateY(-7px);box-shadow:var(--sh2)}
.step-num-badge{
  position:absolute;top:-14px;left:50%;transform:translateX(-50%);
  background:var(--btn);color:#fff;font-size:10.5px;font-weight:800;
  padding:4px 14px;border-radius:999px;letter-spacing:.08em;
  box-shadow:0 4px 14px var(--bsh);
}
.step-icon-wrap{
  width:60px;height:60px;border-radius:18px;
  background:linear-gradient(145deg,var(--a1)28,var(--a2)18);
  display:flex;align-items:center;justify-content:center;
  margin:20px auto 20px;box-shadow:0 6px 22px var(--a1)28;
}
.step-icon-wrap svg{width:24px;height:24px;stroke:var(--a1)}
.step-card h3{font-size:16.5px;font-weight:700;margin-bottom:10px;color:var(--tx);letter-spacing:-.025em}
.step-card p{font-size:13.5px;color:var(--mt);line-height:1.7}

/* ══ PRICING (Kaspi / TG premium style) ══ */
.pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;width:100%;margin-top:8px;align-items:center}
.pc{
  background:var(--sf);border-radius:var(--rl);padding:32px 28px;
  display:flex;flex-direction:column;gap:22px;position:relative;
  transition:transform .28s cubic-bezier(.16,1,.3,1),box-shadow .28s;
  box-shadow:var(--sh);
}
.pc:hover{transform:translateY(-4px);box-shadow:var(--sh2)}
/* Popular card — scale up, glow ring */
.pc-pop{
  background:linear-gradient(150deg,var(--a1)12,var(--a2)07);
  box-shadow:0 0 0 1.5px var(--a1)60,0 0 48px var(--a1)22,0 32px 80px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.1);
  transform:scale(1.05);z-index:1;
}
.pc-pop:hover{transform:scale(1.05) translateY(-4px)}
.pc-badge{
  position:absolute;top:-15px;left:50%;transform:translateX(-50%);
  background:var(--btn);color:#fff;font-size:11px;font-weight:700;
  padding:5px 18px;border-radius:999px;white-space:nowrap;letter-spacing:.06em;
  box-shadow:0 4px 14px var(--bsh);
}
.pc-name{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:var(--mt)}
.pc-price{
  font-size:44px;font-weight:900;letter-spacing:-.05em;line-height:1;
  background:var(--hg);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  display:flex;align-items:flex-end;gap:4px;
}
.pc-period{font-size:14px;font-weight:500;-webkit-text-fill-color:var(--mt);color:var(--mt);margin-bottom:6px;letter-spacing:0}
.pc-feats{list-style:none;display:flex;flex-direction:column;gap:11px;flex:1}
.pc-feats li{font-size:14px;color:var(--mt);padding-left:22px;position:relative;line-height:1.5;letter-spacing:-.005em}
.pc-feats li::before{content:"✓";position:absolute;left:0;color:var(--a1);font-weight:800;font-size:12.5px}
.pc-btn{width:100%;justify-content:center;margin-top:auto}

/* ══ TESTIMONIALS (Linear / Apple style) ══ */
.test-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;width:100%}
.tcard{
  background:var(--sf);border-radius:var(--r);padding:28px;
  transition:transform .28s,box-shadow .28s;
  display:flex;flex-direction:column;gap:16px;box-shadow:var(--sh);
}
.tcard:hover{transform:translateY(-5px);box-shadow:var(--sh2)}
.tcard-stars{color:#f59e0b;font-size:13px;letter-spacing:2px}
.tcard-text{font-size:14.5px;color:var(--tx);line-height:1.75;flex:1;letter-spacing:-.012em;opacity:.9}
.tcard-author{display:flex;align-items:center;gap:13px;padding-top:14px;border-top:1px solid rgba(255,255,255,.07)}
.tcard-av{
  width:44px;height:44px;border-radius:50%;background:var(--btn);
  display:flex;align-items:center;justify-content:center;
  font-weight:800;font-size:16px;color:#fff;flex-shrink:0;
  box-shadow:0 4px 14px var(--bsh);overflow:hidden;padding:0;
}
.tcard-av img{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block}
.tcard-name{font-size:13.5px;font-weight:700;color:var(--tx);letter-spacing:-.02em}
.tcard-role{font-size:12px;color:var(--mt);margin-top:2px;letter-spacing:-.01em}

/* ══ FAQ ══ */
.faq-list{width:100%;display:flex;flex-direction:column;gap:7px}
.faq-item{background:var(--sf);border-radius:var(--rs);overflow:hidden;transition:box-shadow .2s;box-shadow:var(--sh)}
.faq-item.open{box-shadow:0 0 0 1.5px var(--a1)55,var(--sh)}
.faq-q{
  width:100%;display:flex;justify-content:space-between;align-items:center;
  padding:18px 22px;background:none;border:none;color:var(--tx);
  font-size:15px;font-weight:600;cursor:pointer;text-align:left;
  gap:16px;font-family:inherit;letter-spacing:-.022em;
}
.faq-q:hover{background:rgba(255,255,255,.03)}
/* CSS-only chevron (Google/Apple style) */
.faq-arr{
  width:24px;height:24px;border-radius:50%;flex-shrink:0;
  background:var(--a1)18;display:flex;align-items:center;justify-content:center;
  transition:transform .28s cubic-bezier(.16,1,.3,1),background .2s;
}
.faq-arr::before{
  content:'';display:block;width:8px;height:8px;border-right:2px solid var(--a1);border-bottom:2px solid var(--a1);
  transform:rotate(45deg) translateY(-2px);transition:transform .28s;
}
.faq-item.open .faq-arr{transform:rotate(180deg);background:var(--a1)28}
.faq-item.open .faq-arr::before{transform:rotate(45deg) translateY(-2px)}
.faq-a{max-height:0;overflow:hidden;padding:0 22px;color:var(--mt);font-size:14.5px;line-height:1.76;transition:max-height .36s ease,padding .36s ease;letter-spacing:-.008em}
.faq-item.open .faq-a{max-height:260px;padding:0 22px 22px}

/* ══ CONTACT ══ */
.contact-layout{display:grid;grid-template-columns:290px 1fr;gap:28px;width:100%}
.contact-cards{display:flex;flex-direction:column;gap:9px}
.cinfo-row{
  display:flex;align-items:center;gap:13px;padding:14px 16px;
  background:var(--sf);border-radius:var(--rs);
  font-size:14px;color:var(--tx);
  transition:transform .2s,box-shadow .2s;box-shadow:var(--sh);letter-spacing:-.012em;
}
.cinfo-row:hover{transform:translateX(4px);box-shadow:var(--sh2)}
.cinfo-icon{width:38px;height:38px;border-radius:11px;background:linear-gradient(145deg,var(--a1)28,var(--a2)18);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 14px var(--a1)28}
.cinfo-icon svg{width:16px;height:16px;stroke:var(--a1)}
.cinfo-social{display:flex;gap:8px;margin-top:6px}
.cinfo-social a{padding:8px 16px;background:var(--sf);border-radius:9px;font-size:12px;font-weight:700;color:var(--mt);cursor:pointer;transition:all .2s;box-shadow:var(--sh);letter-spacing:.02em}
.cinfo-social a:hover{color:var(--a1);transform:translateY(-2px);box-shadow:var(--sh2)}
.contact-form{display:flex;flex-direction:column;gap:12px}
.form-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.finput{
  padding:13px 16px;background:var(--sf);border-radius:12px;
  border:1.5px solid transparent;color:var(--tx);font-size:14px;outline:none;
  transition:border-color .18s,box-shadow .18s;font-family:inherit;width:100%;
  box-shadow:var(--sh);letter-spacing:-.012em;
}
.finput:focus{border-color:var(--a1)70;box-shadow:0 0 0 4px var(--a1)16,var(--sh)}
.finput::placeholder{color:var(--mt)}
.ftxt{
  padding:13px 16px;background:var(--sf);border-radius:12px;
  border:1.5px solid transparent;color:var(--tx);font-size:14px;outline:none;
  transition:border-color .18s,box-shadow .18s;font-family:inherit;
  resize:vertical;min-height:130px;width:100%;
  box-shadow:var(--sh);letter-spacing:-.012em;
}
.ftxt:focus{border-color:var(--a1)70;box-shadow:0 0 0 4px var(--a1)16,var(--sh)}
.ftxt::placeholder{color:var(--mt)}
.fw,.fw-btn{width:100%}
.fw-btn{justify-content:center}
.form-ok{display:none;padding:14px 16px;background:rgba(16,185,129,.1);border-radius:12px;color:#34d399;font-size:14px;text-align:center;margin-top:4px;border:1px solid rgba(16,185,129,.25);letter-spacing:-.012em}

/* ══ API ══ */
.api-list{display:flex;flex-direction:column;gap:7px;width:100%}
.api-row{
  display:flex;align-items:center;gap:14px;padding:13px 18px;
  background:var(--sf);border-radius:var(--rs);
  font-family:'SFMono-Regular','Menlo','Consolas',monospace;font-size:13px;
  transition:transform .2s,box-shadow .2s;box-shadow:var(--sh);
}
.api-row:hover{transform:translateX(4px);box-shadow:var(--sh2)}
.meth{padding:4px 11px;border-radius:7px;font-weight:700;font-size:11px;min-width:56px;text-align:center;letter-spacing:.06em;flex-shrink:0}
.m-get{background:rgba(34,197,94,.14);color:#4ade80}
.m-post{background:var(--a1)20;color:var(--a3)}
.m-put,.m-patch{background:rgba(251,191,36,.14);color:#fbbf24}
.m-delete{background:rgba(239,68,68,.14);color:#f87171}
.api-path{color:var(--tx);flex:1;font-family:inherit;font-size:13px}
.api-d{color:var(--mt);font-family:'Inter',system-ui,sans-serif;font-size:12px;font-style:italic}

/* ══ CTA STRIP (Apple product page style) ══ */
.cta-strip{
  padding:110px 48px;
  background:
    radial-gradient(ellipse 80% 120% at 50% -20%,var(--a1)24,transparent 60%),
    radial-gradient(ellipse 50% 80% at 100% 100%,var(--a2)10,transparent 50%),
    var(--bg);
  border-top:1px solid rgba(255,255,255,.06);
  display:flex;justify-content:center;align-items:center;
  position:relative;overflow:hidden;
}
.cta-strip::after{content:'';position:absolute;inset:0;background:linear-gradient(0deg,var(--bg),transparent 30%);pointer-events:none}
.cta-inner{max-width:740px;text-align:center;position:relative;z-index:1}
.cta-inner h2{font-size:clamp(34px,4.5vw,58px);font-weight:900;letter-spacing:-.052em;margin-bottom:18px;background:var(--hg);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.06}
.cta-inner p{font-size:17px;color:var(--mt);margin-bottom:36px;line-height:1.76;letter-spacing:-.012em}
.cta-btns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}

/* ══ HERO BG PHOTO ══ */
.hero-bg-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.045;pointer-events:none;z-index:0;filter:saturate(0) brightness(.6)}

/* ══ ABOUT PHOTO ══ */
.about-img-wrap{border-radius:var(--r);overflow:hidden;margin-bottom:44px;position:relative;box-shadow:var(--sh2)}
.about-img{width:100%;height:280px;object-fit:cover;display:block;filter:brightness(.6) saturate(1.2)}
.about-img-ov{position:absolute;inset:0;background:linear-gradient(135deg,var(--a1)28,var(--a2)12,transparent 60%);pointer-events:none}
.about-img-caption{position:absolute;bottom:14px;left:20px;font-size:11px;color:rgba(255,255,255,.55);font-weight:500;letter-spacing:.04em;text-transform:uppercase}

/* ══ PRODUCT PREVIEW ══ */
.preview-block{padding:80px 48px;max-width:1136px;margin:0 auto}
.preview-inner{text-align:center}
.preview-frame{border-radius:var(--rl);overflow:hidden;box-shadow:0 60px 120px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.07);position:relative}
.preview-bar{background:rgba(255,255,255,.05);padding:10px 18px;display:flex;align-items:center;gap:7px;border-bottom:1px solid rgba(255,255,255,.07)}
.pb-dot{width:11px;height:11px;border-radius:50%;display:inline-block;flex-shrink:0}
.pb-url{flex:1;text-align:center;font-size:11.5px;color:var(--mt);letter-spacing:.01em}
.preview-img{width:100%;display:block;height:auto;filter:brightness(.8) saturate(1.1)}

/* ══ TESTIMONIALS BLOCK ══ */
.test-block{padding:80px 48px;max-width:1136px;margin:0 auto}
.test-block-header{text-align:center;margin-bottom:56px}
.test-block-header h2{font-size:clamp(32px,4.2vw,54px);font-weight:900;letter-spacing:-.05em;background:var(--hg);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-top:14px;line-height:1.06}

/* ══ FOOTER (Apple.com style) ══ */
footer{
  padding:64px 48px 48px;
  border-top:1px solid rgba(255,255,255,.06);
  display:grid;grid-template-columns:1.5fr repeat(3,1fr);gap:56px;align-items:start;
}
.ft-brand{display:flex;align-items:center;gap:11px;margin-bottom:16px}
.ft-logo{width:34px;height:34px;border-radius:10px;background:var(--btn);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#fff;box-shadow:var(--sh-btn)}
.ft-name{font-size:15px;font-weight:800;background:var(--hg);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-.03em}
.ft-desc{font-size:13.5px;color:var(--mt);line-height:1.72;margin-bottom:22px;max-width:280px;letter-spacing:-.01em}
.ft-copy{font-size:11.5px;color:var(--mt);opacity:.44;letter-spacing:-.01em}
.ft-col h5{font-size:10px;text-transform:uppercase;letter-spacing:.16em;color:var(--a1);font-weight:700;margin-bottom:18px}
.ft-col a{display:block;font-size:13.5px;color:var(--mt);cursor:pointer;transition:color .14s,transform .14s;margin-bottom:12px;letter-spacing:-.012em}
.ft-col a:hover{color:var(--tx);transform:translateX(3px)}

/* ══ TOAST (TG / Apple notification style) ══ */
.toast{
  position:fixed;bottom:28px;right:28px;padding:13px 18px;
  background:rgba(255,255,255,.07);border:1px solid var(--a1)42;border-radius:14px;
  font-size:13.5px;color:var(--tx);letter-spacing:-.012em;
  backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
  z-index:999;opacity:0;transform:translateY(18px);
  transition:all .34s cubic-bezier(.16,1,.3,1);
  pointer-events:none;max-width:340px;
  box-shadow:0 16px 52px rgba(0,0,0,.38),0 2px 8px rgba(0,0,0,.2);
}
.toast.show{opacity:1;transform:translateY(0)}

/* ══ RESPONSIVE ══ */
@media(max-width:1200px){
  .fc-grid{grid-template-columns:repeat(2,1fr)}
  .pricing-grid{grid-template-columns:1fr 1fr}
  .test-grid{grid-template-columns:1fr 1fr}
  footer{grid-template-columns:1fr 1fr;gap:36px}
}
@media(max-width:960px){
  #sec-0{flex-direction:column;gap:44px;padding:96px 32px 80px;align-items:center}
  .hero-left{padding:0;max-width:100%}
  .hero-right{width:100%;flex:none;max-width:520px}
  .hero-mesh{width:340px;height:340px}
  .stats-band{grid-template-columns:repeat(2,1fr)}
  .steps-grid{grid-template-columns:1fr 1fr}
  .steps-grid::after{display:none}
  .mission-grid{grid-template-columns:1fr 1fr}
  .contact-layout{grid-template-columns:1fr}
  nav{padding:0 24px}
  .psec{padding:80px 32px 80px}
  .cta-strip,.test-block{padding:80px 32px}
  footer{padding:48px 32px 40px}
}
@media(max-width:680px){
  nav{padding:0 20px}
  .nav-links{display:none}
  .nav-links.mob-open{display:flex;flex-direction:column;position:fixed;top:60px;left:0;right:0;padding:16px 20px 20px;background:var(--nav);border-bottom:1px solid rgba(255,255,255,.06);z-index:399;backdrop-filter:blur(24px);gap:3px}
  .nav-mob{display:flex}
  .nav-right .nav-cta{display:none}
  #sec-0{padding:84px 20px 64px}
  .psec{padding:80px 20px 80px}
  h1.hh1{font-size:clamp(42px,11.5vw,64px)}
  .fc-grid{grid-template-columns:1fr}
  .dash-metrics{grid-template-columns:1fr 1fr}
  .stats-band{grid-template-columns:1fr 1fr}
  .steps-grid{grid-template-columns:1fr}
  .pricing-grid{grid-template-columns:1fr}
  .pc-pop{transform:none}
  .pc-pop:hover{transform:translateY(-4px)}
  .test-grid{grid-template-columns:1fr}
  .mission-grid{grid-template-columns:1fr}
  .form-row2{grid-template-columns:1fr}
  .cta-strip,.test-block{padding:64px 20px}
  footer{grid-template-columns:1fr 1fr;gap:24px;padding:40px 20px 32px}
}
</style>
</head>
<body>

<!-- Aurora background blobs (Apple.com / Linear style) -->
<div class="au au1" aria-hidden="true"></div>
<div class="au au2" aria-hidden="true"></div>
<div class="au au3" aria-hidden="true"></div>

<!-- NAV -->
<nav id="topnav">
  <div class="nav-brand" onclick="goTo(0)">
    <div class="nav-logo">${logoLetter}</div>
    <span class="nav-name">${productName}</span>
  </div>
  <div class="nav-links" id="navlinks">${navItems}</div>
  <div class="nav-right">
    <button class="nav-cta" onclick="goTo(${pagesCount}-1)">Начать бесплатно</button>
    <button class="nav-mob" id="mob-btn" onclick="toggleMob()" aria-label="Меню">☰</button>
  </div>
</nav>

<!-- HERO -->
<section id="sec-0" class="psec show">
  <img class="hero-bg-img" src="https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1920&h=1080&fit=crop&q=30" alt="" aria-hidden="true" loading="eager"/>
  <div class="hero-left">
    <div class="hero-eyebrow"><span class="hero-eyebrow-dot"></span>Новый стандарт · ${dv.label}</div>
    <h1 class="hh1">${productName}</h1>
    <p class="hero-sub">${tagline}</p>
    <div class="hero-btns">
      <button class="btn-p" onclick="goTo(1)">Начать бесплатно <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>
      <button class="btn-o" onclick="goTo(Math.min(2,${pagesCount}-1))">Смотреть демо</button>
    </div>
    <div class="hero-trust">
      <div class="trust-avatars">
        <div class="trust-av" style="background:linear-gradient(135deg,#6366f1,#818cf8)">А</div>
        <div class="trust-av" style="background:linear-gradient(135deg,#06b6d4,#38bdf8)">М</div>
        <div class="trust-av" style="background:linear-gradient(135deg,#10b981,#34d399)">Д</div>
        <div class="trust-av" style="background:linear-gradient(135deg,#f59e0b,#fbbf24)">К</div>
      </div>
      <span>Уже <strong>2 000+</strong> команд используют ${productName}</span>
    </div>
  </div>
  <div class="hero-right">
    <svg class="hero-mesh" viewBox="0 0 480 480" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="mg1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${dv.accent1}" stop-opacity=".42"/>
          <stop offset="100%" stop-color="${dv.accent1}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="mg2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${dv.accent2}" stop-opacity=".28"/>
          <stop offset="100%" stop-color="${dv.accent2}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="240" cy="240" r="200" fill="url(#mg1)"/>
      <circle cx="320" cy="155" r="125" fill="url(#mg2)"/>
      <circle cx="155" cy="320" r="95" fill="url(#mg1)" opacity=".45"/>
      <g stroke="${dv.accent1}" stroke-opacity=".08" stroke-width=".8">
        <line x1="0" y1="120" x2="480" y2="120"/><line x1="0" y1="240" x2="480" y2="240"/>
        <line x1="0" y1="360" x2="480" y2="360"/><line x1="120" y1="0" x2="120" y2="480"/>
        <line x1="240" y1="0" x2="240" y2="480"/><line x1="360" y1="0" x2="360" y2="480"/>
      </g>
      <circle cx="240" cy="240" r="108" stroke="${dv.accent1}" stroke-opacity=".14" stroke-width="1" fill="none" stroke-dasharray="5 8"/>
      <circle cx="240" cy="240" r="168" stroke="${dv.accent2}" stroke-opacity=".08" stroke-width=".8" fill="none" stroke-dasharray="2 10"/>
    </svg>
    ${heroDashboard}
  </div>
</section>

<!-- INNER SECTIONS -->
${innerSections}
${apiSec}

<!-- PRODUCT PREVIEW -->
<div class="preview-block">
  <div class="preview-inner">
    <div class="sec-eyebrow" style="margin:0 auto 16px;display:table">Интерфейс</div>
    <h2 class="sec-h2" style="text-align:center;margin-bottom:14px">Продуманный до деталей</h2>
    <p style="text-align:center;font-size:17px;color:var(--mt);margin-bottom:44px;letter-spacing:-.012em">Чистый дизайн — работайте комфортно с первого дня.</p>
    <div class="preview-frame">
      <div class="preview-bar"><span class="pb-dot" style="background:#ff5f57"></span><span class="pb-dot" style="background:#febc2e"></span><span class="pb-dot" style="background:#28c840"></span><span class="pb-url">${slug}.io/dashboard</span></div>
      <img src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&h=620&fit=crop&q=80" alt="Интерфейс ${productName}" loading="lazy" class="preview-img"/>
    </div>
  </div>
</div>

<!-- CTA STRIP -->
<div class="cta-strip">
  <div class="cta-inner">
    <div class="sec-eyebrow" style="margin:0 auto 18px">Готовы к старту?</div>
    <h2>Попробуйте ${productName} бесплатно</h2>
    <p>Тариф Старт навсегда бесплатен. Про и Бизнес — 14 дней без карты. Отмена в один клик.</p>
    <div class="cta-btns">
      <button class="btn-p" onclick="goTo(${pagesCount}-1)">Начать бесплатно <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>
      <button class="btn-o" onclick="goTo(1)">Узнать больше</button>
    </div>
  </div>
</div>

<!-- TESTIMONIALS -->
<div class="test-block">
  <div class="test-block-header">
    <div class="sec-eyebrow" style="margin:0 auto 14px">Отзывы клиентов</div>
    <h2>Нам доверяют профессионалы</h2>
  </div>
  <div class="test-grid">
    ${tNames.map((t,i) => `
    <div class="tcard appear">
      <div class="tcard-stars">★★★★★</div>
      <p class="tcard-text">«${tTexts[i]}»</p>
      <div class="tcard-author">
        <div class="tcard-av"><img src="${t.photo}" alt="${t.name}" loading="lazy" width="44" height="44" onerror="this.outerHTML='${t.avatar}'"/></div>
        <div>
          <div class="tcard-name">${t.name}</div>
          <div class="tcard-role">${t.role}</div>
        </div>
      </div>
    </div>`).join('')}
  </div>
</div>

<!-- FOOTER -->
<footer>
  <div>
    <div class="ft-brand">
      <div class="ft-logo">${logoLetter}</div>
      <span class="ft-name">${productName}</span>
    </div>
    <p class="ft-desc">${shortDesc(tagline || description, 130)}</p>
    <div class="ft-copy">© 2026 ${productName} · AI Startup Builder</div>
  </div>
  <div class="ft-col">
    <h5>Продукт</h5>
    ${pages.slice(0,5).map((p,i) => `<a onclick="goTo(${i})">${p}</a>`).join('')}
  </div>
  <div class="ft-col">
    <h5>Компания</h5>
    <a onclick="showToast('Блог — скоро!')">Блог</a>
    <a onclick="showToast('Документация — скоро!')">Документация</a>
    <a onclick="showToast('Карьера — скоро!')">Карьера</a>
    <a onclick="showToast('Партнёрам — скоро!')">Партнёрам</a>
    <a onclick="showToast('Пресс-кит — скоро!')">Пресс-кит</a>
  </div>
  <div class="ft-col">
    <h5>Поддержка</h5>
    <a onclick="goTo(${pagesCount}-1)">Контакты</a>
    <a onclick="showToast('Status — скоро!')">Status page</a>
    <a onclick="showToast('Docs — скоро!')">Документация</a>
    <a onclick="showToast('Security — скоро!')">Безопасность</a>
    <a onclick="showToast('GDPR — скоро!')">GDPR / 152-ФЗ</a>
  </div>
</footer>

<div class="toast" id="toast-msg"></div>

<script>(function(){
  function goTo(rawId){
    var id=String(rawId);
    document.querySelectorAll('.psec').forEach(function(s){s.classList.remove('show')});
    var el=document.getElementById('sec-'+id);
    if(el){el.classList.add('show');window.scrollTo({top:0,behavior:'smooth'})}
    var idx=isNaN(parseInt(id))?-1:parseInt(id);
    document.querySelectorAll('.nl-a').forEach(function(a,j){a.classList.toggle('active',j===idx)});
    var nl=document.getElementById('navlinks');if(nl)nl.classList.remove('mob-open');
    var mb=document.getElementById('mob-btn');if(mb)mb.textContent='☰';
  }
  window.goTo=goTo;

  window.toggleMob=function(){
    var nl=document.getElementById('navlinks'),mb=document.getElementById('mob-btn');
    if(!nl)return;
    var open=nl.classList.toggle('mob-open');
    if(mb)mb.textContent=open?'✕':'☰';
  };

  window.tFaq=function(i){
    var el=document.getElementById('fq'+i);if(!el)return;
    var was=el.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(function(f){f.classList.remove('open')});
    if(!was)el.classList.add('open');
  };

  window.handleForm=function(e){
    e.preventDefault();
    var btn=e.target.querySelector('button[type=submit]');
    var ok=document.getElementById('form-success');
    if(btn){btn.textContent='Отправка...';btn.disabled=true;}
    setTimeout(function(){
      if(btn){btn.innerHTML='Отправить сообщение <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';btn.disabled=false;}
      e.target.reset();
      if(ok){ok.style.display='block';setTimeout(function(){ok.style.display='none'},5000);}
      showToast('✓ Сообщение отправлено!');
    },1400);
  };

  function showToast(msg){
    var t=document.getElementById('toast-msg');if(!t)return;
    t.textContent=msg;t.classList.add('show');
    setTimeout(function(){t.classList.remove('show')},3500);
  }
  window.showToast=showToast;

  /* Scroll-reveal animations (Google / Apple style) */
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){e.target.classList.add('vis');io.unobserve(e.target)}
      });
    },{threshold:0.1,rootMargin:'0px 0px -40px 0px'});
    document.querySelectorAll('.fc,.sb-item,.tcard,.step-card,.pc,.mission-card,.appear').forEach(function(el){
      el.classList.add('appear');io.observe(el);
    });
  }

  document.addEventListener('click',function(e){
    var a=e.target.closest('a');if(a){var h=a.getAttribute('href')||'';if(h&&h!=='#'&&!h.startsWith('javascript'))e.preventDefault();}
  });
  document.addEventListener('submit',function(e){
    if(!e.target.closest('.contact-form'))e.preventDefault();
  });

  goTo(0);
})();
</script>
</body>
</html>`;
}

const DESIGN_VARIANTS = [
  {
    id: 'dark-purple',
    label: 'Темный фиолетовый',
    bg: '#0a0a0f',
    surface: 'rgba(255,255,255,0.07)',
    border: 'rgba(255,255,255,0.08)',
    text: '#f0f0f8',
    muted: '#94a3b8',
    accent1: '#6366f1',
    accent2: '#8b5cf6',
    accent3: '#60a5fa',
    navBg: 'rgba(10,10,15,0.85)',
    heroGradient: 'radial-gradient(ellipse 80% 60% at 60% 40%, rgba(99,102,241,0.18), transparent 70%)',
    cardHover: 'rgba(99,102,241,0.12)',
    btnPrimary: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
    btnPrimaryShadow: 'rgba(99,102,241,0.45)',
    headingGradient: 'linear-gradient(145deg,#fff 30%,#c4b5fd 80%)',
  },
  {
    id: 'dark-cyan',
    label: 'Темный циан',
    bg: '#040d14',
    surface: 'rgba(6,182,212,0.09)',
    border: 'rgba(6,182,212,0.14)',
    text: '#e2f8ff',
    muted: '#7ecfde',
    accent1: '#06b6d4',
    accent2: '#0ea5e9',
    accent3: '#38bdf8',
    navBg: 'rgba(4,13,20,0.88)',
    heroGradient: 'radial-gradient(ellipse 80% 60% at 60% 40%, rgba(6,182,212,0.15), transparent 70%)',
    cardHover: 'rgba(6,182,212,0.12)',
    btnPrimary: 'linear-gradient(135deg,#0ea5e9,#06b6d4)',
    btnPrimaryShadow: 'rgba(14,165,233,0.45)',
    headingGradient: 'linear-gradient(145deg,#fff 30%,#7dd3fc 80%)',
  },
  {
    id: 'dark-emerald',
    label: 'Темный изумрудный',
    bg: '#030c07',
    surface: 'rgba(16,185,129,0.09)',
    border: 'rgba(16,185,129,0.14)',
    text: '#ecfdf5',
    muted: '#6ee7b7',
    accent1: '#10b981',
    accent2: '#059669',
    accent3: '#34d399',
    navBg: 'rgba(3,12,7,0.88)',
    heroGradient: 'radial-gradient(ellipse 80% 60% at 60% 40%, rgba(16,185,129,0.15), transparent 70%)',
    cardHover: 'rgba(16,185,129,0.12)',
    btnPrimary: 'linear-gradient(135deg,#10b981,#059669)',
    btnPrimaryShadow: 'rgba(16,185,129,0.45)',
    headingGradient: 'linear-gradient(145deg,#fff 30%,#6ee7b7 80%)',
  },
  {
    id: 'dark-amber',
    label: 'Темный янтарный',
    bg: '#0f0900',
    surface: 'rgba(245,158,11,0.09)',
    border: 'rgba(245,158,11,0.16)',
    text: '#fffbeb',
    muted: '#fcd34d',
    accent1: '#f59e0b',
    accent2: '#d97706',
    accent3: '#fbbf24',
    navBg: 'rgba(12,9,0,0.9)',
    heroGradient: 'radial-gradient(ellipse 80% 60% at 60% 40%, rgba(245,158,11,0.15), transparent 70%)',
    cardHover: 'rgba(245,158,11,0.12)',
    btnPrimary: 'linear-gradient(135deg,#f59e0b,#ef4444)',
    btnPrimaryShadow: 'rgba(245,158,11,0.5)',
    headingGradient: 'linear-gradient(145deg,#fff 30%,#fde68a 80%)',
  },
];

function pickDesignVariant(seed) {
  // Детерминированный выбор на основе хэша описания
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return DESIGN_VARIANTS[Math.abs(hash) % DESIGN_VARIANTS.length];
}

// ==================== DYNAMIC LAYOUT & DESIGN VARIATION ENGINE ====================
/**
 * 🎨 Advanced Dynamic Layout System
 * Каждая генерация сайта получает уникальную структуру и визуальный стиль
 * AI не копирует шаблоны, а создает осознанные вариации
 */

const LAYOUT_PATTERNS = {
  heroStyles: [
    {
      id: 'split-left',
      name: 'Split Hero Left',
      desc: 'Текст слева, визуал справа, асимметрично',
      prompt: `Hero секция: текст-контент слева (60%), визуальная карточка/модули справа (40%).
Текст: H1 (font-size 52px) слева, подзаголовок, 2 кнопки, левый align.
Справа: скеугоморфная карточка с модулями или stats, немного смещена вверх.
Asymmetrical, динамичный вид.`
    },
    {
      id: 'centered-large',
      name: 'Centered Hero Large',
      desc: 'Центрированный крупный hero с максимальным impact',
      prompt: `Hero секция: центрированный текст, очень крупный H1 (font-size 64-72px), центральный градиент в тексте.
Подзаголовок ниже, max-width 700px.
2 кнопки ниже (center aligned).
Справа/слева: минималистичные декоративные элементы (semi-transparent shapes).
Максимальный visual impact, премиум feel.`
    },
    {
      id: 'cinematic-fullscreen',
      name: 'Cinematic Fullscreen',
      desc: 'Cinematic hero на всю высоту с layered content',
      prompt: `Hero: fullscreen, cinematic feel с layered backgrounds.
Layer 1: большой яркий градиент или шум текстура (background).
Layer 2: текст-контент поверх (absolute position, bottom-left или center).
H1 очень крупный (70-80px), белый text с shadow для читаемости.
Layer 3: подзаголовок и CTA кнопка.
Scrollable hint (↓ стрелка внизу).
Очень драматичный и премиум.`
    },
    {
      id: 'asymmetrical-modern',
      name: 'Asymmetrical Modern',
      desc: 'Современный асимметричный дизайн с floating elements',
      prompt: `Hero: асимметричная композиция.
Основной текст-контент в левом верхнем углу (z-index выше).
Справа: floating cards/elements с данными на разных высотах (одна выше, одна ниже).
H1 среднего размера (48-56px), современный fonts.
Spacing: неравномерное, но гармоничное.
Много пустого пространства, light и air.`
    },
    {
      id: 'floating-cards',
      name: 'Floating Cards UI',
      desc: 'Hero с парящими карточками и информацией',
      prompt: `Hero: текст-контент слева, справа 4-5 парящих карточек (floating animation).
Карточки: полупрозрачные, glassmorphism, разноразмерные.
Каждая карточка содержит иконку + 1-2 слова (ключевые фичи).
Анимация: медленные parallax и плавное floating движение.
H1 слева: 48px, modern.
Премиум и интерактивный feel.`
    },
    {
      id: 'gradient-overlay',
      name: 'Gradient Overlay Hero',
      desc: 'Hero с градиентным overlay и rich content',
      prompt: `Hero: полный экран с background image или gradient.
Overlay: полупрозрачный gradient (от цвета accent к transparent).
Контент: центр экрана, white text.
H1 очень крупный (68px), gradient text.
Подзаголовок и 2 кнопки.
Иконки/визуальные элементы вокруг текста.
Cinematic и luxury feel.`
    },
    {
      id: 'dashboard-hero',
      name: 'Dashboard-Style Hero',
      desc: 'Hero как приватная dashboard с информацией',
      prompt: `Hero: как dashboard screen.
Слева навигация или stat-panel (sidebar, semi-transparent).
Справа: большой контент-блок с информацией.
H1: 44px, ненавязчивый.
Много stats и metrics в карточках.
Шрифты: монопространство для некоторых данных (tech feel).
Grid-based layout, очень структурированный.`
    },
    {
      id: 'video-hero',
      name: 'Video-Style Hero',
      desc: 'Hero как если бы был video/motion background',
      prompt: `Hero: имитация video hero (но без реального video!).
Background: темный, с animated gradient или moving elements.
Текст: center, white, очень контрастный.
H1: 60px, bold, gradient.
Подзаголовок: smaller, muted.
Кнопка: very prominent, large, с animation (pulse/glow).
Ощущение motion и energy.`
    }
  ],

  sectionOrders: [
    {
      id: 'standard',
      name: 'Standard Flow',
      order: ['hero', 'features', 'stats', 'process', 'pricing', 'testimonials', 'footer']
    },
    {
      id: 'engagement-first',
      name: 'Engagement First',
      order: ['hero', 'stats', 'features', 'testimonials', 'process', 'pricing', 'footer']
    },
    {
      id: 'trust-building',
      name: 'Trust Building',
      order: ['hero', 'features', 'testimonials', 'stats', 'process', 'pricing', 'footer']
    },
    {
      id: 'action-focused',
      name: 'Action Focused',
      order: ['hero', 'process', 'features', 'stats', 'pricing', 'testimonials', 'footer']
    },
    {
      id: 'minimalist',
      name: 'Minimalist',
      order: ['hero', 'features', 'pricing', 'testimonials', 'footer']
    },
    {
      id: 'feature-heavy',
      name: 'Feature Heavy',
      order: ['hero', 'features', 'features', 'stats', 'testimonials', 'pricing', 'footer']
    }
  ],

  navbarLayouts: [
    { id: 'topbar-simple', name: 'Topbar Simple', desc: 'Clean top navbar with logo left and actions right', prompt: 'Navbar: simple top layout, logo left, links right, one primary CTA, thin border or subtle background.' },
    { id: 'centered-menu', name: 'Centered Menu', desc: 'Centered logo/menu with minimal action button', prompt: 'Navbar: centered logo and menu items, CTA button on the right, balanced spacing, premium feel.' },
    { id: 'split-navigation', name: 'Split Navigation', desc: 'Split nav with logo left and buttons right', prompt: 'Navbar: split layout, logo left, menu items center or right, two action buttons, bold spacing.' },
    { id: 'side-toggle', name: 'Side Toggle', desc: 'Sidebar toggle menu on desktop style', prompt: 'Navbar: compact topbar with hamburger/menu toggle, sidebar panel for links, modern dashboard-style nav.' },
    { id: 'floating-pill', name: 'Floating Pill Navbar', desc: 'Floating pill-shaped navbar with rounded edges', prompt: 'Navbar: floating pill container, rounded corners, buttons inside, premium glass effect, subtle shadow.' }
  ],

  mobileNavbars: [
    { id: 'bottom-bar', name: 'Bottom Bar', desc: 'Mobile bottom navigation bar with icons', prompt: 'Mobile navbar: bottom fixed bar with 4 icons, minimal labels, soft background.' },
    { id: 'slide-in-menu', name: 'Slide-in Menu', desc: 'Hamburger menu with slide-in panel', prompt: 'Mobile navbar: hamburger icon opens slide-in menu from left, clean icons and large touch targets.' },
    { id: 'compact-top', name: 'Compact Top', desc: 'Compact top bar with centered brand and menu toggle', prompt: 'Mobile navbar: compact top header, centered brand, menu button on the right, simple and premium.' },
    { id: 'floating-action', name: 'Floating Action', desc: 'Floating action button style mobile nav', prompt: 'Mobile navbar: floating action button opens nav, minimal initial UI, modern and clean.' }
  ],

  galleryLayouts: [
    { id: 'masonry', name: 'Masonry Gallery', desc: 'Asymmetrical masonry photo / card wall', prompt: 'Gallery layout: masonry style with cards of varying heights, overlapping spacing and premium depth.' },
    { id: 'grid-split', name: 'Grid Split', desc: 'Split grid with one large and several small cards', prompt: 'Gallery layout: one large feature pane with adjacent smaller cards, balanced composition.' },
    { id: 'carousel', name: 'Carousel', desc: 'Horizontal carousel-style gallery', prompt: 'Gallery layout: horizontal scroll or carousel, large image cards, premium spacing, smooth transitions.' },
    { id: 'card-stack', name: 'Card Stack', desc: 'Stacked card layers with offset positions', prompt: 'Gallery layout: stacked offset cards with shadow depth, premium photography display.' }
  ],

  typographyScales: [
    { id: 'classic-display', name: 'Classic Display', desc: 'Serif headline + neutral sans body', prompt: 'Typography: serif display headlines with a clean sans-serif body, high contrast and elegant spacing.' },
    { id: 'modern-sans', name: 'Modern Sans', desc: 'Geometric sans serif with bold headings', prompt: 'Typography: modern geometric sans fonts, bold headings, soft body text, premium UI.' },
    { id: 'tech-modern', name: 'Tech Modern', desc: 'Monospace accents with sleek sans', prompt: 'Typography: sleek sans-serif body with monospace accents for data and buttons, tech feel.' },
    { id: 'minimal-neutral', name: 'Minimal Neutral', desc: 'Light, airy sans serif system', prompt: 'Typography: minimal and neutral sans-serif, high line-height, subtle weights, very clean layout.' }
  ],

  uiComplexity: [
    { id: 'simple', name: 'Simple', desc: 'Clean and minimal layout with few sections', prompt: 'UI complexity: simple, elegant, minimal sections with premium whitespace and direct messaging.' },
    { id: 'moderate', name: 'Moderate', desc: 'Balanced layout with several premium sections', prompt: 'UI complexity: balanced, premium layout with 5-6 sections, clear hierarchy and deliberate visuals.' },
    { id: 'rich', name: 'Rich', desc: 'More sections, layered content, advanced visuals', prompt: 'UI complexity: rich experience with layered layouts, multiple section types, premium animations and depth.' }
  ],

  featureGrids: [
    {
      id: 'grid-3x2',
      name: '3x2 Grid',
      columns: 3,
      desc: '6 карточек в 3 колонки по 2 ряда'
    },
    {
      id: 'grid-2x3',
      name: '2x3 Grid',
      columns: 2,
      desc: '6 карточек в 2 колонки по 3 ряда'
    },
    {
      id: 'grid-4x1',
      name: '4-1 Grid',
      columns: 4,
      desc: '4 карточки в ряд'
    },
    {
      id: 'masonry-3',
      name: 'Masonry 3-col',
      columns: 3,
      isMasonry: true,
      desc: 'Masonry layout с разными высотами'
    },
    {
      id: 'single-col',
      name: 'Single Column',
      columns: 1,
      desc: 'Одна карточка за раз, vertical scroll'
    },
    {
      id: 'rotating-grid',
      name: 'Rotating Grid',
      columns: 3,
      isRotating: true,
      desc: 'Grid с вращением элементов'
    }
  ],

  cardStyles: [
    {
      id: 'glassmorphism',
      name: 'Glassmorphism',
      css: `background: rgba(255,255,255,0.08);
backdrop-filter: blur(10px);
border: 1px solid rgba(255,255,255,0.1);`,
      desc: 'Полупрозрачные карточки с blur'
    },
    {
      id: 'solid-border',
      name: 'Solid Border',
      css: `background: var(--surface);
border: 2px solid var(--border);`,
      desc: 'Плотные карточки с видимой границей'
    },
    {
      id: 'gradient-border',
      name: 'Gradient Border',
      css: `background: var(--surface);
border: 2px solid;
border-image: linear-gradient(135deg,var(--accent1),var(--accent3)) 1;`,
      desc: 'Карточки с gradient border'
    },
    {
      id: 'shadow-only',
      name: 'Shadow Only',
      css: `background: var(--surface);
border: none;
box-shadow: 0 20px 40px rgba(0,0,0,0.4);`,
      desc: 'Карточки с большой тенью, граница скрыта'
    },
    {
      id: 'neon-border',
      name: 'Neon Border',
      css: `background: rgba(0,0,0,0.3);
border: 1px solid var(--accent1);
box-shadow: 0 0 20px rgba(var(--accent1-rgb),0.3);`,
      desc: 'Neon-style карточки с glow'
    },
    {
      id: 'minimal-underline',
      name: 'Minimal Underline',
      css: `background: transparent;
border: none;
border-bottom: 3px solid var(--accent1);`,
      desc: 'Минималистичные карточки с нижней линией'
    }
  ],

  visualStyles: [
    {
      id: 'apple-minimalism',
      name: 'Apple Minimalism',
      desc: 'Максимально clean, white space, simple typography, subtle colors',
      instructions: `Стиль: Apple-like минимализм.
- Максимум white space между элементами
- Typography: light weights (300-400), generous line-height
- Цвета: minimize color usage, mainly text + 1 accent
- Borders: none или очень subtle
- Spacing: very generous (32px+ gaps)
- Cards: white/surface background, no borders
- Animations: minimal, subtle fade/scale
- Overall: light, elegant, expensive-looking`
    },
    {
      id: 'framer-futuristic',
      name: 'Framer Futuristic',
      desc: 'Modern tech UI, gradients, animations, glass effects',
      instructions: `Стиль: Framer-like футуристический.
- Background: dark с subtle gradient
- Использовать glassmorphism cards
- Gradients: везде (buttons, text, backgrounds)
- Animations: smooth transitions, hover effects на всём
- Border-radius: medium (12-24px)
- Spacing: balanced (16-24px gaps)
- Icons: современные, colorful
- Effects: shadow, glow, parallax
- Overall: tech, modern, animated`
    },
    {
      id: 'luxury-cinematic',
      name: 'Luxury Cinematic',
      desc: 'Premium, dramatic, cinema-like, high contrast',
      instructions: `Стиль: Luxury cinematic.
- Background: very dark или rich color
- Typography: serif for headers, modern for body
- Использовать fullscreen sections с dramatic layering
- High contrast images/videos
- Spacing: generous, breathing room
- Gradients: rich, multi-color gradients
- Animation: slow, smooth, purposeful
- Color: limited palette, очень saturated
- Overall: expensive, premium, cinematic`
    },
    {
      id: 'brutalist-modern',
      name: 'Brutalist Modern',
      desc: 'Raw, bold, monospace, stark, geometric',
      instructions: `Стиль: Brutalist modern.
- Typography: monospace для заголовков или акцентов
- Borders: thick, visible, raw
- Spacing: irregular, asymmetrical
- Colors: high contrast, bold
- Grid: visible grid lines or geometric shapes
- No smooth corners (border-radius: 0)
- Animations: none или very minimal
- Background: pure white или pure black
- Overall: raw, authentic, bold, rebellious`
    },
    {
      id: 'ultra-clean-saas',
      name: 'Ultra Clean SaaS',
      desc: 'Professional, organized, dashboard-like, very clean',
      instructions: `Стиль: Ultra clean SaaS.
- Grid-based layout, very structured
- Cards: clean, organized, information-heavy
- Typography: sans-serif, readable, clear hierarchy
- Icons: line-based, monochromatic
- Colors: professional (blues, grays, minimal accent)
- Spacing: precise, grid-aligned (8px system)
- Animations: micro-interactions, very subtle
- Background: light или very light gray
- Overall: professional, trustworthy, organized`
    },
    {
      id: 'vibrant-playful',
      name: 'Vibrant Playful',
      desc: 'Colorful, fun, energetic, creative',
      instructions: `Стиль: Vibrant playful.
- Цвета: multiple vibrant colors, rainbow palette
- Shapes: rounded, friendly (border-radius: 20px+)
- Typography: bold, rounded sans-serif
- Illustrations: colorful, illustrated icons
- Spacing: balanced but energetic
- Animations: fun, playful, smooth
- Gradients: colorful transitions
- Layering: lots of overlapping elements
- Overall: fun, young, creative, energetic`
    },
    {
      id: 'data-visualization',
      name: 'Data Visualization',
      desc: 'Chart-heavy, infographic-style, analytical',
      instructions: `Стиль: Data visualization.
- Lots of stats/numbers/charts visual representation
- Cards with data points и metrics
- Grid with infographics
- Colors: use data visualization colors (heatmaps)
- Typography: clean, emphasis on numbers
- Icons: data-related (graphs, charts, metrics)
- Animations: data transitions, smooth number counting
- Layout: very organized, dashboard-like
- Overall: analytical, professional, insight-focused`
    },
    {
      id: 'retro-modern',
      name: 'Retro Modern',
      desc: 'Retro 80s-90s meets modern tech',
      instructions: `Стиль: Retro modern.
- Colors: warm tones, sunset vibes, retro palette
- Typography: mix of modern + retro fonts
- Grid: visible grid, retro computer feel
- Shapes: geometric, bold
- Borders: thick, neon-like colors
- Effects: heavy shadows, glow effects
- Spacing: interesting, not minimal
- Gradients: sunset/retro-style gradients
- Overall: nostalgic but modern, trendy`
    }
  ],

  animationStyles: [
    {
      id: 'subtle-fade',
      name: 'Subtle Fade',
      css: `@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`
    },
    {
      id: 'smooth-bounce',
      name: 'Smooth Bounce',
      css: `@keyframes bounceIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
@keyframes slideInLeft { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); } }`
    },
    {
      id: 'elegant-flow',
      name: 'Elegant Flow',
      css: `@keyframes flowIn { from { opacity: 0; transform: translateY(40px) rotate(2deg); } to { opacity: 1; transform: translateY(0) rotate(0); } }
@keyframes cascadeIn { animation: flowIn 0.6s ease-out forwards; }`
    },
    {
      id: 'energetic-pop',
      name: 'Energetic Pop',
      css: `@keyframes popIn { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: scale(1); } }
@keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }`
    }
  ],

  spacingDensities: [
    { id: 'generous', name: 'Generous', gap: '32px', padding: '48px', desc: 'Много пустого пространства' },
    { id: 'balanced', name: 'Balanced', gap: '24px', padding: '40px', desc: 'Сбалансированное' },
    { id: 'compact', name: 'Compact', gap: '16px', padding: '32px', desc: 'Плотное, но не тесное' },
    { id: 'dense', name: 'Dense', gap: '12px', padding: '24px', desc: 'Максимально компактное' }
  ]
};

// ==================== LAYOUT SELECTION LOGIC ====================
let generationHistory = [];

function chooseLayoutPattern(seed, suffix, list) {
  const idx = Math.abs(hashString(seed + suffix + Date.now())) % list.length;
  return list[idx];
}

function selectLayoutVariation(project) {
  const seed = (project.name + project.description + Math.random()).toLowerCase();
  
  const variations = {
    heroStyle: chooseLayoutPattern(seed, 'hero', LAYOUT_PATTERNS.heroStyles),
    sectionOrder: chooseLayoutPattern(seed, 'sections', LAYOUT_PATTERNS.sectionOrders),
    featureGrid: chooseLayoutPattern(seed, 'grid', LAYOUT_PATTERNS.featureGrids),
    cardStyle: chooseLayoutPattern(seed, 'cards', LAYOUT_PATTERNS.cardStyles),
    visualStyle: chooseLayoutPattern(seed, 'visual', LAYOUT_PATTERNS.visualStyles),
    animationStyle: chooseLayoutPattern(seed, 'anim', LAYOUT_PATTERNS.animationStyles),
    spacingDensity: chooseLayoutPattern(seed, 'spacing', LAYOUT_PATTERNS.spacingDensities),
    navbarStyle: chooseLayoutPattern(seed, 'navbar', LAYOUT_PATTERNS.navbarLayouts),
    mobileNavbar: chooseLayoutPattern(seed, 'mobileNav', LAYOUT_PATTERNS.mobileNavbars),
    galleryLayout: chooseLayoutPattern(seed, 'gallery', LAYOUT_PATTERNS.galleryLayouts),
    typographyScale: chooseLayoutPattern(seed, 'typography', LAYOUT_PATTERNS.typographyScales),
    uiComplexity: chooseLayoutPattern(seed, 'complexity', LAYOUT_PATTERNS.uiComplexity)
  };

  const signature = getLayoutSignature(variations);
  
  // Если эта комбинация недавно использовалась, пробуем другую
  if (isLayoutCombinationRecent(signature)) {
    console.log(`[Anti-Repetition] Layout combination recently used, trying alternative...`);
    variations.visualStyle = chooseLayoutPattern(seed, 'visual-alt', LAYOUT_PATTERNS.visualStyles);
    variations.cardStyle = chooseLayoutPattern(seed, 'cards-alt', LAYOUT_PATTERNS.cardStyles);
    variations.navbarStyle = chooseLayoutPattern(seed, 'navbar-alt', LAYOUT_PATTERNS.navbarLayouts);
    variations.sectionOrder = chooseLayoutPattern(seed, 'sections-alt', LAYOUT_PATTERNS.sectionOrders);
    variations.featureGrid = chooseLayoutPattern(seed, 'grid-alt', LAYOUT_PATTERNS.featureGrids);
  }

  addLayoutToHistory(getLayoutSignature(variations));

  console.log(`[Layout] Selected for "${project.name}":
    Hero: ${variations.heroStyle.name}
    Navbar: ${variations.navbarStyle.name}
    Mobile Nav: ${variations.mobileNavbar.name}
    Sections: ${variations.sectionOrder.name}
    Grid: ${variations.featureGrid.name}
    Cards: ${variations.cardStyle.name}
    Visual: ${variations.visualStyle.name}
    Animation: ${variations.animationStyle.name}
    Typography: ${variations.typographyScale.name}
    Complexity: ${variations.uiComplexity.name}
    Spacing: ${variations.spacingDensity.name}`);

  return variations;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// ==================== ANTI-REPETITION ENGINE ====================
/**
 * 🔄 Anti-Repetition Logic
 * Отслеживает последние использованные layouts и избегает их повторения
 * Каждый проект получает уникальную комбинацию паттернов
 */
const RECENT_LAYOUTS = [];
const MAX_RECENT_HISTORY = 10;

function isLayoutCombinationRecent(layoutSignature) {
  return RECENT_LAYOUTS.includes(layoutSignature);
}

function addLayoutToHistory(layoutSignature) {
  RECENT_LAYOUTS.unshift(layoutSignature);
  if (RECENT_LAYOUTS.length > MAX_RECENT_HISTORY) {
    RECENT_LAYOUTS.pop();
  }
  console.log(`[Anti-Repetition] Added layout to history (total: ${RECENT_LAYOUTS.length})`);
}

function getLayoutSignature(layout) {
  return `${layout.heroStyle.id}|${layout.visualStyle.id}|${layout.cardStyle.id}|${layout.featureGrid.id}|${layout.navbarStyle.id}|${layout.mobileNavbar.id}|${layout.galleryLayout.id}|${layout.sectionOrder.id}|${layout.typographyScale.id}|${layout.uiComplexity.id}`;
}

function selectVariedLayoutIndex(array, seed, suffix, avoidIndices = []) {
  let index = Math.abs(hashString(seed + suffix)) % array.length;
  let attempts = 0;
  const maxAttempts = array.length;

  // Пытаемся избежать последних использованных индексов
  while (avoidIndices.includes(index) && attempts < maxAttempts) {
    index = (index + 1) % array.length;
    attempts++;
  }

  return index;
}

// ==================== XAI GROK API INTEGRATION ====================
/**
 * 🚀 xAI Grok — премиум AI для дизайна, дизайнерского кода и структуры
 * Использует xAI API (https://console.x.ai/) для лучшего качества
 */

// Emoji to SVG Icon mapping
const EMOJI_ICON_MAP = {
  '🚀': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 13c0-1 4-8 8-8s4 4 8 8c0 4-2 8-4 10h-8c-2-2-4-6-4-10z"/></svg>',
  '⭐': '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 10.26 24 10.26 17.55 15.74 20.64 23.74 12 18.26 3.36 23.74 6.45 15.74 0 10.26 8.91 10.26 12 2"/></svg>',
  '💡': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 1v4m-7 5h-4m12-5h4m-7 12v4"/></svg>',
  '🎯': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  '🔧': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>',
  '💼': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
  '📱': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
  '🌟': '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  '✨': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><circle cx="12" cy="12" r="3"/></svg>',
  '🎨': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>',
  '📊': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  '🔐': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  '🚦': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="20" rx="2"/><circle cx="12" cy="7" r="1.5"/><circle cx="12" cy="13" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>',
  '⚡': '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  '🎁': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8V3M7 13h10"/><path d="M7 13l-2 4h14l-2-4"/></svg>',
  '👥': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  '🌍': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>',
};

function replaceEmojisWithIcons(html) {
  if (!html) return html;
  let result = html;
  for (const [emoji, icon] of Object.entries(EMOJI_ICON_MAP)) {
    // Replace emoji with inline SVG (wrapped in span with class for styling)
    const iconSpan = `<span class="icon-inline">${icon}</span>`;
    result = result.split(emoji).join(iconSpan);
  }
  return result;
}

async function tryXaiGrokDesign(project) {
  const xaiKey = process.env.XAI_API_KEY;
  if (!xaiKey) return null;

  const { name, description, structure, stack } = project;
  const pages = normalizeList(structure?.pages, ['Главная', 'Возможности', 'Контакты']);
  const modules = normalizeList(structure?.productModules, []);
  const productName = normalizeText(name);
  const productDesc = normalizeText(description);
  const productStack = normalizeText(stack || 'React');
  const productKind = normalizeText(structure?.kind || 'web-продукт');
  const dv = pickDesignVariant(productDesc + productName + productStack);

  // 🎨 SELECT DYNAMIC LAYOUT VARIATION
  const layout = selectLayoutVariation(project);

  const enhancedDescription = enhanceUserPrompt(productDesc);
  
  // Prepare photo analysis context if available
  let photoContext = '';
  if (project.photoAnalysis) {
    const pa = project.photoAnalysis;
    photoContext = `\n\n=== PHOTO REFERENCE STYLE ===\nДизайн стиль из загруженной фотографии: ${pa.designStyle}\nМакет: ${pa.layoutStyle}\nТипография: ${pa.typographyStyle}\nЦветовая палитра: ${pa.dominantColors?.join(', ') || 'анализируется'}\nМуд и ощущение: ${pa.mood}\n`;
  }
  
  const userPrompt = `Создай ПРЕМИУМ и УНИКАЛЬНЫЙ single-page сайт на русском языке для продукта:\nНазвание: "${productName}"\nТип продукта: ${productKind}\nСтек: ${productStack}\nОписание: "${enhancedDescription}"\nЦелевая аудитория: ${normalizeText(structure?.targetAudience) || 'профессионалы'}\nКлючевые модули: ${modules.slice(0, 8).join(', ') || 'из описания'}${photoContext}\n\nИспользуй эту цветовую схему: ${dv.label}.\nФон: ${dv.bg}, surface: ${dv.surface}, accent: ${dv.accent1}, btn: ${dv.btnPrimary}.\n\n

=== DYNAMIC LAYOUT & STYLE ===

Visual style: ${layout.visualStyle.name}
Navbar layout: ${layout.navbarStyle.name}
Mobile navbar: ${layout.mobileNavbar.name}
Typography: ${layout.typographyScale.name}
UI complexity: ${layout.uiComplexity.name}
Section flow: ${layout.sectionOrder.name}
Gallery layout: ${layout.galleryLayout.name}
Feature grid: ${layout.featureGrid.name}
Spacing density: ${layout.spacingDensity.name}

=== VISUAL STYLE INSTRUCTIONS ===
${layout.visualStyle.instructions}

=== HERO SECTION ===
${layout.heroStyle.prompt}

=== NAVBAR ===
${layout.navbarStyle.prompt}

=== MOBILE NAV ===
${layout.mobileNavbar.prompt}

=== TYPOGRAPHY ===
${layout.typographyScale.prompt}

=== CONTENT / GALLERY ===
${layout.galleryLayout.prompt}

=== CARD STYLE ===
${layout.cardStyle.css}

=== ICONS STYLE ===
.icon-inline {
  display: inline-block;
  vertical-align: middle;
  margin: 0 4px;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}
.icon-inline svg {
  width: 100%;
  height: 100%;
  color: currentColor;
}

=== SPACING ===
Gap между элементами: ${layout.spacingDensity.gap}
Padding внутри секций: ${layout.spacingDensity.padding}

=== ANIMATIONS ===
${layout.animationStyle.css}

=== SECTION ORDER ===
${layout.sectionOrder.order.join(' → ')}

=== ТРЕБОВАНИЯ ===
- Создай действительно уникальный, premium и современный дизайн, НЕ шаблонный.
- Каждый новый продукт должен получать отличную архитектуру и другую композицию блока.
- Избегай повторяющихся hero, navbar, grid, card и section orders.
- Hero: следуй инструкции для ${layout.heroStyle.name}
- Navbar: используй ${layout.navbarStyle.name}
- Мобильная навигация: ${layout.mobileNavbar.name}
- Typography: ${layout.typographyScale.name}
- Gallery/content layout: ${layout.galleryLayout.name}
- Используй стиль карточек ${layout.cardStyle.name}
- Придерживайся визуального направления ${layout.visualStyle.name}
- Убедись, что каждая секция имеет уникальную цель и реальное содержание
- Не добавляй эмодзи - они будут автоматически заменены на SVG иконки
- Не добавляй inline-style
- Не добавляй внешние CDN и внешние библиотеки
- Включи CSS для иконок (class="icon-inline" { display: inline-block; vertical-align: middle; margin: 0 4px; })
- Верни только один полный HTML документ с <style> и <script>, без markdown, без пояснений.`;

  try {
    console.log(`[xAI Grok] Generating ${layout.visualStyle.name} design for ${productName} (hero: ${layout.heroStyle.name})`);
    const rawHtml = await tryXaiGrokRequest({
      messages: buildAiMessages('Сгенерируй готовый уникальный HTML дизайн.', userPrompt),
      max_output_tokens: 14000,
      temperature: 0.72,
      top_p: 0.95,
    }, 'Design');

    if (!rawHtml) {
      return null;
    }

    let html = extractHtmlSegment(stripCodeBlocks(rawHtml));
    if (!html.toLowerCase().includes('<html')) {
      html = `<!DOCTYPE html>\n<html lang="ru">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${productName}</title></head>\n<body>${html}</body>\n</html>`;
    }

    const htmlValid = validateHtmlOutput(html);
    if (!htmlValid) {
      if (looksLikeHtmlContent(html) && html.length > 1500) {
        console.log(`[xAI Grok] Warning: HTML validation too strict, accepting HTML-like output (${html.length} chars)`);
      } else {
        console.log(`[xAI Grok] Invalid HTML output, failing validation`);
        return null;
      }
    }

    // Replace emojis with proper SVG icons
    html = replaceEmojisWithIcons(html);

    // Store layout info in project for reference
    project.layoutInfo = {
      visualStyle: layout.visualStyle.name,
      heroStyle: layout.heroStyle.name,
      cardStyle: layout.cardStyle.name,
      animationStyle: layout.animationStyle.name,
      spacingDensity: layout.spacingDensity.name,
      navbarStyle: layout.navbarStyle.name,
      mobileNavbar: layout.mobileNavbar.name,
      typographyScale: layout.typographyScale.name,
      featureGrid: layout.featureGrid.name,
      galleryLayout: layout.galleryLayout.name,
      sectionOrder: layout.sectionOrder.name,
      uiComplexity: layout.uiComplexity.name
    };

    console.log(`[xAI Grok] ✅ Design generated: ${html.length} chars`);
    return html;
  } catch (err) {
    console.log(`[xAI Grok] Error: ${err.message.slice(0, 120)}`);
    return null;
  }
}

/**
 * xAI Grok для генерации кода
 */
async function tryXaiGrokCode(structure, stack) {
  const xaiKey = process.env.XAI_API_KEY;
  if (!xaiKey) return null;

  const stackName = normalizeText(stack);
  const prompt = `Сгенерируй production-ready frontend и backend код для веб-приложения "${structure.name || 'Project'}" на стеке ${stackName}.

Описание: ${normalizeText(structure.description || '')}

Структура:
- Страницы: ${normalizeList(structure.pages).join(', ')}
- Компоненты: ${normalizeList(structure.components).join(', ')}
- API: ${normalizeList(structure.apiRoutes).join(', ')}
- Схемы БД: ${normalizeList(structure.databaseSchema).join(', ')}

Ответ должен состоять из трёх секций EXACTLY:
===FRONTEND===
===BACKEND===
===DATABASE===

ТРЕБОВАНИЯ:
- Frontend: React + TypeScript, semantic HTML, reusable компоненты, responsive layout, consistent spacing, modern typography, hover effects, accessible UI.
- Frontend: НЕ использовать inline styles, использовать CSS classes и CSS variables.
- Backend: Node.js + Express (TypeScript), JSON API, CORS, error handling, validation, clean routes.
- Database: Mongoose схемы с конкретными полями на основе product schema.
- Запрещено: TODO, FIXME, placeholder comments, незавершённые фрагменты, дублирование кода.
- Верни только готовый рабочий код, без markdown, без объяснений.`;

  const messages = buildAiMessages('Сгенерируй frontend/backend код.', prompt);

  try {
    const rawText = await tryXaiGrokRequest({
      messages,
      max_output_tokens: 16000,
      temperature: 0.3,
      top_p: 0.9,
    }, 'Code');

    if (!rawText) {
      return null;
    }

    const text = stripCodeBlocks(rawText);
    const frontend = text.match(/===FRONTEND===([\s\S]*?)(?====BACKEND===|$)/)?.[1]?.trim() || '';
    const backend = text.match(/===BACKEND===([\s\S]*?)(?====DATABASE===|$)/)?.[1]?.trim() || '';
    const database = text.match(/===DATABASE===([\s\S]*?)$/)?.[1]?.trim() || '';

    if (validateCodeOutput(frontend) && validateCodeOutput(backend) && validateCodeOutput(database)) {
      console.log(`[xAI Grok Code] ✅ Generated: F=${frontend.length}, B=${backend.length}, D=${database.length}`);
      return {
        frontend: frontend,
        backend: backend,
        database: database
      };
    }

    console.log(`[xAI Grok Code] Incomplete or invalid code output`);
    return null;
  } catch (err) {
    console.log(`[xAI Grok Code] Error: ${err.message.slice(0, 100)}`);
    return null;
  }
}

/**
 * xAI Grok для генерации структуры проекта
 */
async function tryXaiGrokStructure(description, stack) {
  const xaiKey = process.env.XAI_API_KEY;
  if (!xaiKey) return null;

  const enhancedDescription = enhanceUserPrompt(description);
  const userPrompt = `Описание продукта:\n"${enhancedDescription}"\n\nСтек: ${stack}\n\nЗадача:\n- Создай глубокую, профессиональную структуру продукта для landing page / SaaS / web-приложения, строго соответствующую теме запроса.\n- Сосредоточься на логичной иерархии страниц и секций, правильной информационной архитектуре, удобной навигации и четком пути пользователя.\n- Убедись, что каждая секция имеет реальную цель и не является пустым заполнителем.\n- Определи layout-plan, страницы, ключевые UI-компоненты, API, моделирование данных, тарифы и метрики.\n- Верни ТОЛЬКО валидный JSON без markdown, пояснений и комментариев.\n- Используй строго следующие поля в результате: name, tagline, kind, targetAudience, pages, components, apiRoutes, databaseSchema, productModules, pricingTiers, keyStats, fileTree.\n- Не добавляй дополнительные обёртки или другие имена полей.\n- Все поля должны быть специфичны для этого продукта.`;

  const messages = buildAiMessages('Сгенерируй структуру продукта.', userPrompt);

  try {
    const rawText = await tryXaiGrokRequest({
      messages,
      max_output_tokens: 5200,
      temperature: 0.25,
      top_p: 0.92,
    }, 'Struct');

    if (!rawText) {
      return null;
    }

    const generated = extractJsonObject(rawText);
    if (!generated) {
      const preview = String(rawText || '').replace(/\s+/g, ' ').slice(0, 400);
      console.log(`[xAI Grok Struct] Invalid or missing JSON structure. Response preview: ${preview}`);
      return null;
    }

    if (!generated.name) {
      generated.name = generated.productName || generated.brandName || generated.title || generated.projectName || generated.brand || '';
    }

    if (!Array.isArray(generated.pages) || !generated.pages.length) {
      if (Array.isArray(generated.sections) && generated.sections.length) {
        generated.pages = generated.sections;
      } else if (generated.layoutPlan && typeof generated.layoutPlan === 'object') {
        const flow = normalizeText(generated.layoutPlan.primaryFlow || generated.layoutPlan.sequence || '');
        generated.pages = flow ? flow.split(/->|→|,/).map(item => normalizeText(item)).filter(Boolean) : [];
      }
    }

    if (!Array.isArray(generated.components) || !generated.components.length) {
      generated.components = normalizeList(generated.components || generated.features || generated.modules || generated.widgets || []);
    }

    if (!Array.isArray(generated.apiRoutes) || !generated.apiRoutes.length) {
      generated.apiRoutes = normalizeList(generated.apiRoutes || generated.endpoints || []);
    }

    generated.productModules = normalizeList(generated.productModules || generated.modules || generated.features || []);
    generated.pricingTiers = Array.isArray(generated.pricingTiers) ? generated.pricingTiers : (Array.isArray(generated.plans) ? generated.plans : []);
    generated.keyStats = Array.isArray(generated.keyStats) ? generated.keyStats : (Array.isArray(generated.metrics) ? generated.metrics : []);
    generated.databaseSchema = normalizeList(generated.databaseSchema || generated.schemas || generated.dataModels || []);
    generated.pages = normalizeList(generated.pages || []);
    generated.components = normalizeList(generated.components || []);
    generated.apiRoutes = normalizeList(generated.apiRoutes || []);
    generated.fileTree = normalizeList(generated.fileTree || generated.files || []);

    if (!generated.name || !generated.pages.length) {
      const preview = String(rawText || '').replace(/\s+/g, ' ').slice(0, 400);
      console.log(`[xAI Grok Struct] Invalid or incomplete JSON structure. Response preview: ${preview}`);
      return null;
    }

    console.log(`[xAI Grok Struct] ✅ Generated: ${generated.name}`);
    return generated;
  } catch (err) {
    console.log(`[xAI Grok Struct] Error: ${err.message.slice(0, 100)}`);
    return null;
  }
}

async function generateWebsiteHtml(project) {
  // 🚀 Попытка 1: xAI Grok (ПРЕМИУМ ДИЗАЙН)
  if (process.env.XAI_API_KEY) {
    try {
      const xaiHtml = await tryXaiGrokDesign(project);
      if (xaiHtml && xaiHtml.length > 500) {
        console.log(`[HTML gen] ✅ Using xAI Grok design (${xaiHtml.length} chars)`);
        return xaiHtml;
      }
    } catch (error) {
      console.log('[HTML gen] xAI design failed:', error.message.slice(0, 100));
    }
  }

  // Используем premium generateFallbackHtml с красивым дизайном
  return generateFallbackHtml(project);
}

function buildExportFiles(project) {
  const structure = {
    ...(project.structure || {}),
    name: project.name,
    kind: project.kind || (isNoCodeBuilderIdea(project.description) ? 'no-code-builder' : 'generic')
  };
  const fallbackCode = generateFallbackCode(structure);
  const generatedCode = project.generatedCode
    ? {
        frontend: project.generatedCode.frontend || fallbackCode.frontend,
        backend: project.generatedCode.backend || fallbackCode.backend,
        database: project.generatedCode.database || fallbackCode.database
      }
    : fallbackCode;
  const isNoCode = structure.kind === 'no-code-builder';
  const blueprint = {
    id: project._id,
    name: project.name,
    description: project.description,
    stack: project.stack,
    kind: structure.kind,
    structure: project.structure
  };

  const files = [
    { path: 'README.md', content: buildReadme(project) },
    { path: '.gitignore', content: 'node_modules\n.env\nbuild\ndist\ncoverage\n' },
    { path: 'package.json', content: buildRootPackage(project.name) },
    { path: '.env.example', content: 'PORT=5000\nMONGODB_URI=mongodb://localhost:27017/' + slugify(project.name) + '\n' },
    { path: 'client/package.json', content: buildClientPackage(project.name) },
    { path: 'client/public/index.html', content: buildPublicHtml(project.name) },
    { path: 'client/src/index.js', content: buildClientIndexFile() },
    { path: 'client/src/App.js', content: generatedCode.frontend },
    { path: 'client/src/styles.css', content: isNoCode ? buildNoCodeStyles() : buildGenericStyles() },
    { path: 'server/package.json', content: buildServerPackage(project.name) },
    { path: 'server/index.js', content: generatedCode.backend },
    { path: 'server/models/index.js', content: generatedCode.database },
    { path: 'shared/blueprint.json', content: JSON.stringify(blueprint, null, 2) }
  ];

  if (project.previewHtml) {
    files.push({ path: 'website/index.html', content: project.previewHtml });
  }

  if (isNoCode) {
    files.push({
      path: 'client/src/data/templates.js',
      content: `export const starterTemplates = ${JSON.stringify([
        { id: 'saas', name: 'SaaS Workspace', description: 'B2B SaaS shell' },
        { id: 'marketplace', name: 'Marketplace', description: 'Commerce starter' },
        { id: 'crm', name: 'CRM Console', description: 'Sales operations starter' }
      ], null, 2)};`
    });
    files.push({
      path: 'server/routes/templates.js',
      content: `const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json([
    { id: 'saas', name: 'SaaS Workspace' },
    { id: 'marketplace', name: 'Marketplace' },
    { id: 'crm', name: 'CRM Console' }
  ]);
});

module.exports = router;`
    });
    files.push({
      path: 'server/routes/projects.js',
      content: `const express = require('express');
const router = express.Router();

const projects = [];

router.get('/', (req, res) => res.json(projects));
router.post('/', (req, res) => {
  const project = { id: String(Date.now()), ...req.body, status: 'draft' };
  projects.push(project);
  res.status(201).json(project);
});

module.exports = router;`
    });
  }

  return files;
}

function streamProjectArchive(project, res) {
  const archiveBaseName = sanitizeArchiveBaseName(project.name);
  const asciiArchiveName = `${toAsciiArchiveBaseName(project.name)}.zip`;
  const archiveName = `${archiveBaseName}.zip`;
  const files = buildExportFiles(project);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiArchiveName}"; filename*=UTF-8''${encodeRFC5987(archiveName)}`
  );

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', error => {
    console.error('ZIP export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Не удалось собрать архив проекта' });
      return;
    }

    res.end();
  });

  archive.pipe(res);

  files.forEach(file => {
    archive.append(file.content, { name: `${slugify(project.name)}/${file.path}` });
  });

  archive.finalize();
}

// ==================== ROUTES ====================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, fullName, plan } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    const db = await readDB();
    if (db.users.find(user => user.email === email)) {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }

    const normalizedPlan = normalizePlan(plan || 'free');
    const baseUser = {
      _id: genId(),
      email,
      fullName: normalizeText(fullName) || email.split('@')[0],
      plan: normalizedPlan,
      creditsLimit: PLAN_LIMITS[normalizedPlan],
      creditsUsed: 0,
      referralCode: `ref_${genId().slice(0, 8)}`,
      referralsCount: 0,
      password: await bcrypt.hash(password, 10),
      createdAt: new Date().toISOString(),
      nextBillingAt: addDaysIso(BILLING_CYCLE_DAYS),
      subscriptionStatus: normalizedPlan === 'free' ? 'inactive' : 'active',
    };

    const user = ensureUserSaaSFields(baseUser);

    db.users.push(user);
    await writeDB(db);

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = await readDB();
    const index = db.users.findIndex(item => item.email === email);
    const user = index >= 0 ? db.users[index] : null;

    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(400).json({ error: 'Неверный email или пароль' });
    }

    const normalizedUser = ensureUserSaaSFields(user);
    db.users[index] = normalizedUser;
    await writeDB(db);
    const token = jwt.sign({ userId: normalizedUser._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: publicUser(normalizedUser) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/plans', (req, res) => {
  res.json(getPlansCatalog());
});

app.get('/api/admin/postgres/status', (req, res) => {
  if (!isPgAdmin(req)) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  res.json(postgresMirror.getStatus());
});

app.post('/api/admin/postgres/sync', async (req, res) => {
  if (!isPgAdmin(req)) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  const db = await readDB();
  const result = await postgresMirror.syncSnapshot(db, 'admin_trigger');
  res.json(result);
});

app.get('/api/admin/postgres/consistency', async (req, res) => {
  if (!isPgAdmin(req)) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  const force = String(req.query.force || '').toLowerCase() === 'true';
  if (!force) {
    const status = postgresMirror.getStatus();
    return res.json(status.lastConsistencyReport || { ok: false, error: 'Отчет пока не сформирован' });
  }

  const db = await readDB();
  const report = await postgresMirror.checkConsistency(db, 'manual_force');
  return res.json(report);
});

app.get('/api/account/usage', auth, async (req, res) => {
  const db = await readDB();
  const index = db.users.findIndex(item => item._id === req.user.userId);
  const user = index >= 0 ? db.users[index] : null;

  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const normalizedUser = ensureUserSaaSFields(user);
  db.users[index] = normalizedUser;
  await writeDB(db);

  res.json(publicUser(normalizedUser));
});

app.get('/api/account/profile', auth, async (req, res) => {
  const db = await readDB();
  const index = db.users.findIndex(item => item._id === req.user.userId);
  if (index === -1) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const user = ensureUserSaaSFields(db.users[index]);
  db.users[index] = user;
  await writeDB(db);

  res.json(publicUser(user));
});

app.patch('/api/account/profile', auth, async (req, res) => {
  const db = await readDB();
  const index = db.users.findIndex(item => item._id === req.user.userId);
  if (index === -1) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const user = ensureUserSaaSFields(db.users[index]);
  const nextFullName = normalizeText(req.body?.fullName);

  if (nextFullName) {
    user.fullName = nextFullName.slice(0, 80);
  }

  user.updatedAt = new Date().toISOString();
  db.users[index] = user;
  await writeDB(db);

  res.json({ message: 'Профиль обновлен', user: publicUser(user) });
});

app.get('/api/account/subscription', auth, async (req, res) => {
  const db = await readDB();
  const index = db.users.findIndex(item => item._id === req.user.userId);
  if (index === -1) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const user = ensureUserSaaSFields(db.users[index]);
  db.users[index] = user;
  await writeDB(db);

  res.json({
    user: publicUser(user),
    plans: getPlansCatalog(),
  });
});

app.post('/api/account/subscription/checkout', auth, async (req, res) => {
  const db = await readDB();
  const index = db.users.findIndex(item => item._id === req.user.userId);
  if (index === -1) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const requestedPlan = normalizePlan(req.body?.plan);
  if (!PLAN_LIMITS[requestedPlan]) {
    return res.status(400).json({ error: 'Недопустимый тариф' });
  }

  const user = ensureUserSaaSFields(db.users[index]);
  user.billingHistory = Array.isArray(user.billingHistory) ? user.billingHistory : [];
  user.plan = requestedPlan;
  user.creditsLimit = PLAN_LIMITS[requestedPlan];
  user.creditsUsed = 0;
  user.nextBillingAt = addDaysIso(BILLING_CYCLE_DAYS);
  user.subscriptionStatus = requestedPlan === 'free' ? 'inactive' : 'active';
  user.lastPaymentAt = requestedPlan === 'free' ? '' : new Date().toISOString();
  user.updatedAt = new Date().toISOString();
  user.aiMode = 'full';
  user.billingHistory.unshift({
    invoiceId: `inv_${genId().slice(0, 10)}`,
    plan: requestedPlan,
    amount: PLAN_PRICES[requestedPlan],
    status: 'paid',
    paidAt: new Date().toISOString(),
  });
  user.billingHistory = user.billingHistory.slice(0, 20);
  db.users[index] = user;
  await writeDB(db);

  const invoiceId = user.billingHistory[0]?.invoiceId;
  res.json({
    message: requestedPlan === 'free'
      ? 'Подписка отключена. Активен бесплатный план.'
      : `Подписка ${requestedPlan.toUpperCase()} активирована`,
    invoiceId,
    user: publicUser(user),
    billingHistory: user.billingHistory,
  });
});

app.patch('/api/account/plan', auth, async (req, res) => {
  const db = await readDB();
  const index = db.users.findIndex(item => item._id === req.user.userId);

  if (index === -1) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const requestedPlan = normalizePlan(req.body?.plan);
  if (!PLAN_LIMITS[requestedPlan]) {
    return res.status(400).json({ error: 'Недопустимый тариф' });
  }

  const user = ensureUserSaaSFields(db.users[index]);
  user.plan = requestedPlan;
  user.creditsLimit = PLAN_LIMITS[requestedPlan];
  user.creditsUsed = 0;
  user.nextBillingAt = addDaysIso(BILLING_CYCLE_DAYS);
  user.subscriptionStatus = requestedPlan === 'free' ? 'inactive' : 'active';
  user.lastPaymentAt = requestedPlan === 'free' ? '' : new Date().toISOString();
  user.aiMode = 'full';
  user.updatedAt = new Date().toISOString();
  db.users[index] = user;
  await writeDB(db);

  res.json({
    message: `Тариф обновлен на ${requestedPlan.toUpperCase()}`,
    usage: publicUser(user),
  });
});

app.post('/api/referrals/apply', auth, async (req, res) => {
  const code = normalizeText(req.body?.referralCode).toLowerCase();
  if (!code) {
    return res.status(400).json({ error: 'Введите реферальный код' });
  }

  const db = await readDB();
  const currentIndex = db.users.findIndex(item => item._id === req.user.userId);
  if (currentIndex === -1) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const currentUser = ensureUserSaaSFields(db.users[currentIndex]);
  if (currentUser.referralBonusReceived) {
    return res.status(400).json({ error: 'Реферальный бонус уже получен' });
  }

  if (currentUser.referralCode.toLowerCase() === code) {
    return res.status(400).json({ error: 'Нельзя применить собственный код' });
  }

  const ownerIndex = db.users.findIndex(
    item => ensureUserSaaSFields(item).referralCode.toLowerCase() === code
  );

  if (ownerIndex === -1) {
    return res.status(404).json({ error: 'Реферальный код не найден' });
  }

  const ownerUser = ensureUserSaaSFields(db.users[ownerIndex]);
  currentUser.referralBonusReceived = true;
  currentUser.referredBy = ownerUser._id;
  currentUser.creditsLimit += REFERRAL_BONUS_CREDITS;
  currentUser.updatedAt = new Date().toISOString();

  ownerUser.referralsCount += 1;
  ownerUser.creditsLimit += REFERRAL_BONUS_CREDITS;
  ownerUser.updatedAt = new Date().toISOString();

  db.users[currentIndex] = currentUser;
  db.users[ownerIndex] = ownerUser;
  await writeDB(db);

  res.json({
    message: `Реферальный бонус +${REFERRAL_BONUS_CREDITS} кредитов начислен`,
    usage: publicUser(currentUser),
  });
});

app.get('/api/projects', auth, async (req, res) => {
  const db = await readDB();
  const projects = db.projects
    .filter(project => project.userId === req.user.userId)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

  res.json(projects);
});

app.post('/api/projects', upload.single('photo'), auth, async (req, res) => {
  try {
    const description = normalizeText(req.body.description);
    const stack = normalizeText(req.body.stack) || 'React + Node.js';
    const photoBuffer = req.file?.buffer;

    if (!description) {
      return res.status(400).json({ error: 'Описание проекта обязательно' });
    }

    const db = await readDB();
    const charge = consumeCredits(db, req.user.userId, CREDIT_COSTS.createProject, 'create_project', { allowLite: true });
    if (!charge.ok) {
      return res.status(charge.status).json({ error: charge.error, usage: charge.usage });
    }

    const useLiteAi = Boolean(charge.lite);

    let photoAnalysis = null;
    if (!useLiteAi && photoBuffer) {
      console.log('[create] Analyzing photo style...');
      photoAnalysis = await analyzePhotoStyle(photoBuffer, req.file.mimetype);
      console.log('[create] Photo analysis:', photoAnalysis?.designStyle || 'skipped');
    }

    const generated = useLiteAi
      ? getFallbackTemplate(description, stack)
      : await generateWithAI(description, stack);
    const code = generateFallbackCode(generated);
    const project = {
      _id: genId(),
      userId: req.user.userId,
      name: generated.name,
      description,
      stack,
      kind: generated.kind || 'generic',
      structure: {
        pages: generated.pages,
        components: generated.components,
        apiRoutes: generated.apiRoutes,
        databaseSchema: generated.databaseSchema,
        productModules: generated.productModules || [],
        fileTree: generated.fileTree || []
      },
      generatedCode: code,
      status: 'generated',
      aiModeUsed: useLiteAi ? 'lite' : 'full',
      photoAnalysis: photoAnalysis,
      createdAt: new Date().toISOString()
    };

    // Авто-генерация HTML-сайта сразу при создании проекта
    try {
      const html = useLiteAi ? generateLitePreviewHtml(project) : await generateWebsiteHtml(project);
      project.previewHtml = html;
      project.status = 'ready';
    } catch (htmlErr) {
      console.log('[create] HTML generation failed:', htmlErr.message);
    }

    db.projects.push(project);
    await writeDB(db);

    res.status(201).json({
      ...project,
      usage: charge.usage,
      aiMode: useLiteAi ? 'lite' : 'full',
      warning: charge.warning,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects/:id', auth, async (req, res) => {
  const db = await readDB();
  const project = db.projects.find(item => item._id === req.params.id && item.userId === req.user.userId);

  if (!project) {
    return res.status(404).json({ error: 'Проект не найден' });
  }

  res.json(project);
});

app.post('/api/projects/:id/generate-code', auth, async (req, res) => {
  try {
    const db = await readDB();
    const index = db.projects.findIndex(item => item._id === req.params.id && item.userId === req.user.userId);

    if (index === -1) {
      return res.status(404).json({ error: 'Проект не найден' });
    }

    const charge = consumeCredits(db, req.user.userId, CREDIT_COSTS.generateCode, 'generate_code', { allowLite: true });
    if (!charge.ok) {
      return res.status(charge.status).json({ error: charge.error, usage: charge.usage });
    }

    const code = charge.lite
      ? generateFallbackCode({
          ...db.projects[index].structure,
          name: db.projects[index].name,
          kind: db.projects[index].kind,
        })
      : await generateFullCode({
          ...db.projects[index].structure,
          name: db.projects[index].name,
          kind: db.projects[index].kind,
        }, db.projects[index].stack);

    db.projects[index].generatedCode = code;
    db.projects[index].aiModeUsed = charge.lite ? 'lite' : 'full';
    await writeDB(db);

    res.json({ ...code, usage: charge.usage, aiMode: charge.lite ? 'lite' : 'full', warning: charge.warning });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects/:id/generate-preview', auth, async (req, res) => {
  try {
    const db = await readDB();
    const index = db.projects.findIndex(item => item._id === req.params.id && item.userId === req.user.userId);

    if (index === -1) {
      return res.status(404).json({ error: 'Проект не найден' });
    }

    const charge = consumeCredits(db, req.user.userId, CREDIT_COSTS.generatePreview, 'generate_preview', { allowLite: true });
    if (!charge.ok) {
      return res.status(charge.status).json({ error: charge.error, usage: charge.usage });
    }

    const html = charge.lite ? generateLitePreviewHtml(db.projects[index]) : await generateWebsiteHtml(db.projects[index]);
    db.projects[index].previewHtml = html;
    db.projects[index].aiModeUsed = charge.lite ? 'lite' : 'full';
    await writeDB(db);

    res.json({ html, usage: charge.usage, aiMode: charge.lite ? 'lite' : 'full', warning: charge.warning });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects/:id/export', auth, async (req, res) => {
  const db = await readDB();
  const index = db.projects.findIndex(item => item._id === req.params.id && item.userId === req.user.userId);

  if (index === -1) {
    return res.status(404).json({ error: 'Проект не найден' });
  }

  // Всегда регенерируем HTML чтобы экспорт использовал актуальный дизайн
  try {
    const html = await generateWebsiteHtml(db.projects[index]);
    db.projects[index].previewHtml = html;
    await writeDB(db);
  } catch (htmlErr) {
    console.log('[export] HTML regen failed:', htmlErr.message);
  }

  streamProjectArchive(db.projects[index], res);
});

app.get('/api/projects/:id/download', auth, async (req, res) => {
  const db = await readDB();
  const index = db.projects.findIndex(item => item._id === req.params.id && item.userId === req.user.userId);

  if (index === -1) {
    return res.status(404).json({ error: 'Проект не найден' });
  }

  return streamProjectArchive(db.projects[index], res);
});

app.get('/api/projects/:id/preview-download', auth, async (req, res) => {
  const db = await readDB();
  const index = db.projects.findIndex(item => item._id === req.params.id && item.userId === req.user.userId);

  if (index === -1) {
    return res.status(404).json({ error: 'Проект не найден' });
  }

  const project = db.projects[index];
  const html = normalizeText(project.previewHtml) || generateLitePreviewHtml(project);
  const baseName = toAsciiArchiveBaseName(project.name || 'project-preview');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}-preview.html"`);
  return res.send(html);
});

app.delete('/api/projects/all', auth, async (req, res) => {
  const db = await readDB();
  db.projects = db.projects.filter(item => item.userId !== req.user.userId);
  await writeDB(db);
  res.json({ message: 'Все проекты удалены' });
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  const db = await readDB();
  db.projects = db.projects.filter(item => !(item._id === req.params.id && item.userId === req.user.userId));
  await writeDB(db);
  res.json({ message: 'Удалено' });
});

app.delete('/api/projects', auth, (req, res) => {
  res.status(404).json({ error: 'Use DELETE /api/projects/all to remove all projects' });
});

app.listen(PORT, async () => {
  const xaiBoot = await loadXaiModels();

  console.log('\n  AI Startup Builder');
  console.log(`  Port: ${PORT}`);
  console.log('  AI: Grok');
  console.log(`  Model: ${getXaiModels()[0] || XAI_DEFAULT_MODEL}`);
  console.log(`  API: ${XAI_API_BASE}`);
  console.log(`  Status: ${xaiBoot.connected ? 'Connected' : 'Disconnected'}`);
  if (!xaiBoot.connected && xaiBoot.error) {
    console.log(`  xAI Error: ${xaiBoot.error}`);
  }
  console.log(`  DB: ${PG_PRIMARY_ENABLED ? 'PostgreSQL primary + JSON rollback' : `JSON (${DB_PATH})`}`);
  console.log(`  PG Mirror: ${process.env.PG_MIRROR_ENABLED === 'true' ? 'enabled' : 'disabled'}`);
  console.log('  Export: ZIP enabled\n');

  if (process.env.PG_MIRROR_ENABLED === 'true' || PG_PRIMARY_ENABLED) {
    postgresMirror.init()
      .then(async () => {
        postgresMirror.startConsistencyChecks(() => readDB());

        if (process.env.PG_INITIAL_SYNC_ON_BOOT === 'true') {
          const db = await readDB();
          const result = await postgresMirror.syncSnapshot(db, 'boot_sync');
          console.log('[PG Mirror] boot sync:', result.ok ? 'ok' : result.error);
        }

        if (String(process.env.PG_CONSISTENCY_CHECK_ENABLED || '').toLowerCase() === 'true') {
          const db = await readDB();
          const report = await postgresMirror.checkConsistency(db, 'boot_check');
          console.log('[PG Mirror] consistency:', report.ok ? 'ok' : 'mismatch');
        }
      })
      .catch(error => {
        console.log('[PG Mirror] init failed:', error.message);
      });
  }
});

process.on('SIGINT', async () => {
  try {
    await postgresMirror.close();
  } catch {
    // ignore close errors on shutdown
  }
  process.exit(0);
});
