const { Pool } = require('pg');
const crypto = require('crypto');

const state = {
  enabled: false,
  pool: null,
  schemaReady: false,
  pendingTimer: null,
  lastSnapshot: null,
  lastSyncAt: null,
  lastError: null,
  syncing: false,
  lastConsistencyReport: null,
  consistencyTimer: null,
  lastAlertAt: null,
  lastAlertError: null,
};

function getAlertWebhookUrl() {
  return String(process.env.PG_CONSISTENCY_ALERT_WEBHOOK_URL || '').trim();
}

function getAlertChannel() {
  return String(process.env.PG_CONSISTENCY_ALERT_CHANNEL || 'generic').trim().toLowerCase();
}

function getTelegramBotToken() {
  return String(process.env.PG_CONSISTENCY_ALERT_TELEGRAM_BOT_TOKEN || '').trim();
}

function getTelegramChatId() {
  return String(process.env.PG_CONSISTENCY_ALERT_TELEGRAM_CHAT_ID || '').trim();
}

function getAlertCooldownMs() {
  return Number(process.env.PG_CONSISTENCY_ALERT_COOLDOWN_MS || 300000);
}

function getAlertTimeoutMs() {
  return Number(process.env.PG_CONSISTENCY_ALERT_TIMEOUT_MS || 8000);
}

async function sendConsistencyAlert(report) {
  const channel = getAlertChannel();
  const webhookUrl = getAlertWebhookUrl();
  const telegramToken = getTelegramBotToken();
  const telegramChatId = getTelegramChatId();

  if (channel !== 'telegram' && !webhookUrl) {
    return { sent: false, skipped: true, reason: 'webhook not configured' };
  }
  if (channel === 'telegram' && (!telegramToken || !telegramChatId) && !webhookUrl) {
    return { sent: false, skipped: true, reason: 'telegram config missing' };
  }

  const now = Date.now();
  const lastAlertTs = state.lastAlertAt ? Date.parse(state.lastAlertAt) : 0;
  if (lastAlertTs && now - lastAlertTs < getAlertCooldownMs()) {
    return { sent: false, skipped: true, reason: 'cooldown active' };
  }

  const payload = {
    title: 'AI Startup Builder: PostgreSQL consistency mismatch',
    level: 'error',
    service: 'ai-startup-builder-server',
    checkedAt: report.checkedAt,
    reason: report.reason,
    users: report.users || null,
    projects: report.projects || null,
    error: report.error || null,
  };

  const shortMessage = [
    'AI Startup Builder consistency mismatch',
    `checkedAt: ${report.checkedAt}`,
    `reason: ${report.reason}`,
    report.error ? `error: ${report.error}` : null,
    report.users ? `users changed/missing: ${report.users.changed?.length || 0}/${report.users.missingInPg?.length || 0}/${report.users.missingInJson?.length || 0}` : null,
    report.projects ? `projects changed/missing: ${report.projects.changed?.length || 0}/${report.projects.missingInPg?.length || 0}/${report.projects.missingInJson?.length || 0}` : null,
  ].filter(Boolean).join('\n');

  const slackPayload = {
    text: shortMessage,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*AI Startup Builder*\n:warning: PostgreSQL consistency mismatch`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Checked at*\n${report.checkedAt}` },
          { type: 'mrkdwn', text: `*Reason*\n${report.reason}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Users changed: ${report.users?.changed?.length || 0}; missingInPg: ${report.users?.missingInPg?.length || 0}; missingInJson: ${report.users?.missingInJson?.length || 0}\nProjects changed: ${report.projects?.changed?.length || 0}; missingInPg: ${report.projects?.missingInPg?.length || 0}; missingInJson: ${report.projects?.missingInJson?.length || 0}`,
        },
      },
    ],
  };

  const discordPayload = {
    content: ':warning: PostgreSQL consistency mismatch',
    embeds: [
      {
        title: 'AI Startup Builder consistency alert',
        description: shortMessage,
        color: 15158332,
      },
    ],
  };

  const telegramText = [
    '*AI Startup Builder*',
    '⚠️ PostgreSQL consistency mismatch',
    `checkedAt: ${report.checkedAt}`,
    `reason: ${report.reason}`,
    report.error ? `error: ${report.error}` : null,
    `users changed: ${report.users?.changed?.length || 0}, missingInPg: ${report.users?.missingInPg?.length || 0}, missingInJson: ${report.users?.missingInJson?.length || 0}`,
    `projects changed: ${report.projects?.changed?.length || 0}, missingInPg: ${report.projects?.missingInPg?.length || 0}, missingInJson: ${report.projects?.missingInJson?.length || 0}`,
  ].filter(Boolean).join('\n');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getAlertTimeoutMs());

    let response;
    if (channel === 'slack') {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackPayload),
        signal: controller.signal,
      });
    } else if (channel === 'discord') {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload),
        signal: controller.signal,
      });
    } else if (channel === 'telegram') {
      const telegramUrl = webhookUrl || `https://api.telegram.org/bot${telegramToken}/sendMessage`;
      response = await fetch(telegramUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: telegramText,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
    } else {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    }

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      state.lastAlertError = `HTTP ${response.status}: ${errText.slice(0, 180)}`;
      return { sent: false, skipped: false, reason: state.lastAlertError };
    }

    state.lastAlertAt = new Date().toISOString();
    state.lastAlertError = null;
    return { sent: true, skipped: false };
  } catch (error) {
    state.lastAlertError = error.message;
    return { sent: false, skipped: false, reason: error.message };
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function makeDigest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function asUserId(item) {
  return String(item?._id || item?.id || '');
}

function asProjectId(item) {
  return String(item?._id || item?.id || '');
}

function buildEntityMap(items, idSelector) {
  const map = new Map();
  for (const item of items) {
    const id = idSelector(item);
    if (!id) continue;
    map.set(id, stableStringify(item));
  }
  return map;
}

function compareEntityMaps(jsonMap, pgMap) {
  const missingInPg = [];
  const missingInJson = [];
  const changed = [];

  for (const [id, jsonPayload] of jsonMap.entries()) {
    if (!pgMap.has(id)) {
      missingInPg.push(id);
      continue;
    }
    if (pgMap.get(id) !== jsonPayload) {
      changed.push(id);
    }
  }

  for (const id of pgMap.keys()) {
    if (!jsonMap.has(id)) {
      missingInJson.push(id);
    }
  }

  const digest = makeDigest(
    [...jsonMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, payload]) => `${id}:${payload}`)
      .join('|')
  );

  return {
    digest,
    counts: {
      json: jsonMap.size,
      pg: pgMap.size,
    },
    missingInPg,
    missingInJson,
    changed,
    ok: missingInPg.length === 0 && missingInJson.length === 0 && changed.length === 0,
  };
}

function isEnabled() {
  const mirrorEnabled = String(process.env.PG_MIRROR_ENABLED || '').toLowerCase() === 'true';
  const primaryEnabled = String(process.env.PG_PRIMARY_ENABLED || '').toLowerCase() === 'true';
  return (mirrorEnabled || primaryEnabled) && Boolean(process.env.DATABASE_URL);
}

function getMode() {
  return process.env.PG_SSL_MODE || 'disable';
}

function buildSslConfig() {
  const mode = getMode();
  if (mode === 'require' || mode === 'no-verify') {
    return { rejectUnauthorized: mode !== 'no-verify' };
  }
  return false;
}

async function init() {
  state.enabled = isEnabled();
  if (!state.enabled) {
    return;
  }

  if (!state.pool) {
    state.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: buildSslConfig(),
      max: Number(process.env.PG_POOL_MAX || 10),
    });
  }

  if (!state.schemaReady) {
    const ddl = `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_data_gin ON users USING GIN(data);
      CREATE INDEX IF NOT EXISTS idx_projects_data_gin ON projects USING GIN(data);
    `;

    await state.pool.query(ddl);
    state.schemaReady = true;
  }
}

async function syncSnapshot(snapshot, reason = 'runtime') {
  if (!state.enabled) {
    return { ok: false, skipped: true, reason: 'mirror disabled' };
  }

  await init();
  if (state.syncing) {
    state.lastSnapshot = snapshot;
    return { ok: true, queued: true };
  }

  state.syncing = true;
  const users = Array.isArray(snapshot?.users) ? snapshot.users : [];
  const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
  const userIds = users
    .map(item => String(item?._id || item?.id || ''))
    .filter(Boolean);
  const projectIds = projects
    .map(item => String(item?._id || item?.id || ''))
    .filter(Boolean);

  const client = await state.pool.connect();
  try {
    await client.query('BEGIN');

    for (const user of users) {
      const id = String(user?._id || user?.id || '');
      if (!id || !user?.email) continue;
      await client.query(
        `
          INSERT INTO users (id, email, data, updated_at)
          VALUES ($1, $2, $3::jsonb, NOW())
          ON CONFLICT (id)
          DO UPDATE SET
            email = EXCLUDED.email,
            data = EXCLUDED.data,
            updated_at = NOW()
        `,
        [id, user.email, JSON.stringify(user)]
      );
    }

    for (const project of projects) {
      const id = String(project?._id || project?.id || '');
      const userId = String(project?.userId || '');
      if (!id || !userId) continue;
      await client.query(
        `
          INSERT INTO projects (id, user_id, data, updated_at)
          VALUES ($1, $2, $3::jsonb, NOW())
          ON CONFLICT (id)
          DO UPDATE SET
            user_id = EXCLUDED.user_id,
            data = EXCLUDED.data,
            updated_at = NOW()
        `,
        [id, userId, JSON.stringify(project)]
      );
    }

    if (userIds.length > 0) {
      await client.query('DELETE FROM users WHERE id <> ALL($1::text[])', [userIds]);
    } else {
      await client.query('DELETE FROM users');
    }

    if (projectIds.length > 0) {
      await client.query('DELETE FROM projects WHERE id <> ALL($1::text[])', [projectIds]);
    } else {
      await client.query('DELETE FROM projects');
    }

    await client.query('COMMIT');
    state.lastSyncAt = new Date().toISOString();
    state.lastError = null;

    return {
      ok: true,
      reason,
      usersSynced: users.length,
      projectsSynced: projects.length,
      syncedAt: state.lastSyncAt,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    state.lastError = error.message;
    return { ok: false, reason, error: error.message };
  } finally {
    client.release();
    state.syncing = false;

    if (state.lastSnapshot) {
      const queued = state.lastSnapshot;
      state.lastSnapshot = null;
      void syncSnapshot(queued, 'queued');
    }
  }
}

async function writeSnapshot(snapshot, reason = 'primary_write') {
  return syncSnapshot(snapshot, reason);
}

async function readSnapshot() {
  if (!isEnabled()) {
    return null;
  }

  await init();

  const [usersRes, projectsRes] = await Promise.all([
    state.pool.query('SELECT data FROM users ORDER BY updated_at DESC'),
    state.pool.query('SELECT data FROM projects ORDER BY updated_at DESC'),
  ]);

  return {
    users: usersRes.rows.map(row => row.data),
    projects: projectsRes.rows.map(row => row.data),
  };
}

function queueSync(snapshot, reason = 'runtime') {
  if (!isEnabled()) return;
  state.enabled = true;

  state.lastSnapshot = snapshot;
  if (state.pendingTimer) {
    clearTimeout(state.pendingTimer);
  }

  const debounceMs = Number(process.env.PG_MIRROR_DEBOUNCE_MS || 1200);
  state.pendingTimer = setTimeout(() => {
    state.pendingTimer = null;
    const next = state.lastSnapshot;
    state.lastSnapshot = null;
    if (!next) return;
    void syncSnapshot(next, reason);
  }, debounceMs);
}

function getStatus() {
  return {
    enabled: isEnabled(),
    schemaReady: state.schemaReady,
    lastSyncAt: state.lastSyncAt,
    syncing: state.syncing,
    hasPendingSnapshot: Boolean(state.lastSnapshot),
    lastError: state.lastError,
    lastConsistencyReport: state.lastConsistencyReport,
    alerting: {
      webhookConfigured: Boolean(getAlertWebhookUrl()),
      channel: getAlertChannel(),
      cooldownMs: getAlertCooldownMs(),
      lastAlertAt: state.lastAlertAt,
      lastAlertError: state.lastAlertError,
    },
  };
}

async function checkConsistency(jsonSnapshot, reason = 'manual') {
  if (!isEnabled()) {
    const report = {
      ok: false,
      reason,
      checkedAt: new Date().toISOString(),
      error: 'mirror disabled',
    };
    state.lastConsistencyReport = report;
    return report;
  }

  try {
    const pgSnapshot = await readSnapshot();
    const safeJson = {
      users: Array.isArray(jsonSnapshot?.users) ? jsonSnapshot.users : [],
      projects: Array.isArray(jsonSnapshot?.projects) ? jsonSnapshot.projects : [],
    };
    const safePg = {
      users: Array.isArray(pgSnapshot?.users) ? pgSnapshot.users : [],
      projects: Array.isArray(pgSnapshot?.projects) ? pgSnapshot.projects : [],
    };

    const userCompare = compareEntityMaps(
      buildEntityMap(safeJson.users, asUserId),
      buildEntityMap(safePg.users, asUserId)
    );
    const projectCompare = compareEntityMaps(
      buildEntityMap(safeJson.projects, asProjectId),
      buildEntityMap(safePg.projects, asProjectId)
    );

    const report = {
      ok: userCompare.ok && projectCompare.ok,
      reason,
      checkedAt: new Date().toISOString(),
      users: {
        counts: userCompare.counts,
        digest: userCompare.digest,
        missingInPg: userCompare.missingInPg.slice(0, 20),
        missingInJson: userCompare.missingInJson.slice(0, 20),
        changed: userCompare.changed.slice(0, 20),
      },
      projects: {
        counts: projectCompare.counts,
        digest: projectCompare.digest,
        missingInPg: projectCompare.missingInPg.slice(0, 20),
        missingInJson: projectCompare.missingInJson.slice(0, 20),
        changed: projectCompare.changed.slice(0, 20),
      },
    };

    state.lastConsistencyReport = report;
    if (!report.ok) {
      const alertResult = await sendConsistencyAlert(report);
      report.alert = alertResult;
      state.lastConsistencyReport = report;
    }
    return report;
  } catch (error) {
    const report = {
      ok: false,
      reason,
      checkedAt: new Date().toISOString(),
      error: error.message,
    };
    state.lastConsistencyReport = report;
    const alertResult = await sendConsistencyAlert(report);
    report.alert = alertResult;
    state.lastConsistencyReport = report;
    return report;
  }
}

function startConsistencyChecks(snapshotProvider) {
  const enabled = String(process.env.PG_CONSISTENCY_CHECK_ENABLED || '').toLowerCase() === 'true';
  if (!enabled || typeof snapshotProvider !== 'function') {
    return;
  }

  if (state.consistencyTimer) {
    clearInterval(state.consistencyTimer);
    state.consistencyTimer = null;
  }

  const intervalMs = Number(process.env.PG_CONSISTENCY_CHECK_INTERVAL_MS || 60000);
  state.consistencyTimer = setInterval(async () => {
    try {
      const snapshot = await snapshotProvider();
      await checkConsistency(snapshot, 'auto_interval');
    } catch (error) {
      state.lastConsistencyReport = {
        ok: false,
        reason: 'auto_interval',
        checkedAt: new Date().toISOString(),
        error: error.message,
      };
    }
  }, intervalMs);
}

async function close() {
  if (state.pendingTimer) {
    clearTimeout(state.pendingTimer);
    state.pendingTimer = null;
  }

  if (state.consistencyTimer) {
    clearInterval(state.consistencyTimer);
    state.consistencyTimer = null;
  }

  if (state.pool) {
    await state.pool.end();
    state.pool = null;
  }
}

module.exports = {
  init,
  queueSync,
  syncSnapshot,
  writeSnapshot,
  readSnapshot,
  checkConsistency,
  startConsistencyChecks,
  getStatus,
  close,
};
