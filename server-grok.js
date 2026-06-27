/**
 * AI Startup Builder - Grok Integration
 * Полная генерация проектов через Grok AI
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const archiver = require('archiver');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'diplom_secret_2024';
const PORT = process.env.PORT || 5000;
const DB_PATH = path.join(__dirname, 'db.json');

// ==================== UTILS ====================
function genId() {
  return crypto.randomBytes(12).toString('hex');
}

async function readDB() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    const initial = { users: [], projects: [] };
    await fs.writeFile(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
}

async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// ==================== GROK AI INTEGRATION ====================
async function generateProjectWithGrok(description) {
  const xaiKey = process.env.XAI_API_KEY;
  if (!xaiKey) {
    return generateDefaultProject(description);
  }

  const prompt = `You are a professional web developer. Generate a complete, production-ready website based on this description:

"${description}"

You MUST respond with a JSON object (NO markdown, NO code blocks, pure JSON) with this exact structure:
{
  "name": "Project Name",
  "pages": {
    "index.html": "<!DOCTYPE html>...",
    "style.css": "* { ... }",
    "script.js": "console.log(...)",
    "README.md": "# Project..."
  },
  "structure": {
    "description": "Brief description",
    "technologies": ["HTML5", "CSS3", "JavaScript"],
    "features": ["Feature 1", "Feature 2"]
  }
}

IMPORTANT:
- Generate COMPLETE HTML with <html>, <head>, <body> tags
- Include modern CSS with variables, flexbox, and responsive design
- Write working JavaScript code
- Make it production-ready and professional
- Use real content, not Lorem Ipsum
- Include semantic HTML5 tags
- Make responsive with media queries
- Add proper meta tags and SEO`;

  try {
    const response = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${xaiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4.3',
        input: prompt,
      }),
    });

    if (!response.ok) {
      console.error('Grok API error:', response.status);
      return generateDefaultProject(description);
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
      }
    }

    if (!content) {
      return generateDefaultProject(description);
    }

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return generateDefaultProject(description);
    }

    let projectData;
    try {
      projectData = JSON.parse(jsonMatch[0]);
    } catch {
      return generateDefaultProject(description);
    }

    return projectData;
  } catch (error) {
    console.error('Grok generation error:', error.message);
    return generateDefaultProject(description);
  }
}

function generateDefaultProject(description) {
  const name = description.slice(0, 50).replace(/[^a-z0-9]/gi, ' ').trim() || 'My Project';
  
  return {
    name,
    pages: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name}</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <header class="header">
        <nav class="navbar">
            <div class="logo">${name}</div>
            <menu class="nav-links">
                <li><a href="#home">Home</a></li>
                <li><a href="#features">Features</a></li>
                <li><a href="#about">About</a></li>
                <li><a href="#contact">Contact</a></li>
            </menu>
        </nav>
    </header>

    <main class="container">
        <section id="home" class="hero">
            <h1>${name}</h1>
            <p>${description}</p>
            <button class="cta-button">Get Started</button>
        </section>

        <section id="features" class="features">
            <h2>Key Features</h2>
            <div class="features-grid">
                <div class="feature-card">
                    <h3>Feature 1</h3>
                    <p>High quality and modern design</p>
                </div>
                <div class="feature-card">
                    <h3>Feature 2</h3>
                    <p>Responsive and fast performance</p>
                </div>
                <div class="feature-card">
                    <h3>Feature 3</h3>
                    <p>Professional and production-ready</p>
                </div>
            </div>
        </section>

        <section id="about" class="about">
            <h2>About</h2>
            <p>This is a professional project built with modern web technologies.</p>
        </section>

        <section id="contact" class="contact">
            <h2>Contact Us</h2>
            <p>Get in touch with our team</p>
        </section>
    </main>

    <footer class="footer">
        <p>&copy; 2024 ${name}. All rights reserved.</p>
    </footer>

    <script src="script.js"></script>
</body>
</html>`,

      'style.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

:root {
    --primary-color: #3b82f6;
    --secondary-color: #1f2937;
    --accent-color: #f59e0b;
    --text-color: #111827;
    --light-bg: #f9fafb;
    --border-color: #e5e7eb;
    --shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

html {
    scroll-behavior: smooth;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: var(--text-color);
    line-height: 1.6;
    background-color: #ffffff;
}

/* Header & Navigation */
.header {
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
    color: white;
    padding: 1rem 0;
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: var(--shadow);
}

.navbar {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 2rem;
}

.logo {
    font-size: 1.5rem;
    font-weight: bold;
}

.nav-links {
    display: flex;
    list-style: none;
    gap: 2rem;
}

.nav-links a {
    color: white;
    text-decoration: none;
    transition: opacity 0.3s;
}

.nav-links a:hover {
    opacity: 0.8;
}

/* Container */
.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 2rem;
}

/* Hero Section */
.hero {
    padding: 6rem 0;
    text-align: center;
    background: linear-gradient(135deg, var(--light-bg), white);
}

.hero h1 {
    font-size: 3rem;
    margin-bottom: 1rem;
    color: var(--secondary-color);
}

.hero p {
    font-size: 1.25rem;
    color: #6b7280;
    margin-bottom: 2rem;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
}

.cta-button {
    background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
    color: white;
    border: none;
    padding: 0.75rem 2rem;
    font-size: 1rem;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: transform 0.3s, box-shadow 0.3s;
    box-shadow: var(--shadow);
}

.cta-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15);
}

/* Features Section */
.features {
    padding: 4rem 0;
    background-color: var(--light-bg);
}

.features h2 {
    font-size: 2rem;
    text-align: center;
    margin-bottom: 3rem;
    color: var(--secondary-color);
}

.features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 2rem;
}

.feature-card {
    background: white;
    padding: 2rem;
    border-radius: 0.5rem;
    box-shadow: var(--shadow);
    transition: transform 0.3s;
}

.feature-card:hover {
    transform: translateY(-4px);
}

.feature-card h3 {
    color: var(--primary-color);
    margin-bottom: 0.5rem;
}

/* About Section */
.about {
    padding: 4rem 0;
    text-align: center;
}

.about h2 {
    font-size: 2rem;
    margin-bottom: 1rem;
    color: var(--secondary-color);
}

/* Contact Section */
.contact {
    padding: 4rem 0;
    background-color: var(--light-bg);
    text-align: center;
}

.contact h2 {
    font-size: 2rem;
    margin-bottom: 1rem;
    color: var(--secondary-color);
}

/* Footer */
.footer {
    background: var(--secondary-color);
    color: white;
    text-align: center;
    padding: 2rem;
    margin-top: 4rem;
}

/* Responsive Design */
@media (max-width: 768px) {
    .hero h1 {
        font-size: 2rem;
    }

    .nav-links {
        gap: 1rem;
    }

    .navbar {
        padding: 0 1rem;
    }

    .container {
        padding: 0 1rem;
    }
}`,

      'script.js': `// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ Website loaded successfully');
    
    // Smooth scroll for navigation
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });

    // CTA button click
    document.querySelector('.cta-button')?.addEventListener('click', () => {
        alert('Welcome! Thank you for your interest.');
    });

    // Log page info
    console.log('📄 Page:', document.title);
    console.log('📱 Device:', window.innerWidth > 768 ? 'Desktop' : 'Mobile');
});

// Helper functions
window.scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
};`,

      'README.md': `# ${name}

${description}

## Features
- Modern, responsive design
- Production-ready code
- Professional layout
- Fast performance
- SEO optimized

## Project Structure
\`\`\`
${name}/
├── index.html       # Main HTML file
├── style.css        # Styles
├── script.js        # JavaScript
└── README.md        # Documentation
\`\`\`

## Getting Started

1. Extract the project folder
2. Open \`index.html\` in a web browser
3. Customize the content as needed

## Technologies
- HTML5
- CSS3
- JavaScript (Vanilla)

## License
Free to use and modify.

## Created with AI Startup Builder
This project was generated using AI technology for rapid development.`
    },
    structure: {
      description,
      technologies: ['HTML5', 'CSS3', 'JavaScript', 'Responsive Design'],
      features: ['Modern Design', 'Mobile Responsive', 'Production Ready']
    }
  };
}

// ==================== AUTH ====================
const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ==================== ROUTES ====================
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    const db = await readDB();
    
    if (db.users.some(u => u.email === email)) {
      return res.status(400).json({ error: 'User exists' });
    }

    const user = {
      id: genId(),
      email,
      password: await bcrypt.hash(password, 10),
      fullName,
      createdAt: new Date().toISOString(),
    };

    db.users.push(user);
    await writeDB(db);

    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: user.id, email, fullName }, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = await readDB();
    const user = db.users.find(u => u.email === email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: user.id, email, fullName: user.fullName }, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', auth, async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: 'Description required' });

    console.log('🚀 Generating project with Grok...');
    
    // Generate project with Grok
    const projectData = await generateProjectWithGrok(description);

    const db = await readDB();
    const project = {
      id: genId(),
      userId: req.user.id,
      name: projectData.name || 'Project',
      description: description.slice(0, 200),
      pages: projectData.pages,
      structure: projectData.structure,
      status: 'generated',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.projects.push(project);
    await writeDB(db);

    console.log('✅ Project generated:', project.id);
    res.json(project);
  } catch (err) {
    console.error('❌ Project generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects', auth, async (req, res) => {
  try {
    const db = await readDB();
    const projects = db.projects.filter(p => p.userId === req.user.id);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id', auth, async (req, res) => {
  try {
    const db = await readDB();
    const project = db.projects.find(p => p.id === req.params.id && p.userId === req.user.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', auth, async (req, res) => {
  try {
    const db = await readDB();
    const project = db.projects.find(p => p.id === req.params.id && p.userId === req.user.id);
    if (!project) return res.status(404).json({ error: 'Not found' });

    Object.assign(project, req.body, { updatedAt: new Date().toISOString() });
    await writeDB(db);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  try {
    const db = await readDB();
    db.projects = db.projects.filter(p => !(p.id === req.params.id && p.userId === req.user.id));
    await writeDB(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== EXPORT PROJECT ====================
app.get('/api/projects/:id/download', auth, async (req, res) => {
  try {
    const db = await readDB();
    const project = db.projects.find(p => p.id === req.params.id && p.userId === req.user.id);
    if (!project) return res.status(404).json({ error: 'Not found' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(project.name)}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Add project files
    if (project.pages) {
      Object.entries(project.pages).forEach(([filename, content]) => {
        archive.append(content, { name: filename });
      });
    }

    // Add project metadata
    archive.append(JSON.stringify(project.structure, null, 2), { name: '.project.json' });

    archive.finalize();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/preview', auth, async (req, res) => {
  try {
    const db = await readDB();
    const project = db.projects.find(p => p.id === req.params.id && p.userId === req.user.id);
    if (!project) return res.status(404).json({ error: 'Not found' });

    // Return HTML for preview
    res.type('text/html').send(project.pages['index.html'] || '');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== HEALTH ====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║     AI Startup Builder - Grok Edition  ║
║   Full Project Generation System       ║
╚════════════════════════════════════════╝

✅ Server: http://localhost:${PORT}
✅ Grok AI: ${process.env.XAI_API_KEY ? 'Connected' : 'Using templates'}
✅ Database: ${DB_PATH}

📌 Endpoints:
  POST   /api/register
  POST   /api/login
  GET    /api/projects
  POST   /api/projects              ← Generates full project
  GET    /api/projects/:id
  GET    /api/projects/:id/preview  ← Live preview
  GET    /api/projects/:id/download ← Full ZIP export
  PUT    /api/projects/:id
  DELETE /api/projects/:id
  GET    /health
  `);
});
