// Minimal Vercel endpoint for PitProfile app services.
// Routes:
//   GET  /api/app?kind=health
//   POST /api/app?kind=support-submit

const nodemailer = require('nodemailer');

const VALID_TYPES = new Set(['feedback', 'bug', 'question']);
const MAX_MESSAGE_CHARS = 5000;
const MAX_PATH_ITEMS = 6;
const MAX_DIAGNOSTICS_CHARS = 24000;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function clampText(value, max = 1000) {
  const text = String(value || '').replace(/\u0000/g, '').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function optionalEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

function getKind(req) {
  try {
    if (typeof req?.query?.kind === 'string' && req.query.kind.trim()) return req.query.kind.trim().toLowerCase();
  } catch (_) {}
  try {
    const url = new URL(req.url, 'http://localhost');
    return String(url.searchParams.get('kind') || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

function allowedOrigins() {
  const explicit = optionalEnv('PITPROFILE_ALLOWED_ORIGINS')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return [
    ...explicit,
    'https://pitprofile.com',
    'https://www.pitprofile.com',
    'https://pitprofile.vercel.app',
    /^https:\/\/pitprofile-[a-z0-9-]+\.vercel\.app$/i,
    /^http:\/\/localhost(?::\d+)?$/i,
    /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  ];
}

function matchesAllowedOrigin(origin, rule) {
  if (!origin || !rule) return false;
  if (typeof rule === 'string') return rule === origin;
  if (rule instanceof RegExp) return rule.test(origin);
  return false;
}

function withCors(req, res) {
  const origin = req.headers.origin;
  let allowedOrigin = '';
  if (!origin) allowedOrigin = '*';
  else if (allowedOrigins().some((rule) => matchesAllowedOrigin(origin, rule))) allowedOrigin = origin;

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function normalizeType(value) {
  const type = String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (type === 'bug-report') return 'bug';
  return VALID_TYPES.has(type) ? type : '';
}

function normalizePath(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split('>');
  return raw.map((item) => clampText(item, 80)).filter(Boolean).slice(0, MAX_PATH_ITEMS);
}

function readMailerConfig() {
  const port = Number(optionalEnv('MAILGUN_SMTP_PORT', '587'));
  return {
    from: optionalEnv('FROM_EMAIL'),
    to: optionalEnv('TO_EMAIL'),
    host: optionalEnv('MAILGUN_SMTP_SERVER', 'smtp.mailgun.org'),
    port: Number.isFinite(port) && port > 0 ? port : 587,
    user: optionalEnv('MAILGUN_SMTP_LOGIN'),
    pass: optionalEnv('MAILGUN_SMTP_PASSWORD'),
  };
}

function missingMailerFields(config) {
  const missing = [];
  if (!config.from) missing.push('FROM_EMAIL');
  if (!config.to) missing.push('TO_EMAIL');
  if (!config.host) missing.push('MAILGUN_SMTP_SERVER');
  if (!config.port) missing.push('MAILGUN_SMTP_PORT');
  if (!config.user) missing.push('MAILGUN_SMTP_LOGIN');
  if (!config.pass) missing.push('MAILGUN_SMTP_PASSWORD');
  return missing;
}

function safeJson(value, maxChars = MAX_DIAGNOSTICS_CHARS) {
  let text = '';
  try {
    text = JSON.stringify(value || {}, null, 2);
  } catch (_) {
    text = '{}';
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
}

function safeFilename(value) {
  const name = clampText(value, 120).replace(/[^a-z0-9._-]+/gi, '_');
  return name || 'pitprofile-support-screenshot.png';
}

function parseDataUrlAttachment(input) {
  if (!input || typeof input !== 'object') return null;
  const dataUrl = String(input.dataUrl || '').trim();
  const match = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(contentType)) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) return null;
  return {
    filename: safeFilename(input.filename || `pitprofile-support-screenshot.${contentType.split('/')[1] || 'png'}`),
    content: buffer,
    contentType,
  };
}

function buildEmailText({ type, path, message, contactEmail, context, diagnostics, transcript }) {
  const identity = contactEmail || context?.team?.memberName || context?.team?.member || 'anonymous/public';
  const teamName = context?.team?.teamName || context?.team?.name || 'unknown';
  const route = context?.location?.href || context?.route || 'unknown';
  return [
    'New PitProfile support message', '',
    `Type: ${type}`,
    `Path: ${path.length ? path.join(' > ') : 'unknown'}`,
    `Identity: ${identity}`,
    `Team: ${teamName}`,
    `Route: ${route}`,
    `Timestamp: ${new Date().toISOString()}`,
    '', 'Message:', message,
    '', 'Transcript:', safeJson(transcript || [], 8000),
    '', 'Context:', safeJson(context || {}, 8000),
    '', 'Diagnostics:', safeJson(diagnostics || {}, MAX_DIAGNOSTICS_CHARS),
  ].join('\n');
}

async function sendSupportEmail(config, payload) {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port === 587,
    auth: { user: config.user, pass: config.pass },
  });

  const subjectPath = payload.path.length ? payload.path.join(' > ') : 'General';
  const attachments = [];
  const screenshot = parseDataUrlAttachment(payload.screenshot);
  if (screenshot) attachments.push(screenshot);

  return transport.sendMail({
    from: config.from,
    to: config.to,
    replyTo: payload.contactEmail || undefined,
    subject: `[PitProfile Support] ${payload.type}: ${subjectPath}`.slice(0, 160),
    text: buildEmailText(payload),
    attachments,
  });
}

function handleHealth(req, res) {
  if (withCors(req, res)) return;
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'Method not allowed. Use GET.' });
  return json(res, 200, { ok: true, app: 'pitprofile', service: 'app', time: new Date().toISOString() });
}

async function handleSupportSubmit(req, res) {
  if (withCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed. Use POST.' });

  const body = await readJsonBody(req);
  const type = normalizeType(body?.type);
  const message = clampText(body?.message, MAX_MESSAGE_CHARS);
  const path = normalizePath(body?.path);
  const contactEmail = clampText(body?.contactEmail, 254);

  if (!type) return json(res, 400, { ok: false, error: 'Invalid support message type.' });
  if (!message) return json(res, 400, { ok: false, error: 'Message is required.' });

  const config = readMailerConfig();
  const missing = missingMailerFields(config);
  if (missing.length) return json(res, 503, { ok: false, error: 'Support mailer is not configured.', missing });

  const payload = {
    type,
    path,
    message,
    contactEmail,
    context: body?.context && typeof body.context === 'object' ? body.context : {},
    diagnostics: body?.diagnostics && typeof body.diagnostics === 'object' ? body.diagnostics : {},
    transcript: Array.isArray(body?.transcript) ? body.transcript.slice(-30) : [],
    screenshot: body?.screenshot || null,
  };

  try {
    const sent = await sendSupportEmail(config, payload);
    return json(res, 200, { ok: true, id: sent?.messageId || null, delivered: true });
  } catch (err) {
    return json(res, 502, { ok: false, error: 'Support message could not be sent.', detail: clampText(err?.message || err, 500) });
  }
}

module.exports = async function handler(req, res) {
  const kind = getKind(req) || 'health';
  if (kind === 'health') return handleHealth(req, res);
  if (kind === 'support-submit') return handleSupportSubmit(req, res);
  return json(res, 400, { ok: false, error: 'Unknown app endpoint kind.', expected: ['health', 'support-submit'] });
};
