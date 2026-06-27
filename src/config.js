/**
 * Конфигурация приложения
 */
const path = require('path');

const config = {
  // Server
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'ai_startup_diplom_2024_secret_key_xyz789',
  JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',
  
  // Database
  DB_PATH: path.join(__dirname, '../db.json'),
  
  // xAI Grok
  XAI_API_BASE: process.env.XAI_API_BASE || 'https://api.x.ai/v1',
  XAI_API_KEY: process.env.XAI_API_KEY,
  XAI_MODEL: process.env.XAI_MODEL || process.env.XAI_DEFAULT_MODEL || 'grok-4.3',
  XAI_GROK_MODELS: parseModelList(process.env.XAI_GROK_MODELS || process.env.XAI_GROK_MODEL || 'grok-4.3,grok-4.20,grok-4,grok-4.3-mini,grok-4-mini,grok-4.1'),
  XAI_MODELS_TIMEOUT_MS: Number(process.env.XAI_MODELS_TIMEOUT_MS || 8000),
  XAI_REQUEST_TIMEOUT_MS: Number(process.env.XAI_REQUEST_TIMEOUT_MS || 45000),

  // CORS
  CORS_ORIGINS: parseCorsOrigins(process.env.CORS_ORIGINS),
  
  // Multer
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  
  // Cache
  CACHE_TTL: 60000, // 1 минута
  CACHE_MAX_SIZE: 100,
  
  // Rate limiting
  RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 минут
  RATE_LIMIT_MAX_REQUESTS: 100,
  
  // Compression
  COMPRESSION_LEVEL: 6,
  COMPRESSION_MIN_SIZE: 1024, // 1KB
};

function parseModelList(value) {
  return String(value || '')
    .split(/[;,\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parseCorsOrigins(value) {
  const parsed = String(value || '')
    .split(/[;,\n]+/)
    .map(item => item.trim())
    .filter(Boolean);

  return parsed.length ? parsed : ['*'];
}

// Валидация при запуске
function validateConfig() {
  const required = ['JWT_SECRET'];
  const missing = required.filter(key => !config[key]);
  
  if (missing.length > 0) {
    console.warn(`⚠️  Missing config: ${missing.join(', ')}`);
  }
  
  console.log(`✅ Config loaded (ENV: ${config.NODE_ENV})`);
}

validateConfig();

module.exports = config;
