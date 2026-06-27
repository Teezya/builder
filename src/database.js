/**
 * JSON Database Module с кэшированием и оптимизацией
 */
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

class Database {
  constructor() {
    this.dbPath = config.DB_PATH;
    this.cache = null;
    this.isDirty = false;
    this.writeTimeout = null;
    this.locks = new Map();
  }

  // Получить данные с кэшем
  async read() {
    if (this.cache) {
      return structuredClone(this.cache);
    }
    
    try {
      const data = await fs.readFile(this.dbPath, 'utf8');
      this.cache = JSON.parse(data);
      return structuredClone(this.cache);
    } catch (error) {
      // Инициализация пустой БД
      this.cache = { users: [], projects: [] };
      await this.write(this.cache);
      return structuredClone(this.cache);
    }
  }

  // Запись с debouncing (избежать частых записей)
  async write(data) {
    this.cache = structuredClone(data);
    this.isDirty = true;
    
    // Отменить предыдущую запись, если она запланирована
    if (this.writeTimeout) clearTimeout(this.writeTimeout);
    
    // Запланировать запись через 1 секунду (объединение нескольких операций)
    return new Promise((resolve) => {
      this.writeTimeout = setTimeout(async () => {
        try {
          await fs.writeFile(this.dbPath, JSON.stringify(this.cache, null, 2), 'utf8');
          this.isDirty = false;
          console.log('✅ DB saved');
          resolve();
        } catch (error) {
          console.error('❌ DB write error:', error.message);
          resolve();
        }
      }, 1000);
    });
  }

  // Обновить конкретную коллекцию
  async updateCollection(collectionName, updater) {
    const data = await this.read();
    if (!data[collectionName]) {
      data[collectionName] = [];
    }
    data[collectionName] = updater(data[collectionName]);
    await this.write(data);
    return data[collectionName];
  }

  // Найти элемент по ID
  async findById(collectionName, id) {
    const data = await this.read();
    return (data[collectionName] || []).find(item => item.id === id);
  }

  // Найти все элементы с фильтром
  async find(collectionName, filter = {}) {
    const data = await this.read();
    let items = data[collectionName] || [];
    
    Object.entries(filter).forEach(([key, value]) => {
      items = items.filter(item => item[key] === value);
    });
    
    return items;
  }

  // Создать элемент
  async create(collectionName, item) {
    const data = await this.read();
    if (!data[collectionName]) data[collectionName] = [];
    
    const newItem = {
      ...item,
      id: item.id || crypto.randomBytes(12).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    
    data[collectionName].push(newItem);
    await this.write(data);
    return newItem;
  }

  // Обновить элемент
  async update(collectionName, id, updates) {
    const data = await this.read();
    const items = data[collectionName] || [];
    const index = items.findIndex(item => item.id === id);
    
    if (index === -1) throw new Error(`${collectionName} not found`);
    
    items[index] = {
      ...items[index],
      ...updates,
      updatedAt: new Date().toISOString(),
      id: items[index].id, // Не перезаписываем ID
      createdAt: items[index].createdAt, // Не перезаписываем дату создания
    };
    
    data[collectionName] = items;
    await this.write(data);
    return items[index];
  }

  // Удалить элемент
  async delete(collectionName, id) {
    const data = await this.read();
    const items = data[collectionName] || [];
    const index = items.findIndex(item => item.id === id);
    
    if (index === -1) throw new Error(`${collectionName} not found`);
    
    const deleted = items[index];
    data[collectionName] = items.filter(item => item.id !== id);
    await this.write(data);
    return deleted;
  }

  // Очистить кэш
  flushCache() {
    this.cache = null;
  }
}

module.exports = new Database();
