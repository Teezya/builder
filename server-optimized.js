/**
 * AI Startup Builder - Backend (ОПТИМИЗИРОВАННЫЙ)
 * Express + JWT Auth + xAI Grok + JSON Storage + ZIP Export
 * 
 * Оптимизации:
 * - Модульная архитектура (config, database, middleware, utils)
 * - Compression + кэширование
 * - Rate limiting + валидация
 * - Асинхронная БД с debouncing
 * - Правильный error handling
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const archiver = require('archiver');

// Импортируем модули
const config = require('./src/config');
const db = require('./src/database');
const {
  RateLimiter,
  MemoryCache,
  logger,
  errorHandler,
  validateJson,
  getCompressionMiddleware,
} = require('./src/middleware');
const {
  normalizeText,
  slugify,
  shortDesc,
  validateEmail,
  validateProjectName,
  extractJsonObject,
  generateProjectName,
  isNoCodeBuilderIdea,
} = require('./src/utils');

// ==================== APP SETUP ====================
const app = express();

app.disable('x-powered-by');

// Middleware
app.use(getCompressionMiddleware());
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.CORS_ORIGINS.includes('*') || config.CORS_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS blocked'));
  },
  credentials: true,
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(validateJson);
app.use(logger);

// Rate limiting
const limiter = new RateLimiter();
app.use(limiter.middleware());

// Cache
const cache = new MemoryCache();

// ==================== MULTER SETUP ====================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed'));
    }
  }
});

// ==================== XAI STATUS ====================
const hasXai = Boolean(config.XAI_API_KEY);
if (hasXai) {
  console.log('✅ xAI Grok API key detected');
} else {
  console.warn('⚠️  xAI API key is missing, using templates');
}

// ==================== AUTH MIDDLEWARE ====================
const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }

  try {
    req.user = jwt.verify(token, config.JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ==================== AUTH ROUTES ====================
app.post('/api/register', async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;

    // Валидация
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Проверка на существование
    const users = await db.find('users', { email });
    if (users.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Создание пользователя
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await db.create('users', {
      email,
      password: hashedPassword,
      fullName: normalizeText(fullName),
      role: 'user',
      plan: 'free',
    });

    // Генерация токена
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRE }
    );

    res.json({
      user: { id: user.id, email: user.email, fullName: user.fullName },
      token,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const users = await db.find('users', { email });
    const user = users[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRE }
    );

    res.json({
      user: { id: user.id, email: user.email, fullName: user.fullName },
      token,
    });
  } catch (error) {
    next(error);
  }
});

// ==================== PROJECTS ROUTES ====================
app.post('/api/projects', auth, async (req, res, next) => {
  try {
    const { description, template } = req.body;

    if (!validateProjectName(description)) {
      return res.status(400).json({ error: 'Invalid project description' });
    }

    const project = await db.create('projects', {
      userId: req.user.id,
      name: generateProjectName(description),
      slug: slugify(description),
      description: shortDesc(description),
      status: 'draft',
      template: template || 'blank',
      createdAt: new Date().toISOString(),
    });

    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects', auth, async (req, res, next) => {
  try {
    const cacheKey = `projects-${req.user.id}`;
    let projects = cache.get(cacheKey);

    if (!projects) {
      projects = await db.find('projects', { userId: req.user.id });
      cache.set(cacheKey, projects);
    }

    res.json(projects);
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id', auth, async (req, res, next) => {
  try {
    const cacheKey = `project-${req.params.id}`;
    let project = cache.get(cacheKey);

    if (!project) {
      project = await db.findById('projects', req.params.id);
      if (!project || project.userId !== req.user.id) {
        return res.status(404).json({ error: 'Project not found' });
      }
      cache.set(cacheKey, project);
    }

    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.put('/api/projects/:id', auth, async (req, res, next) => {
  try {
    const project = await db.findById('projects', req.params.id);
    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const updated = await db.update('projects', req.params.id, req.body);
    
    // Инвалидировать кэш
    cache.store.delete(`project-${req.params.id}`);
    cache.store.delete(`projects-${req.user.id}`);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/projects/:id', auth, async (req, res, next) => {
  try {
    const project = await db.findById('projects', req.params.id);
    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await db.delete('projects', req.params.id);
    
    // Инвалидировать кэш
    cache.store.delete(`project-${req.params.id}`);
    cache.store.delete(`projects-${req.user.id}`);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== DOWNLOAD/EXPORT ====================
app.get('/api/projects/:id/download', auth, async (req, res, next) => {
  try {
    const project = await db.findById('projects', req.params.id);
    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(project.name)}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Добавить JSON с проектом
    archive.append(JSON.stringify(project, null, 2), { name: 'project.json' });

    // Добавить другие файлы если есть
    if (project.files && Array.isArray(project.files)) {
      project.files.forEach(file => {
        archive.append(Buffer.from(file.content), { name: file.path });
      });
    }

    archive.finalize();
  } catch (error) {
    next(error);
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ==================== ERROR HANDLING ====================
app.use(errorHandler);

// ==================== START SERVER ====================
const PORT = config.PORT;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  AI Startup Builder - Backend Server   ║
║  Оптимизированная архитектура          ║
╚════════════════════════════════════════╝

✅ Server running on http://localhost:${PORT}
✅ Compression enabled
✅ Rate limiting enabled
✅ Caching enabled
✅ Error handling enabled

Endpoints:
  POST   /api/register
  POST   /api/login
  GET    /api/projects
  POST   /api/projects
  GET    /api/projects/:id
  PUT    /api/projects/:id
  DELETE /api/projects/:id
  GET    /api/projects/:id/download
  GET    /health
  `);
});

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await db.write(db.cache || { users: [], projects: [] });
  process.exit(0);
});
