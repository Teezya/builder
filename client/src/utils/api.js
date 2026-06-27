/**
 * API Client с кэшированием и оптимизацией
 */
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const client = axios.create({
  baseURL: API_URL,
  timeout: 30000,
});

const isNotFoundError = (error) => String(error).includes('404');

const normalizeProject = (project) => {
  if (!project || typeof project !== 'object') {
    return project;
  }

  return {
    ...project,
    id: project.id || project._id,
  };
};

const buildLocalGeneratedCode = (project) => {
  const projectName = project?.name || 'MyProject';
  const safeName = projectName.replace(/[^a-zA-Z0-9]/g, '') || 'Project';

  return {
    frontend: `import React from 'react';\n\nexport default function ${safeName}Page() {\n  return (\n    <main>\n      <h1>${projectName}</h1>\n      <p>${project?.description || 'Project generated locally.'}</p>\n    </main>\n  );\n}`,
    backend: `const express = require('express');\nconst router = express.Router();\n\nrouter.get('/health', (req, res) => {\n  res.json({ status: 'ok', service: '${safeName}' });\n});\n\nmodule.exports = router;`,
    database: `-- ${projectName}\nCREATE TABLE projects (\n  id UUID PRIMARY KEY,\n  name VARCHAR(255) NOT NULL,\n  description TEXT,\n  created_at TIMESTAMP DEFAULT NOW()\n);`,
  };
};

// Request interceptor - добавляем токен
client.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor - обработка ошибок
client.interceptors.response.use(
  response => response.data,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    throw error.response?.data?.error || error.message;
  }
);

// Cache для GET запросов
const cache = new Map();

export const api = {
  // Auth
  register: async (email, password, fullName) => {
    try {
      return await client.post('/register', { email, password, fullName });
    } catch (error) {
      if (String(error).includes('404')) {
        return client.post('/auth/register', { email, password, fullName });
      }
      throw error;
    }
  },

  login: async (email, password) => {
    try {
      return await client.post('/login', { email, password });
    } catch (error) {
      if (String(error).includes('404')) {
        return client.post('/auth/login', { email, password });
      }
      throw error;
    }
  },

  // Account
  getAccountUsage: () => client.get('/account/usage'),

  getAccountProfile: async () => {
    try {
      return await client.get('/account/profile');
    } catch (error) {
      if (isNotFoundError(error)) {
        return client.get('/account/usage');
      }
      throw error;
    }
  },

  updateAccountProfile: (fullName) => client.patch('/account/profile', { fullName }),
  getPlans: () => client.get('/plans'),
  getSubscription: () => client.get('/account/subscription'),
  checkoutSubscription: (plan) => client.post('/account/subscription/checkout', { plan }),
  changePlan: (plan) => client.patch('/account/plan', { plan }),
  
  // Projects
  getProjects: async () => {
    const key = 'projects-list';
    if (cache.has(key)) return cache.get(key);
    const data = await client.get('/projects');
    const normalized = Array.isArray(data) ? data.map(normalizeProject) : [];
    cache.set(key, normalized);
    return normalized;
  },
  
  getProject: async (id) => {
    const key = `project-${id}`;
    if (cache.has(key)) return cache.get(key);
    const data = await client.get(`/projects/${id}`);
    const normalized = normalizeProject(data);
    cache.set(key, normalized);
    return normalized;
  },
  
  createProject: async (description, template) => {
    cache.delete('projects-list'); // Инвалидировать кэш
    const data = await client.post('/projects', { description, template });
    return normalizeProject(data);
  },
  
  updateProject: async (id, updates) => {
    cache.delete('projects-list');
    cache.delete(`project-${id}`);
    const data = await client.put(`/projects/${id}`, updates);
    return normalizeProject(data);
  },
  
  deleteProject: (id) => {
    cache.delete('projects-list');
    cache.delete(`project-${id}`);
    return client.delete(`/projects/${id}`);
  },
  
  downloadProject: async (id) => {
    try {
      return await client.get(`/projects/${id}/download`, { responseType: 'blob' });
    } catch (error) {
      if (isNotFoundError(error)) {
        return client.get(`/projects/${id}/export`, { responseType: 'blob' });
      }
      throw error;
    }
  },

  generateCode: async (id, project) => {
    try {
      return await client.post(`/projects/${id}/generate-code`);
    } catch (error) {
      if (isNotFoundError(error)) {
        return buildLocalGeneratedCode(project);
      }
      throw error;
    }
  },
  
  clearCache: () => cache.clear(),
};

export default client;
