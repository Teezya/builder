/**
 * Middleware для оптимизации и безопасности
 */
const compression = require('compression');
const config = require('./config');

// Rate limiting (простое, in-memory решение)
class RateLimiter {
  constructor() {
    this.requests = new Map();
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      const window = now - config.RATE_LIMIT_WINDOW;
      
      if (!this.requests.has(ip)) {
        this.requests.set(ip, []);
      }
      
      const userRequests = this.requests.get(ip);
      const recentRequests = userRequests.filter(time => time > window);
      
      if (recentRequests.length >= config.RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
      }
      
      recentRequests.push(now);
      this.requests.set(ip, recentRequests);
      
      // Очистить старые IP (оптимизация памяти)
      if (this.requests.size > 10000) {
        for (const [k, v] of this.requests.entries()) {
          if (v.every(time => time <= window)) {
            this.requests.delete(k);
          }
        }
      }
      
      next();
    };
  }
}

// Кэширование в памяти для API ответов
class MemoryCache {
  constructor() {
    this.store = new Map();
    this.timers = new Map();
  }

  get(key) {
    return this.store.get(key);
  }

  set(key, value, ttl = config.CACHE_TTL) {
    // Очистить старый таймер
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    this.store.set(key, value);

    // Автоматическое удаление
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, ttl);

    this.timers.set(key, timer);

    // Ограничить размер кэша
    if (this.store.size > config.CACHE_MAX_SIZE) {
      const firstKey = this.store.keys().next().value;
      clearTimeout(this.timers.get(firstKey));
      this.store.delete(firstKey);
      this.timers.delete(firstKey);
    }
  }

  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.store.clear();
    this.timers.clear();
  }
}

// Логирование запросов (простое)
const logger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusColor = status < 300 ? '✅' : status < 400 ? '⚠️' : '❌';
    
    console.log(`${statusColor} ${req.method} ${req.path} → ${status} (${duration}ms)`);
  });
  
  next();
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err.message);

  if (err.message.includes('not found')) {
    return res.status(404).json({ error: 'Не найдено' });
  }

  if (err.message.includes('Unauthorized')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  if (err.message.includes('validation')) {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({
    error: config.NODE_ENV === 'production' 
      ? 'Внутренняя ошибка сервера' 
      : err.message
  });
};

// Валидация JSON body
const validateJson = (req, res, next) => {
  if (req.is('json') && req.body === undefined) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  next();
};

// Настройка compression с оптимизацией
const getCompressionMiddleware = () => {
  return compression({
    level: config.COMPRESSION_LEVEL,
    threshold: config.COMPRESSION_MIN_SIZE,
    filter: (req, res) => {
      // Не сжимать потокные ответы
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    }
  });
};

module.exports = {
  RateLimiter,
  MemoryCache,
  logger,
  errorHandler,
  validateJson,
  getCompressionMiddleware,
};
