/**
 * Утилиты для обработки текста, валидации и трансформации данных
 */

function normalizeText(value) {
  return String(value || '').trim();
}

function slugify(value) {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return slug || 'project';
}

function shortDesc(value, maxLen = 180) {
  let s = String(value || '').trim();
  s = s.replace(/^(промт|prompt|описание|description)\s*:\s*/i, '');
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
  return /<!doctype|<html|<body|<head|<style|<script|<div|<section|<main|<header|<footer|<nav/.test(normalized);
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

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(normalizeText(email));
}

function validateProjectName(name) {
  const normalized = normalizeText(name);
  return normalized.length >= 3 && normalized.length <= 100;
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

module.exports = {
  normalizeText,
  slugify,
  shortDesc,
  normalizeList,
  stripCodeBlocks,
  extractHtmlSegment,
  looksLikeHtmlContent,
  extractJsonObject,
  generateProjectName,
  toPascalCase,
  sanitizeArchiveBaseName,
  toAsciiArchiveBaseName,
  validateEmail,
  validateProjectName,
  validateHtmlOutput,
  isNoCodeBuilderIdea,
};
