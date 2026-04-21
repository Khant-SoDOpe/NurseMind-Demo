require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const cookieParser = require('cookie-parser');
const { v2: cloudinary } = require('cloudinary');
const { createClient } = require('redis');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || 'medihack-dashboard-secret-change-this-in-production';

if (IS_PROD && SESSION_SECRET === 'medihack-dashboard-secret-change-this-in-production') {
    console.warn('[WARN] Running in production with the default SESSION_SECRET. Set SESSION_SECRET in your environment!');
}

// Parse ALLOWED_ORIGINS: comma-separated list of exact origins, or "*" for any.
// Example: ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
const rawAllowedOrigins = (process.env.ALLOWED_ORIGINS || '').trim();
const allowAnyOrigin = rawAllowedOrigins === '*';
const allowedOrigins = rawAllowedOrigins && !allowAnyOrigin
    ? rawAllowedOrigins.split(',').map(s => s.trim()).filter(Boolean)
    : [];

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Behind nginx/Caddy/Cloudflare/etc. Needed so secure cookies + rate-limit work.
// Set TRUST_PROXY=1 (or a hop count, or "true") when deploying behind a proxy.
const trustProxySetting = process.env.TRUST_PROXY;
if (trustProxySetting !== undefined && trustProxySetting !== '') {
    const n = Number(trustProxySetting);
    app.set('trust proxy', Number.isFinite(n) ? n : trustProxySetting);
} else if (IS_PROD) {
    app.set('trust proxy', 1);
}

// Security headers. CSP disabled because index.html uses inline styles/scripts.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Gzip responses
app.use(compression());

// Middleware
const corsOptions = {
    origin: (origin, callback) => {
        // Same-origin / curl / server-to-server (no Origin header) — always allow.
        if (!origin) return callback(null, true);
        if (allowAnyOrigin) return callback(null, true);
        if (allowedOrigins.length === 0) {
            // No list configured => reflect origin (dev-friendly default).
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(cookieParser());

// Sessions — backed by Redis when REDIS_URL is set so logins survive restarts
// and scale across instances. Falls back to MemoryStore otherwise (dev only).
let sessionRedisClient = null;
let sessionStore;
if (REDIS_URL) {
    sessionRedisClient = createClient({
        url: REDIS_URL,
        socket: {
            connectTimeout: 10000,
            reconnectStrategy: (retries) => {
                if (retries > 10) return false;
                return Math.min(retries * 500, 5000);
            }
        }
    });
    let firstSessionErrLogged = false;
    sessionRedisClient.on('error', (err) => {
        if (!firstSessionErrLogged) {
            console.error('Session Redis error:', err.message);
            firstSessionErrLogged = true;
        }
    });
    sessionRedisClient.connect()
        .then(() => console.log('✅ Connected to Redis (session store)'))
        .catch((err) => {
            console.error('❌ Session Redis connect failed:', err.message);
            console.warn('⚠️  Sessions will use in-memory store — logins reset on restart.');
        });

    sessionStore = new RedisStore({
        client: sessionRedisClient,
        prefix: 'nurse-sess:',
        ttl: 24 * 60 * 60 // seconds
    });
}

app.use(session({
    store: sessionStore, // undefined falls back to MemoryStore
    secret: SESSION_SECRET,
    name: 'nurse.sid',
    resave: false,
    saveUninitialized: false,
    proxy: IS_PROD,
    cookie: {
        secure: IS_PROD,                       // HTTPS-only cookies in production
        httpOnly: true,
        sameSite: IS_PROD ? 'lax' : 'lax',     // 'none' needed only for cross-site cookies
        maxAge: 24 * 60 * 60 * 1000            // 24h
    }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Basic rate limiting — auth endpoints are the most sensitive.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many auth attempts, please try again later.' }
});
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/auth/forgot-password', authLimiter);
app.use('/auth/reset-password', authLimiter);

// General API rate limit (generous; tune to taste)
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', apiLimiter);

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    res.status(401).json({ success: false, message: 'Authentication required' });
}

function requireAdmin(req, res, next) {
    const role = req.session && (req.session.role || (req.session.isAdmin ? 'super-admin' : 'data-entry'));
    if (req.session && req.session.userId && role === 'super-admin') {
        return next();
    }
    res.status(403).json({ success: false, message: 'Admin access required' });
}

// Serve static files, but protect dashboard
app.use((req, res, next) => {
    // Allow access to login page and auth endpoints
    if (req.path === '/login.html' || 
        req.path.startsWith('/auth/') || 
        req.path === '/health' ||
        req.path === '/login.css' ||
        req.path === '/login.js') {
        return next();
    }
    
    // Protect dashboard files
    if (req.path === '/index.html' || 
        req.path === '/index.js' || 
        req.path === '/index.css' || 
        req.path === '/' ||
        req.path === '/dashboard.html') {
        if (!req.session || !req.session.userId) {
            return res.redirect('/login.html');
        }
    }
    
    next();
});

// Note: express.static moved after API routes to prevent conflicts

// ============================
// Avatar API Proxies (voices & models)
// ============================
const { randomUUID } = require('crypto');
const AVATAR_API_BASE = 'https://team-mooncalf.vercel.app';

// ============================
// Azure Batch Avatar Synthesis
// Docs: https://learn.microsoft.com/azure/ai-services/speech-service/batch-synthesis-avatar
// ============================
function azureAvatarEndpoint() {
    const region = process.env.AZURE_SPEECH_REGION;
    const override = process.env.AZURE_AVATAR_ENDPOINT;
    const base = (override || (region ? `https://${region}.api.cognitive.microsoft.com/` : ''))
        .replace(/\/+$/, '') + '/';
    return base;
}

function isAzureAvatarConfigured() {
    return !!(process.env.AZURE_SPEECH_KEY && (process.env.AZURE_SPEECH_REGION || process.env.AZURE_AVATAR_ENDPOINT));
}

function isMooncalfConfigured() {
    // Always "configured" — the upstream is public. Secret key is optional.
    return true;
}

function resolveAvatarProvider() {
    const explicit = (process.env.AVATAR_PROVIDER || 'auto').toLowerCase().trim();
    if (explicit === 'azure' || explicit === 'mooncalf') return explicit;
    return 'auto'; // tries azure first, then mooncalf
}

// Heuristic: does the supplied text look like SSML?
const _SSML_HINT_RE = /<\s*(speak|voice|break|prosody|mstts:|audio)\b/i;
function looksLikeSSML(text) {
    const t = (text || '').trim();
    return !!t && _SSML_HINT_RE.test(t);
}

// If the text is a partial SSML fragment (e.g. "สวัสดี <break time='500ms'/> ต่อไป"),
// wrap it in a complete <speak><voice>...</voice></speak> envelope. Full SSML is
// left untouched.
function wrapSSMLIfNeeded(content, voice) {
    const c = (content || '').trim();
    if (!c) return c;
    if (c.toLowerCase().includes('<speak')) return c;
    const safeVoice = voice || 'th-TH-NiwatNeural';
    const lang = /^th-/.test(safeVoice) ? 'th-TH'
               : /^en-/.test(safeVoice) ? 'en-US'
               : 'en-US';
    return `<speak version="1.0" xml:lang="${lang}"><voice name="${safeVoice}">${c}</voice></speak>`;
}

async function azureSubmitAvatarJob({ text, voice, talkingAvatarCharacter, talkingAvatarStyle, background, videoFormat = 'mp4' }) {
    if (!isAzureAvatarConfigured()) {
        throw new Error('Azure Speech not configured (AZURE_SPEECH_KEY + AZURE_SPEECH_REGION required)');
    }
    const synthesisId = randomUUID();
    const url = `${azureAvatarEndpoint()}avatar/batchsyntheses/${synthesisId}?api-version=2024-08-01`;

    // Auto-detect SSML vs PlainText (parity with Python reference server).
    const isSSML = looksLikeSSML(text);
    const inputKind = isSSML ? 'SSML' : 'PlainText';
    const content = isSSML ? wrapSSMLIfNeeded(text, voice) : text;

    const avatarConfig = {
        talkingAvatarCharacter,
        talkingAvatarStyle,
        customized: false,
        videoFormat,
        videoCodec: 'h264',
        subtitleType: 'soft_embedded',
        useBuiltInVoice: false
    };
    if (background) avatarConfig.backgroundImage = background;
    else            avatarConfig.backgroundColor = '#FFFFFFFF';

    const body = {
        inputKind,
        synthesisConfig: { voice },
        customVoices: {},
        inputs: [{ content }],
        avatarConfig
    };

    const r = await fetch(url, {
        method: 'PUT',
        headers: {
            'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!r.ok) {
        const errText = await r.text().catch(() => '');
        throw new Error(`Azure job creation failed [${r.status}]: ${errText.slice(0, 500)}`);
    }
    return { synthesisId, statusUrl: url, inputKind };
}

async function azurePollAvatarJob({ synthesisId, pollIntervalMs = 3000, timeoutMs = 5 * 60 * 1000, onStatus }) {
    const url = `${azureAvatarEndpoint()}avatar/batchsyntheses/${synthesisId}?api-version=2024-08-01`;
    const start = Date.now();
    let lastStatus = null;

    while (true) {
        await sleep(pollIntervalMs);
        const r = await fetch(url, {
            headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY }
        });
        if (!r.ok) {
            const errText = await r.text().catch(() => '');
            throw new Error(`Azure status check failed [${r.status}]: ${errText.slice(0, 300)}`);
        }
        const data = await r.json();
        if (data.status !== lastStatus) {
            lastStatus = data.status;
            if (onStatus) try { onStatus(data.status, data); } catch {}
        }
        if (data.status === 'Succeeded') return data;
        if (data.status === 'Failed') {
            const errMsg = data.properties?.error?.message
                || JSON.stringify(data.properties?.error || {})
                || 'Azure synthesis failed';
            throw new Error(`Azure avatar synthesis failed: ${errMsg}`);
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Azure avatar synthesis timed out after ${Math.round(timeoutMs / 1000)}s (last status: ${lastStatus || 'unknown'})`);
        }
    }
}

async function azureDeleteAvatarJob(synthesisId) {
    try {
        const url = `${azureAvatarEndpoint()}avatar/batchsyntheses/${synthesisId}?api-version=2024-08-01`;
        await fetch(url, {
            method: 'DELETE',
            headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY }
        });
    } catch (e) { /* best-effort cleanup */ }
}

function sanitizeOutputFilename(name, fallback) {
    if (!name) return fallback;
    return name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || fallback;
}

async function generateAvatarViaAzure(payload, outputFilename) {
    const { text, voice, talkingAvatarCharacter, talkingAvatarStyle, background } = payload;
    if (!text || !voice || !talkingAvatarCharacter || !talkingAvatarStyle) {
        throw new Error('Missing required fields: text, voice, talkingAvatarCharacter, talkingAvatarStyle');
    }

    const t0 = Date.now();
    const { synthesisId, inputKind } = await azureSubmitAvatarJob({
        text, voice, talkingAvatarCharacter, talkingAvatarStyle, background
    });
    console.log(`[avatar] Azure job submitted: ${synthesisId} (${inputKind})`);

    const pollMs = parseInt(process.env.AVATAR_SYNTHESIS_POLL_MS, 10) || 3000;
    const timeoutMs = parseInt(process.env.AVATAR_SYNTHESIS_TIMEOUT_MS, 10) || 5 * 60 * 1000;

    const result = await azurePollAvatarJob({
        synthesisId,
        pollIntervalMs: pollMs,
        timeoutMs,
        onStatus: (status) => console.log(`[avatar] Azure ${synthesisId} → ${status}`)
    });

    const resultUrl = result.outputs?.result;
    if (!resultUrl) throw new Error('Azure reported success but returned no result URL');

    // Match the proven Python/mooncalf pattern: upload with `folder` only and
    // let Cloudinary assign a public_id. This avoids the `folder + public_id`
    // behavior difference between fixed-folder and dynamic-folder accounts.
    // If the caller supplied a preferred filename, rename the asset afterwards
    // (same two-step dance the existing mooncalf fallback uses).
    let upload = await cloudinary.uploader.upload(resultUrl, {
        resource_type: 'video',
        folder: 'avatar_videos',
        type: 'authenticated'
    });

    const safeName = sanitizeOutputFilename(outputFilename, null);
    if (safeName) {
        try {
            const newPublicId = `avatar_videos/${safeName}`;
            if (upload.public_id !== newPublicId) {
                const renamed = await cloudinary.uploader.rename(upload.public_id, newPublicId, {
                    resource_type: 'video',
                    type: 'authenticated',
                    overwrite: true
                });
                upload = { ...upload, ...renamed };
                console.log(`[avatar] Renamed: ${upload.public_id}`);
            }
        } catch (renameErr) {
            console.error('[avatar] Cloudinary rename failed:', renameErr.message);
        }
    }

    // Best-effort cleanup of the Azure job record (the video URL from Azure
    // expires in 48h anyway; we already copied it to Cloudinary).
    azureDeleteAvatarJob(synthesisId);

    return {
        success: true,
        provider: 'azure',
        synthesisId,
        inputKindUsed: inputKind,
        outputFilename: safeName || upload.public_id.split('/').pop(),
        publicId: upload.public_id,
        // The video library endpoint returns signed URLs (type: authenticated);
        // this one is here for convenience / debugging.
        cloudinaryUrl: upload.secure_url,
        video_url: upload.secure_url, // parity with Python response shape
        durationSeconds: upload.duration,
        width: upload.width,
        height: upload.height,
        format: upload.format,
        bytes: upload.bytes,
        elapsedMs: Date.now() - t0
    };
}

async function generateAvatarViaMooncalf(payload, outputFilename) {
    const forwardBody = { ...payload };
    if (process.env.AVATAR_SECRET_KEY) forwardBody.key = process.env.AVATAR_SECRET_KEY;

    const t0 = Date.now();
    const response = await fetch(`${AVATAR_API_BASE}/generate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forwardBody)
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const msg = data?.error || data?.message || `HTTP ${response.status}`;
        throw new Error(`mooncalf: ${msg}`);
    }

    // mooncalf uploads the video into Cloudinary itself; if a preferred
    // outputFilename was given, rename the latest uploaded video to match.
    if (outputFilename) {
        try {
            const searchResult = await cloudinary.search
                .expression('folder:avatar_videos AND resource_type:video')
                .sort_by('created_at', 'desc')
                .max_results(1)
                .execute();

            if (searchResult.resources?.length > 0) {
                const latestVideo = searchResult.resources[0];
                const oldPublicId = latestVideo.public_id;
                const safeName = sanitizeOutputFilename(outputFilename, null);
                if (safeName) {
                    const newPublicId = `avatar_videos/${safeName}`;
                    if (oldPublicId !== newPublicId) {
                        await cloudinary.uploader.rename(oldPublicId, newPublicId, {
                            resource_type: 'video',
                            type: 'authenticated',
                            overwrite: true
                        });
                        if (data) data.renamedTo = safeName;
                    }
                }
            }
        } catch (renameErr) {
            console.error('[avatar] Cloudinary rename failed:', renameErr.message);
            if (data) data.renameError = renameErr.message;
        }
    }

    return { ...(data || {}), provider: 'mooncalf', elapsedMs: Date.now() - t0 };
}

app.get('/api/avatar/voices', async (req, res) => {
    try {
        const response = await fetch(`${AVATAR_API_BASE}/voices`);
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('Failed to proxy voices:', err.message);
        res.status(502).json({ error: 'Failed to fetch voices from upstream' });
    }
});

app.get('/api/avatar/models', async (req, res) => {
    try {
        const response = await fetch(`${AVATAR_API_BASE}/models`);
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('Failed to proxy models:', err.message);
        res.status(502).json({ error: 'Failed to fetch models from upstream' });
    }
});

app.post('/api/avatar/generate', async (req, res) => {
    const outputFilename = req.body?.outputFilename;
    const payload = { ...(req.body || {}) };
    delete payload.outputFilename;

    // Optional per-request override: { provider: 'azure' | 'mooncalf' }
    const requested = (req.body?.provider || '').toLowerCase();
    const perRequest = requested === 'azure' || requested === 'mooncalf' ? requested : null;
    const configured = resolveAvatarProvider(); // 'azure' | 'mooncalf' | 'auto'
    const mode = perRequest || configured;

    // Build the attempt order.
    const order = [];
    if (mode === 'azure') order.push('azure');
    else if (mode === 'mooncalf') order.push('mooncalf');
    else {
        if (isAzureAvatarConfigured()) order.push('azure');
        order.push('mooncalf');
    }

    const attempts = [];
    for (const p of order) {
        try {
            const result = p === 'azure'
                ? await generateAvatarViaAzure(payload, outputFilename)
                : await generateAvatarViaMooncalf(payload, outputFilename);
            return res.json({ ...result, attempts: [...attempts, { provider: p, ok: true }] });
        } catch (err) {
            const msg = err?.message || String(err);
            console.error(`[avatar/generate] ${p} failed: ${msg}`);
            attempts.push({ provider: p, ok: false, error: msg });
            // If the caller pinned a provider, don't fall through.
            if (perRequest || mode !== 'auto') break;
        }
    }

    res.status(502).json({
        success: false,
        error: 'Avatar generation failed',
        attempts
    });
});

// Probe: are the avatar providers reachable and keys valid?
app.get('/api/avatar/test', requireAuth, async (req, res) => {
    const out = {
        success: true,
        provider: resolveAvatarProvider(),
        azure: {
            configured: isAzureAvatarConfigured(),
            region: process.env.AZURE_SPEECH_REGION || null,
            endpoint: azureAvatarEndpoint() || null,
            valid: null,
            statusCode: null,
            error: null
        },
        mooncalf: {
            configured: isMooncalfConfigured(),
            url: AVATAR_API_BASE,
            valid: null,
            statusCode: null,
            error: null
        }
    };

    // Probe Azure: list batch syntheses (cheap, requires valid key)
    if (out.azure.configured) {
        try {
            const url = `${azureAvatarEndpoint()}avatar/batchsyntheses?api-version=2024-08-01&top=1`;
            const r = await fetch(url, {
                headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY }
            });
            out.azure.statusCode = r.status;
            if (r.ok) {
                out.azure.valid = true;
            } else {
                out.azure.valid = false;
                const errText = await r.text().catch(() => '');
                out.azure.error = errText.slice(0, 400);
            }
        } catch (err) {
            out.azure.valid = false;
            out.azure.error = err.message || String(err);
        }
    }

    // Probe mooncalf: GET /voices (public, cheap)
    try {
        const r = await fetch(`${AVATAR_API_BASE}/voices`, { method: 'GET' });
        out.mooncalf.statusCode = r.status;
        out.mooncalf.valid = r.ok;
        if (!r.ok) {
            const errText = await r.text().catch(() => '');
            out.mooncalf.error = errText.slice(0, 400);
        }
    } catch (err) {
        out.mooncalf.valid = false;
        out.mooncalf.error = err.message || String(err);
    }

    res.json(out);
});

// ============================
// Avatar Videos from Cloudinary
// ============================
app.get('/api/avatar/videos', requireAuth, async (req, res) => {
    try {
        // Primary: Admin API — returns newly-uploaded assets instantly (no
        // indexing delay). Falls back to Search API if Admin API errors out.
        const collected = [];
        const seen = new Set();

        const pushResource = (v) => {
            if (!v || !v.public_id || seen.has(v.public_id)) return;
            seen.add(v.public_id);
            collected.push(v);
        };

        // --- Primary: Admin API, paged by prefix ---
        try {
            let next_cursor;
            do {
                const page = await cloudinary.api.resources({
                    resource_type: 'video',
                    type: 'authenticated',
                    prefix: 'avatar_videos/',
                    max_results: 100,
                    next_cursor
                });
                (page.resources || []).forEach(pushResource);
                next_cursor = page.next_cursor;
            } while (next_cursor && collected.length < 500);
        } catch (adminErr) {
            console.warn('[avatar/videos] Admin API failed, falling back to Search:', adminErr.message);
        }

        // --- Fallback / supplement: Search API (covers dynamic-folder accounts
        //     where asset_folder is stored separately from public_id). ---
        try {
            const searchResult = await cloudinary.search
                .expression('(folder:avatar_videos OR asset_folder:avatar_videos) AND resource_type:video')
                .sort_by('created_at', 'desc')
                .max_results(100)
                .execute();
            (searchResult.resources || []).forEach(pushResource);
        } catch (searchErr) {
            console.warn('[avatar/videos] Search API failed:', searchErr.message);
        }

        // Sort newest first
        collected.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const videos = collected.map(v => {
            const signedUrl = cloudinary.url(v.public_id, {
                resource_type: 'video',
                type: 'authenticated',
                sign_url: true,
                secure: true,
                format: v.format || 'mp4'
            });
            const thumbUrl = cloudinary.url(v.public_id, {
                resource_type: 'video',
                type: 'authenticated',
                sign_url: true,
                secure: true,
                format: 'jpg',
                transformation: [
                    { width: 400, crop: 'scale' },
                    { start_offset: '0' }
                ]
            });
            return {
                publicId: v.public_id,
                url: signedUrl,
                thumbUrl,
                filename: v.public_id.split('/').pop(),
                format: v.format,
                size: v.bytes,
                duration: v.duration,
                width: v.width,
                height: v.height,
                created: v.created_at
            };
        });

        res.json({ success: true, videos, total: videos.length });
    } catch (err) {
        console.error('Failed to fetch avatar videos:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete a video from Cloudinary
app.delete('/api/avatar/videos/:publicId(*)', requireAuth, async (req, res) => {
    try {
        const publicId = req.params.publicId;
        const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: 'video',
            type: 'authenticated'
        });
        if (result.result === 'ok' || result.result === 'not found') {
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, error: 'Cloudinary deletion failed: ' + result.result });
        }
    } catch (err) {
        console.error('Failed to delete video:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================
// Assessment CRUD
// ============================
app.get('/api/assessments', requireAuth, async (req, res) => {
    try {
        const data = await redisGetJson('assessments') || { assessments: [] };
        res.json({ success: true, assessments: data.assessments });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/assessments', requireAuth, async (req, res) => {
    try {
        const { name, description, videos, deadline, videoPublicId, videoUrl, videoThumbUrl, videoFilename } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Name is required' });
        }
        const data = await redisGetJson('assessments') || { assessments: [] };
        const assessment = {
            id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
            name: name.trim(),
            description: (description || '').trim(),
            videos: Array.isArray(videos) ? videos : [],
            deadline: deadline || null,
            fullMarks: req.body.fullMarks || null,
            videoPublicId: videoPublicId || null,
            videoUrl: videoUrl || null,
            videoThumbUrl: videoThumbUrl || null,
            videoFilename: videoFilename || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        data.assessments.push(assessment);
        await redisSetJson('assessments', data);
        res.json({ success: true, assessment });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/assessments/:id', requireAuth, async (req, res) => {
    try {
        const data = await redisGetJson('assessments') || { assessments: [] };
        const idx = data.assessments.findIndex(a => a.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, error: 'Assessment not found' });
        const { name, description, videos, deadline, videoPublicId, videoUrl, videoThumbUrl, videoFilename } = req.body;
        if (name !== undefined) data.assessments[idx].name = name.trim();
        if (description !== undefined) data.assessments[idx].description = (description || '').trim();
        if (videos !== undefined) data.assessments[idx].videos = Array.isArray(videos) ? videos : [];
        if (deadline !== undefined) data.assessments[idx].deadline = deadline || null;
        if (req.body.fullMarks !== undefined) data.assessments[idx].fullMarks = req.body.fullMarks || null;
        if (videoPublicId !== undefined) data.assessments[idx].videoPublicId = videoPublicId;
        if (videoUrl !== undefined) data.assessments[idx].videoUrl = videoUrl;
        if (videoThumbUrl !== undefined) data.assessments[idx].videoThumbUrl = videoThumbUrl;
        if (videoFilename !== undefined) data.assessments[idx].videoFilename = videoFilename;
        data.assessments[idx].updatedAt = new Date().toISOString();
        await redisSetJson('assessments', data);
        res.json({ success: true, assessment: data.assessments[idx] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/assessments/:id', requireAuth, async (req, res) => {
    try {
        const data = await redisGetJson('assessments') || { assessments: [] };
        const idx = data.assessments.findIndex(a => a.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, error: 'Assessment not found' });
        data.assessments.splice(idx, 1);
        await redisSetJson('assessments', data);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================
// Assessment Messages (Voice + Text)
// ============================
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Helper: get Redis key for assessment messages
function assessmentMessagesKey(assessmentId, username) {
    return `assessment_messages:${assessmentId}:${username}`;
}

// Upload voice recording (with optional transcript)
app.post('/api/assessment-recordings/upload', requireAuth, memoryUpload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No audio file uploaded' });
        const { assessmentId, assessmentName, transcript } = req.body;
        if (!assessmentId) return res.status(400).json({ success: false, error: 'Assessment ID is required' });

        const userEmail = req.session.email || 'unknown';
        const username = userEmail.split('@')[0];

        // Upload to Cloudinary: assessment_recordings/{assessmentId}/{username}/
        const b64 = req.file.buffer.toString('base64');
        const dataUri = `data:${req.file.mimetype};base64,${b64}`;
        const timestamp = Date.now();

        const result = await cloudinary.uploader.upload(dataUri, {
            resource_type: 'video',  // Cloudinary treats audio as video
            folder: `assessment_recordings/${assessmentId}/${username}`,
            public_id: `recording_${timestamp}`,
            format: req.file.originalname.endsWith('.mp4') ? 'mp4' : 'webm'
        });

        // Store message metadata in Redis (voice type with optional transcript)
        const message = {
            type: 'voice',
            timestamp,
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format || 'webm',
            transcript: (transcript || '').trim() || null,
            created: new Date(timestamp).toISOString()
        };

        const redisKey = assessmentMessagesKey(assessmentId, username);
        const existing = (await redisGetJson(redisKey)) || [];
        existing.push(message);
        await redisSetJson(redisKey, existing);

        res.json({
            success: true,
            url: result.secure_url,
            publicId: result.public_id,
            assessmentId,
            username,
            transcript: message.transcript
        });
    } catch (err) {
        console.error('Failed to upload recording:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Send text message (also used for video_progress markers)
app.post('/api/assessment-messages/text', requireAuth, async (req, res) => {
    try {
        const { assessmentId, text, type } = req.body;
        if (!assessmentId) return res.status(400).json({ success: false, error: 'Assessment ID is required' });

        const userEmail = req.session.email || 'unknown';
        const username = userEmail.split('@')[0];
        const timestamp = Date.now();

        // Handle video_shown marker (records when a video was displayed in chat)
        if (type === 'video_shown') {
            const videoIndex = parseInt(text, 10) || 0;
            const redisKey = assessmentMessagesKey(assessmentId, username);
            const existing = (await redisGetJson(redisKey)) || [];
            // Only add if not already recorded for this videoIndex
            const already = existing.find(m => m.type === 'video_shown' && m.videoIndex === videoIndex);
            if (!already) {
                existing.push({ type: 'video_shown', videoIndex, timestamp, created: new Date(timestamp).toISOString() });
                await redisSetJson(redisKey, existing);
            }
            return res.json({ success: true });
        }

        // Handle video_progress marker
        if (type === 'video_progress') {
            const videoCount = parseInt(text.replace('__video_progress__', ''), 10) || 0;
            const redisKey = assessmentMessagesKey(assessmentId, username);
            const existing = (await redisGetJson(redisKey)) || [];
            // Update existing progress marker or add new one
            const idx = existing.findIndex(m => m.type === 'video_progress');
            const marker = { type: 'video_progress', timestamp, videoCount, created: new Date(timestamp).toISOString() };
            if (idx >= 0) {
                existing[idx] = marker;
            } else {
                existing.push(marker);
            }
            await redisSetJson(redisKey, existing);
            return res.json({ success: true, message: marker });
        }

        if (!text || !text.trim()) return res.status(400).json({ success: false, error: 'Text is required' });

        const message = {
            type: 'text',
            timestamp,
            text: text.trim(),
            created: new Date(timestamp).toISOString()
        };

        const redisKey = assessmentMessagesKey(assessmentId, username);
        const existing = (await redisGetJson(redisKey)) || [];
        existing.push(message);
        await redisSetJson(redisKey, existing);

        res.json({ success: true, message });
    } catch (err) {
        console.error('Failed to save text message:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Check which assessments have been answered by the current user
// NOTE: must be before /:assessmentId to avoid matching "status" as a param
app.get('/api/assessment-recordings/status/all', requireAuth, async (req, res) => {
    try {
        const userEmail = req.session.email || 'unknown';
        const username = userEmail.split('@')[0];

        // Search all recordings by this user across all assessments
        const result = await cloudinary.search
            .expression(`folder:assessment_recordings/* AND resource_type:video`)
            .sort_by('created_at', 'desc')
            .max_results(500)
            .execute();

        // Build a map: assessmentId -> count of recordings by this user
        const answered = {};
        (result.resources || []).forEach(r => {
            // public_id format: assessment_recordings/{assessmentId}/{username}/recording_xxx
            const parts = r.public_id.split('/');
            if (parts.length >= 3 && parts[2] === username) {
                const assessmentId = parts[1];
                answered[assessmentId] = (answered[assessmentId] || 0) + 1;
            }
        });

        // Also count text messages from Redis and collect video progress
        const videoProgress = {};
        const totalVideos = {};
        try {
            const assessmentsData = (await redisGetJson('assessments')) || { assessments: [] };
            for (const a of assessmentsData.assessments) {
                // Total video count for this assessment
                const vCount = (a.videos && a.videos.length) || (a.videoPublicId ? 1 : 0);
                totalVideos[a.id] = vCount;

                const redisKey = assessmentMessagesKey(a.id, username);
                const messages = (await redisGetJson(redisKey)) || [];
                const textCount = messages.filter(m => m.type === 'text').length;
                if (textCount > 0) {
                    answered[a.id] = (answered[a.id] || 0) + textCount;
                }
                // Video progress marker
                const progressMsg = messages.find(m => m.type === 'video_progress');
                if (progressMsg) {
                    videoProgress[a.id] = progressMsg.videoCount || 0;
                }
            }
        } catch (_) { /* non-critical */ }

        res.json({ success: true, answered, videoProgress, totalVideos });
    } catch (err) {
        console.error('Failed to fetch recording status:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get all messages (voice + text) for an assessment
app.get('/api/assessment-recordings/:assessmentId', requireAuth, async (req, res) => {
    try {
        const userEmail = req.session.email || 'unknown';
        const username = userEmail.split('@')[0];
        const assessmentId = req.params.assessmentId;

        // Load from Redis (includes transcripts and text messages)
        const redisKey = assessmentMessagesKey(assessmentId, username);
        let messages = (await redisGetJson(redisKey)) || [];

        // If Redis is empty, fall back to Cloudinary search for legacy voice recordings
        if (messages.length === 0) {
            const folder = `assessment_recordings/${assessmentId}/${username}`;
            try {
                const result = await cloudinary.search
                    .expression(`folder:${folder} AND resource_type:video`)
                    .sort_by('created_at', 'asc')
                    .max_results(50)
                    .execute();

                messages = (result.resources || []).map(r => ({
                    type: 'voice',
                    timestamp: new Date(r.created_at).getTime(),
                    url: r.secure_url,
                    publicId: r.public_id,
                    format: r.format,
                    transcript: null,
                    created: r.created_at
                }));

                // Migrate to Redis for future loads
                if (messages.length > 0) {
                    await redisSetJson(redisKey, messages);
                }
            } catch (_) { /* Cloudinary search failure is non-critical */ }
        }

        // Sort by timestamp
        messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        res.json({ success: true, messages });
    } catch (err) {
        console.error('Failed to fetch messages:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin: Get all students' responses for an assessment
app.get('/api/assessment-recordings/:assessmentId/all-responses', requireAuth, async (req, res) => {
    try {
        const assessmentId = req.params.assessmentId;
        const role = req.session.role || (req.session.isAdmin ? 'super-admin' : 'data-entry');
        const isAdmin = role === 'super-admin';
        const currentUsername = (req.session.email || '').split('@')[0];

        // Get assessment info for fullMarks and totalVideos
        const assessmentsData = (await redisGetJson('assessments')) || { assessments: [] };
        const assessment = assessmentsData.assessments.find(a => a.id === assessmentId);
        const fullMarks = assessment ? (assessment.fullMarks || null) : null;
        const totalVideos = assessment ? ((assessment.videos && assessment.videos.length) || (assessment.videoPublicId ? 1 : 0)) : 0;
        const assessmentVideos = assessment ? (assessment.videos || []) : [];

        // Get marks data
        const marksData = (await redisGetJson(`assessment_marks:${assessmentId}`)) || {};

        // Get all users
        const usersData = (await redisGetJson('users')) || { users: [] };
        const students = [];

        for (const user of usersData.users) {
            const username = (user.email || '').split('@')[0];
            if (!username) continue;

            // Skip admin users — only show students
            if (user.role === 'super-admin' || user.isAdmin) continue;

            const redisKey = assessmentMessagesKey(assessmentId, username);
            const messages = (await redisGetJson(redisKey)) || [];

            // Only include students who have actual responses (text or voice)
            const responseMessages = messages.filter(m => m.type === 'text' || m.type === 'voice');
            if (responseMessages.length === 0) continue;

            // Get video progress
            const progressMsg = messages.find(m => m.type === 'video_progress');
            const videoProgress = progressMsg ? progressMsg.videoCount : 0;

            students.push({
                username,
                email: user.email,
                name: user.name || username,
                messages: messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
                responseCount: responseMessages.length,
                textCount: responseMessages.filter(m => m.type === 'text').length,
                voiceCount: responseMessages.filter(m => m.type === 'voice').length,
                videoProgress,
                marks: marksData[username] !== undefined ? marksData[username] : null,
                lastActivity: responseMessages.length > 0 ? Math.max(...responseMessages.map(m => m.timestamp || 0)) : 0
            });
        }

        // Sort by last activity (most recent first)
        students.sort((a, b) => b.lastActivity - a.lastActivity);

        // For non-admin students, only return their own row
        const filtered = isAdmin ? students : students.filter(s => s.username === currentUsername);

        res.json({ success: true, students: filtered, total: filtered.length, fullMarks, totalVideos, assessmentVideos });
    } catch (err) {
        console.error('Failed to fetch all responses:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin: Save marks for a student on an assessment
app.post('/api/assessment-marks/:assessmentId', requireAdmin, async (req, res) => {
    try {
        const assessmentId = req.params.assessmentId;
        const { username, marks } = req.body;
        if (!username) return res.status(400).json({ success: false, error: 'Username required' });

        const redisKey = `assessment_marks:${assessmentId}`;
        const marksData = (await redisGetJson(redisKey)) || {};
        marksData[username] = marks !== null && marks !== undefined && marks !== '' ? Number(marks) : null;
        await redisSetJson(redisKey, marksData);

        res.json({ success: true });
    } catch (err) {
        console.error('Failed to save marks:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// Competency Board API (per-student)
// ==========================================

// Get all students (for dropdown)
app.get('/api/students', requireAdmin, async (req, res) => {
    try {
        const usersData = (await redisGetJson('users')) || { users: [] };
        const students = usersData.users.map(u => ({
            username: (u.email || '').split('@')[0],
            email: u.email,
            name: u.name || (u.email || '').split('@')[0],
            isAdmin: u.role === 'super-admin' || u.isAdmin
        })).filter(s => s.username && !s.isAdmin);
        res.json({ success: true, students });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get competency data for a student (admin or self)
app.get('/api/competency/:username', requireAuth, async (req, res) => {
    try {
        const { username } = req.params;
        // Students can only view their own competency
        const role = req.session.role || (req.session.isAdmin ? 'super-admin' : 'data-entry');
        const userEmail = req.session.email || '';
        const selfUsername = userEmail.split('@')[0];
        if (role !== 'super-admin' && username !== selfUsername) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const data = await redisGetJson(`competency:${username}`);
        res.json({ success: true, data: data || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Save competency data for a student
app.post('/api/competency/:username', requireAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        const { personnelType, level, standardLevel, competencies } = req.body;
        if (!competencies || !Array.isArray(competencies)) {
            return res.status(400).json({ success: false, error: 'competencies array required' });
        }
        const data = {
            personnelType: personnelType || 'Level 1',
            level: level || '0-1 year',
            standardLevel: standardLevel || 'Standard level',
            competencies,
            updatedAt: Date.now()
        };
        await redisSetJson(`competency:${username}`, data);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to save competency:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete all messages for an assessment (retest)
app.delete('/api/assessment-recordings/:assessmentId', requireAuth, async (req, res) => {
    try {
        const userEmail = req.session.email || 'unknown';
        const username = userEmail.split('@')[0];
        const assessmentId = req.params.assessmentId;

        // Load existing messages to find voice recordings to delete from Cloudinary
        const redisKey = assessmentMessagesKey(assessmentId, username);
        const messages = (await redisGetJson(redisKey)) || [];

        // Delete voice recordings from Cloudinary
        const voiceMessages = messages.filter(m => m.type === 'voice' && m.publicId);
        for (const vm of voiceMessages) {
            try {
                await cloudinary.uploader.destroy(vm.publicId, { resource_type: 'video' });
            } catch (_) { /* non-critical */ }
        }

        // Clear Redis messages
        await redisSetJson(redisKey, []);

        res.json({ success: true, deleted: messages.length });
    } catch (err) {
        console.error('Failed to clear assessment messages:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================\n// Redis (Upstash) Setup\n// ============================
let redis;
let redisReady = false;

async function initRedis() {
    if (!REDIS_URL) {
        console.warn('⚠️  REDIS_URL not set. JSON data endpoints will not work until Redis is configured.');
        return;
    }
    try {
        redis = createClient({
            url: REDIS_URL,
            socket: {
                connectTimeout: 10000,
                reconnectStrategy: (retries) => {
                    if (retries > 5) {
                        console.error('❌ Redis max reconnect attempts reached. Giving up.');
                        return false; // stop reconnecting
                    }
                    return Math.min(retries * 500, 3000); // backoff: 500ms, 1s, 1.5s, 2s, 2.5s, 3s
                }
            }
        });
        redis.on('error', (err) => {
            if (!redisReady) return; // suppress repeated errors during failed init
            console.error('Redis error:', err.message);
        });
        await redis.connect();
        redisReady = true;
        console.log('✅ Connected to Redis');
    } catch (err) {
        console.error('❌ Failed to connect to Redis:', err.message);
        console.warn('⚠️  Server will continue without Redis. Data endpoints will be unavailable.');
        redisReady = false;
    }
}

async function redisGetJson(key) {
    if (!redisReady) throw new Error('Redis not connected');
    const str = await redis.get(key);
    if (!str) return null;
    try { return JSON.parse(str); } catch (e) { return null; }
}

async function redisSetJson(key, value) {
    if (!redisReady) throw new Error('Redis not connected');
    return await redis.set(key, JSON.stringify(value));
}

// ============================
// Authentication System
// ============================

// Login endpoint
app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password are required' 
            });
        }

        // Get users from Redis
        const usersData = await redisGetJson('users') || { users: [] };
        const user = usersData.users.find(u => u.email === email);

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        // Compare password
        const isValid = await bcrypt.compare(password, user.password);
        
        if (!isValid) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        // Set session
        req.session.userId = user.id;
        req.session.email = user.email;
        req.session.name = user.name;
    // Determine role and admin flag
    const role = user.role || (user.isAdmin ? 'super-admin' : 'data-entry');
    req.session.role = role;
    req.session.isAdmin = role === 'super-admin';

        res.json({ 
            success: true, 
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                isAdmin: role === 'super-admin',
                role: role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Logout endpoint
app.post('/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                message: 'Logout failed' 
            });
        }
        res.clearCookie('connect.sid');
        res.json({ 
            success: true, 
            message: 'Logout successful' 
        });
    });
});

// Check auth status
app.get('/auth/status', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({ 
            success: true,
            authenticated: true,
            user: {
                id: req.session.userId,
                email: req.session.email,
                name: req.session.name,
                isAdmin: req.session.isAdmin || false,
                role: req.session.role || (req.session.isAdmin ? 'super-admin' : 'data-entry')
            }
        });
    } else {
        res.json({ 
            success: true,
            authenticated: false 
        });
    }
});

// Admin: Create student directly (name, email, studentId, password, role)
app.post('/admin/students', requireAdmin, async (req, res) => {
    try {
        const { name, email, studentId, password, role } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, email and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }
        const usersData = await redisGetJson('users') || { users: [] };
        if (usersData.users.some(u => u.email === email)) {
            return res.status(400).json({ success: false, message: 'A user with this email already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const resolvedRole = role === 'super-admin' ? 'super-admin' : 'data-entry';
        const newUser = {
            id: usersData.users.length > 0 ? Math.max(...usersData.users.map(u => u.id)) + 1 : 1,
            email,
            name,
            studentId: studentId || '',
            password: hashedPassword,
            isAdmin: resolvedRole === 'super-admin',
            role: resolvedRole,
            createdAt: new Date().toISOString()
        };
        usersData.users.push(newUser);
        await redisSetJson('users', usersData);
        res.json({ success: true, message: 'Student created', user: { id: newUser.id, email: newUser.email, name: newUser.name, studentId: newUser.studentId, isAdmin: newUser.isAdmin, role: newUser.role, createdAt: newUser.createdAt } });
    } catch (error) {
        console.error('Create student error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Get all users
app.get('/admin/users', requireAdmin, async (req, res) => {
    try {
        const usersData = await redisGetJson('users') || { users: [] };
        const safeUsers = usersData.users.map(u => ({
            id: u.id,
            email: u.email,
            name: u.name,
            studentId: u.studentId || '',
            isAdmin: (u.role ? u.role === 'super-admin' : (u.isAdmin || false)),
            role: u.role || (u.isAdmin ? 'super-admin' : 'data-entry'),
            createdAt: u.createdAt
        }));
        res.json({ 
            success: true, 
            users: safeUsers 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Admin: Create user from profile
app.post('/admin/create-user', requireAdmin, async (req, res) => {
    try {
    const { profileId, profileEmail, password, role } = req.body;
        console.log('Create user request body:', req.body);
        
        if (!profileId || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Profile ID and password are required' 
            });
        }

        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 6 characters' 
            });
        }

        // Get profile (always fresh from Redis)
        const profilesData = await redisGetJson('profiles') || { profiles: [] };
        console.log('Profiles array from Redis:', profilesData.profiles);
        // Try matching profileId as string, number, and with ==
        let profile = profilesData.profiles.find(p => p.id == profileId);
        if (!profile) {
            profile = profilesData.profiles.find(p => String(p.id) === String(profileId));
        }
        if (!profile) {
            profile = profilesData.profiles.find(p => Number(p.id) === Number(profileId));
        }
        if (!profile && profileEmail) {
            profile = profilesData.profiles.find(p => (p.mail || p.email || '').toLowerCase() === String(profileEmail).toLowerCase());
        }
        if (!profile) {
            console.error('Profile not found! Tried matching profileId:', profileId, 'and email:', profileEmail, 'in profiles:', profilesData.profiles);
            return res.status(404).json({ success: false, message: 'Profile not found' });
        }

        if (!profile) {
            return res.status(404).json({ 
                success: false, 
                message: 'Profile not found' 
            });
        }

        if (!profile.mail && !profile.email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Profile has no email address' 
            });
        }

        const email = profile.mail || profile.email;

        // Get or create users collection
        const usersData = await redisGetJson('users') || { users: [] };
        
        // Check if user already exists
        if (usersData.users.some(u => u.email === email)) {
            return res.status(400).json({ 
                success: false, 
                message: 'User with this email already exists' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const resolvedRole = role === 'super-admin' ? 'super-admin' : 'data-entry';
        const newUser = {
            id: usersData.users.length > 0 ? Math.max(...usersData.users.map(u => u.id)) + 1 : 1,
            email: email,
            name: profile.name,
            password: hashedPassword,
            isAdmin: resolvedRole === 'super-admin',
            role: resolvedRole,
            profileId: profile.id,
            createdAt: new Date().toISOString()
        };

        usersData.users.push(newUser);
        await redisSetJson('users', usersData);

        res.json({ 
            success: true, 
            message: 'User created successfully',
            user: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name,
                isAdmin: newUser.isAdmin,
                role: newUser.role
            }
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Admin: Update user (change password, toggle admin, update name/studentId)
app.put('/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { password, isAdmin, role, name, studentId } = req.body;

        const usersData = await redisGetJson('users') || { users: [] };
        const userIndex = usersData.users.findIndex(u => u.id === userId);

        if (userIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Update password if provided
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Password must be at least 6 characters' 
                });
            }
            usersData.users[userIndex].password = await bcrypt.hash(password, 10);
        }

        // Update name if provided
        if (name) usersData.users[userIndex].name = name;
        // Update studentId if provided
        if (typeof studentId === 'string') usersData.users[userIndex].studentId = studentId;

        // Update role/admin if provided
        if (typeof role === 'string') {
            const normalized = role === 'super-admin' ? 'super-admin' : 'data-entry';
            usersData.users[userIndex].role = normalized;
            usersData.users[userIndex].isAdmin = normalized === 'super-admin';
        } else if (typeof isAdmin === 'boolean') {
            usersData.users[userIndex].isAdmin = isAdmin;
            usersData.users[userIndex].role = isAdmin ? 'super-admin' : 'data-entry';
        }

        await redisSetJson('users', usersData);

        res.json({ 
            success: true, 
            message: 'User updated successfully',
            user: {
                id: usersData.users[userIndex].id,
                email: usersData.users[userIndex].email,
                name: usersData.users[userIndex].name,
                isAdmin: usersData.users[userIndex].isAdmin,
                role: usersData.users[userIndex].role || (usersData.users[userIndex].isAdmin ? 'super-admin' : 'data-entry')
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Admin: Delete user
app.delete('/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        // Prevent deleting yourself
        if (userId === req.session.userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete your own account' 
            });
        }

        const usersData = await redisGetJson('users') || { users: [] };
        const filteredUsers = usersData.users.filter(u => u.id !== userId);

        if (filteredUsers.length === usersData.users.length) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        await redisSetJson('users', { users: filteredUsers });

        res.json({ 
            success: true, 
            message: 'User deleted successfully' 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Check if setup is needed (public endpoint)
app.get('/auth/needs-setup', async (req, res) => {
    try {
        const usersData = await redisGetJson('users') || { users: [] };
        res.json({ 
            needsSetup: usersData.users.length === 0,
            userCount: usersData.users.length
        });
    } catch (error) {
        console.error('Setup check error:', error);
        res.status(500).json({ error: 'Failed to check setup status' });
    }
});

// Admin: Initialize first admin (run once)
app.post('/admin/init', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Check if any users exist
        const usersData = await redisGetJson('users') || { users: [] };
        
        if (usersData.users.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Admin already initialized. Users exist.' 
            });
        }

        if (!email || !password || !name) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email, password, and name are required' 
            });
        }

        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 6 characters' 
            });
        }

        // Create first admin user
        const hashedPassword = await bcrypt.hash(password, 10);
        const adminUser = {
            id: 1,
            email: email,
            name: name,
            password: hashedPassword,
            isAdmin: true,
            role: 'super-admin',
            createdAt: new Date().toISOString()
        };

        await redisSetJson('users', { users: [adminUser] });

        res.json({ 
            success: true, 
            message: 'Admin user created successfully. You can now log in.' 
        });
    } catch (error) {
        console.error('Error initializing admin:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    let redisStatus = 'disabled';
    try {
        if (redisReady && redis) {
            await redis.ping();
            redisStatus = 'connected';
        } else if (REDIS_URL) {
            redisStatus = 'not-connected';
        }
    } catch (_) {
        redisStatus = 'error';
    }
    res.json({
        success: true,
        message: 'MediHack Dashboard Server is running',
        timestamp: new Date().toISOString(),
        redis: redisStatus
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);

    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File too large. Maximum size is 50MB'
            });
        }
    }

    res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
    });
});

// ============================
// Voice Live - Azure Speech Token
// ============================
app.get('/api/speech-token', requireAuth, async (req, res) => {
    const speechKey = process.env.AZURE_SPEECH_KEY;
    const speechRegion = process.env.AZURE_SPEECH_REGION;
    if (!speechKey || !speechRegion) {
        return res.status(500).json({ success: false, message: 'Azure Speech Service not configured' });
    }
    try {
        const tokenRes = await fetch(`https://${speechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': speechKey,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        if (!tokenRes.ok) throw new Error('Failed to get speech token');
        const token = await tokenRes.text();
        res.json({ success: true, token, region: speechRegion });
    } catch (err) {
        console.error('Speech token error:', err);
        res.status(500).json({ success: false, message: 'Failed to get speech token' });
    }
});

// Voice Live - ICE Token for Avatar WebRTC
app.get('/api/ice-token', requireAuth, async (req, res) => {
    const speechKey = process.env.AZURE_SPEECH_KEY;
    const speechRegion = process.env.AZURE_SPEECH_REGION;
    if (!speechKey || !speechRegion) {
        return res.status(500).json({ success: false, message: 'Azure Speech Service not configured' });
    }
    try {
        const iceRes = await fetch(
            `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`,
            {
                method: 'GET',
                headers: { 'Ocp-Apim-Subscription-Key': speechKey }
            }
        );
        if (!iceRes.ok) throw new Error('Failed to get ICE token: ' + iceRes.status);
        const iceData = await iceRes.json();
        res.json({ success: true, iceServers: iceData });
    } catch (err) {
        console.error('ICE token error:', err);
        res.status(500).json({ success: false, message: 'Failed to get ICE credentials' });
    }
});

// ============================
// AI Provider abstraction (Gemini + OpenAI / ChatGPT)
// ============================
// Provider is chosen by AI_PROVIDER env var ("gemini" | "openai"). Defaults to
// "gemini" when GEMINI_API_KEY is set, otherwise "openai".
// Each call accepts OpenAI-style `messages: [{role, content}]` so the two
// backends are interchangeable.

function resolveAIProvider() {
    const explicit = (process.env.AI_PROVIDER || '').toLowerCase().trim();
    if (explicit === 'openai' || explicit === 'gemini') return explicit;
    if (process.env.OPENAI_API_KEY) return 'openai';
    return 'gemini';
}

// Grading can use a different backend than chat. Defaults to OpenAI when its
// key is set (more reliable JSON), otherwise falls through to chat default.
function resolveGradingProvider() {
    const explicit = (process.env.AI_GRADING_PROVIDER || '').toLowerCase().trim();
    if (explicit === 'openai' || explicit === 'gemini') return explicit;
    if (process.env.OPENAI_API_KEY) return 'openai';
    return resolveAIProvider();
}

function resolveModel(provider) {
    if (provider === 'openai') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
    return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
}

function resolveGradingModel(provider) {
    if (process.env.AI_GRADING_MODEL) return process.env.AI_GRADING_MODEL;
    return resolveModel(provider);
}

async function callGemini({ system, messages, maxTokens, temperature, jsonMode, jsonSchema, model: forcedModel }) {
    const key = process.env.GEMINI_API_KEY;
    const model = forcedModel || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    if (!key) throw new Error('GEMINI_API_KEY not configured');

    const contents = (messages || []).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));

    const body = {
        contents,
        generationConfig: {
            maxOutputTokens: maxTokens,
            temperature
        }
    };
    if (system) body.system_instruction = { parts: [{ text: system }] };
    if (jsonMode || jsonSchema) body.generationConfig.responseMimeType = 'application/json';
    if (jsonSchema) body.generationConfig.responseSchema = jsonSchema;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!r.ok) {
        const errText = await r.text().catch(() => '');
        throw new Error(`Gemini ${r.status}: ${errText.slice(0, 300)}`);
    }
    const data = await r.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callOpenAI({ system, messages, maxTokens, temperature, jsonMode, jsonSchema, model: forcedModel }) {
    const key = process.env.OPENAI_API_KEY;
    const model = forcedModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const baseURL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!key) throw new Error('OPENAI_API_KEY not configured');

    const chatMessages = [];
    if (system) chatMessages.push({ role: 'system', content: system });
    for (const m of messages || []) {
        chatMessages.push({
            role: m.role === 'model' ? 'assistant' : (m.role || 'user'),
            content: m.content
        });
    }

    const body = {
        model,
        messages: chatMessages,
        temperature,
        max_tokens: maxTokens
    };
    if (jsonSchema) {
        body.response_format = {
            type: 'json_schema',
            json_schema: { name: jsonSchema.__name || 'Response', schema: jsonSchema, strict: false }
        };
    } else if (jsonMode) {
        body.response_format = { type: 'json_object' };
    }

    const r = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(body)
    });
    if (!r.ok) {
        const errText = await r.text().catch(() => '');
        throw new Error(`OpenAI ${r.status}: ${errText.slice(0, 300)}`);
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
}

async function aiChatComplete({
    system,
    messages,
    maxTokens = 512,
    temperature = 0.7,
    jsonMode = false,
    jsonSchema,
    provider: forcedProvider,
    model: forcedModel
} = {}) {
    const provider = (forcedProvider || resolveAIProvider()).toLowerCase();
    const opts = { system, messages, maxTokens, temperature, jsonMode, jsonSchema, model: forcedModel };
    if (provider === 'openai') return { provider, text: await callOpenAI(opts) };
    return { provider, text: await callGemini(opts) };
}

// --- small utility helpers used by AI grading ----------------------------

// Robust JSON extractor — tolerates markdown fences and trailing prose.
function extractJSON(text) {
    if (!text) return null;
    let cleaned = String(text).replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
        try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* fallthrough */ }
    }
    return null;
}

// Clamp to [0, max] and round to nearest 0.5; NaN/garbage becomes 0.
function clampScore(n, max) {
    let v = Number(n);
    if (!Number.isFinite(v)) return 0;
    if (max > 0) v = Math.max(0, Math.min(max, v));
    else v = Math.max(0, v);
    return Math.round(v * 2) / 2;
}

// Run an array of async-returning task functions with a concurrency limit.
async function runWithConcurrency(tasks, concurrency = 5) {
    const results = new Array(tasks.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
        while (true) {
            const i = cursor++;
            if (i >= tasks.length) return;
            try { results[i] = { status: 'fulfilled', value: await tasks[i]() }; }
            catch (err) { results[i] = { status: 'rejected', reason: err }; }
        }
    });
    await Promise.all(workers);
    return results;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Probe: which AI providers are available (based on env) and which is default.
// Used by the frontend to show/hide provider options.
app.get('/api/ai-providers', requireAuth, (req, res) => {
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    res.json({
        success: true,
        providers: {
            gemini: {
                available: hasGemini,
                model: process.env.GEMINI_MODEL || 'gemini-2.0-flash'
            },
            openai: {
                available: hasOpenAI,
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
            }
        },
        default: resolveAIProvider()
    });
});

// Voice Live - AI Chat (provider-agnostic, language-aware)
app.post('/api/voice-chat', requireAuth, async (req, res) => {
    const { messages, topic, provider, language } = req.body || {};

    const hasAnyKey = !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
    if (!hasAnyKey) {
        return res.status(500).json({
            success: false,
            message: 'No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY in .env'
        });
    }

    // Validate/normalize inputs
    const requestedProvider = (provider || '').toLowerCase();
    const allowedProviders = new Set(['gemini', 'openai']);
    const chosenProvider = allowedProviders.has(requestedProvider)
        ? requestedProvider
        : resolveAIProvider();

    // Guard: don't try a provider whose key is missing
    if (chosenProvider === 'openai' && !process.env.OPENAI_API_KEY) {
        return res.status(400).json({ success: false, message: 'OpenAI is not configured on the server.' });
    }
    if (chosenProvider === 'gemini' && !process.env.GEMINI_API_KEY) {
        return res.status(400).json({ success: false, message: 'Gemini is not configured on the server.' });
    }

    const lang = (language || '').toLowerCase();
    const langLabel = lang === 'en' || lang === 'english' ? 'English'
                    : lang === 'th' || lang === 'thai'    ? 'Thai'
                    : 'Thai'; // default

    try {
        const base = `You are a helpful medical education AI assistant. Keep responses concise (2-3 sentences max) and conversational since this is a voice chat. Provide accurate medical information.`;
        const topicClause = topic ? ` The current discussion topic is: "${topic}". Focus on the topic.` : '';
        const languageClause = ` Always respond in ${langLabel} language.`;
        const systemInstruction = base + topicClause + languageClause;

        const { text: reply, provider: usedProvider } = await aiChatComplete({
            provider: chosenProvider,
            system: systemInstruction,
            messages: messages || [],
            maxTokens: 300,
            temperature: 0.7
        });

        res.json({
            success: true,
            reply: reply || 'Sorry, I could not generate a response.',
            provider: usedProvider,
            language: langLabel.toLowerCase()
        });
    } catch (err) {
        console.error('Voice chat error:', err.message || err);
        res.status(500).json({ success: false, message: 'Failed to get AI response' });
    }
});

// ============================
// AI Grading - Auto-grade student assessment answers using Gemini
// ============================
// JSON schema describing the structured grading output.
// Used by both Gemini (responseSchema) and OpenAI (response_format.json_schema).
const GRADING_JSON_SCHEMA = {
    __name: 'AssessmentGrades',
    type: 'object',
    properties: {
        grades: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    question: { type: 'integer' },
                    score: { type: 'number' },
                    feedback: { type: 'string' }
                },
                required: ['question', 'score', 'feedback']
            }
        }
    },
    required: ['grades']
};

function buildGradingPrompt({ assessmentName, qaPairs, marksPerQuestion, fullMarks }) {
    const qaText = qaPairs.map((qa, i) => {
        const answer = (qa.answers || []).map(s => (s || '').trim()).filter(Boolean).join(' ').trim();
        let block = `Question ${i + 1}: ${qa.question}\nStudent's Answer: ${answer || '[NO ANSWER PROVIDED]'}`;
        if (qa.correctAnswer) block += `\nCorrect Answer (Key Points): ${qa.correctAnswer}`;
        return block;
    }).join('\n\n');

    return `You are an experienced, strict but fair assessment grader for a nursing education course.
The assessment is: "${assessmentName}"
Today's date: ${new Date().toISOString().split('T')[0]}

Each question is worth up to ${marksPerQuestion} marks. The total full marks are ${fullMarks}.
You may assign any score in increments of 0.5 between 0 and ${marksPerQuestion} inclusive.

ANSWERS TO GRADE
================
${qaText}

GRADING RULES (apply strictly in this order)
============================================
1. CORRECTNESS is the highest priority. When a "Correct Answer (Key Points)" is provided it is the primary rubric.
2. If the student's answer is "[NO ANSWER PROVIDED]", empty, or only filler (e.g. "idk", "pass"), assign 0 and say so in feedback.
3. A short answer that captures the key points MUST receive full marks. Do NOT reward length.
4. A long answer containing factual errors loses marks in proportion to the errors, even if the rest is detailed.
5. Off-topic answers receive 0 regardless of length or effort.
6. Answers may be in Thai, English, or a mix — grade the meaning, not the language. Ignore minor grammar/spelling unless it makes the answer unclear or misleading.
7. Medically unsafe or dangerous advice must be penalized heavily and flagged in feedback.
8. If no "Correct Answer" is given, grade on medical accuracy and relevance.

FEEDBACK FORMAT
===============
1–2 short sentences. Be specific about what was right, what was missing, and (if any) what was wrong. Use the same language the student used when possible.

OUTPUT
======
Return ONLY valid JSON — no prose, no markdown fences — matching exactly:
{"grades":[{"question":1,"score":0.5,"feedback":"..."}, ...]}
Include one entry per question in the same order as above. Do NOT include a "totalScore" field — the server computes it.`;
}

async function gradeOneStudent({
    username,
    displayName,
    qaPairs,
    assessmentName,
    marksPerQuestion,
    fullMarks,
    provider,
    model,
    maxAttempts = 3
}) {
    const prompt = buildGradingPrompt({ assessmentName, qaPairs, marksPerQuestion, fullMarks });
    // Scale output budget with question count — roughly ~220 tokens per question + overhead.
    const maxTokens = Math.max(1200, Math.ceil(220 * qaPairs.length + 400));

    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const temperature = attempt === 1 ? 0.1 : 0; // get even more deterministic on retries
            const reminder = attempt > 1
                ? `\n\nREMINDER: Your previous response was not valid JSON. Return ONLY the JSON object described above, nothing else.`
                : '';

            const { text: raw } = await aiChatComplete({
                provider,
                model,
                messages: [{ role: 'user', content: prompt + reminder }],
                maxTokens,
                temperature,
                jsonSchema: GRADING_JSON_SCHEMA,
                jsonMode: true
            });

            const parsed = extractJSON(raw);
            if (!parsed || !Array.isArray(parsed.grades)) {
                lastErr = new Error('Model did not return a grades array');
                // Retry
                await sleep(300 * attempt);
                continue;
            }

            // Validate + clamp each grade, align by index to qaPairs length.
            const grades = qaPairs.map((_, i) => {
                const g = parsed.grades[i] || parsed.grades.find(x => Number(x?.question) === i + 1) || {};
                return {
                    question: i + 1,
                    score: clampScore(g.score, marksPerQuestion),
                    feedback: (typeof g.feedback === 'string' && g.feedback.trim()) ? g.feedback.trim().slice(0, 600) : 'No feedback provided.'
                };
            });

            const totalScore = grades.reduce((s, g) => s + g.score, 0);
            // Round total to nearest 0.5 as a final sanity pass (sum of 0.5s is already fine, but defensive).
            const total = Math.round(totalScore * 2) / 2;

            return {
                username,
                name: displayName,
                totalScore: total,
                grades,
                attempts: attempt,
                providerUsed: provider,
                modelUsed: model
            };
        } catch (err) {
            lastErr = err;
            const transient = /5\d\d|ECONN|ETIMEDOUT|timeout/i.test(err.message || '');
            await sleep(transient ? 500 * attempt : 200 * attempt);
        }
    }

    return {
        username,
        name: displayName,
        totalScore: null,
        error: lastErr ? (lastErr.message || String(lastErr)) : 'Unknown grading error',
        attempts: maxAttempts,
        providerUsed: provider,
        modelUsed: model
    };
}

app.post('/api/ai-grade-assessment/:assessmentId', requireAdmin, async (req, res) => {
    const assessmentId = req.params.assessmentId;
    const t0 = Date.now();

    const hasAnyKey = !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
    if (!hasAnyKey) {
        return res.status(500).json({ success: false, error: 'No AI provider configured (set GEMINI_API_KEY or OPENAI_API_KEY)' });
    }

    try {
        // Optional per-request overrides from the admin UI
        const requestedProvider = (req.body?.provider || '').toLowerCase();
        const requestedModel = (req.body?.model || '').trim();
        let provider = requestedProvider === 'openai' || requestedProvider === 'gemini'
            ? requestedProvider
            : resolveGradingProvider();
        // Guard: don't try a provider whose key is missing
        if (provider === 'openai' && !process.env.OPENAI_API_KEY) provider = 'gemini';
        if (provider === 'gemini' && !process.env.GEMINI_API_KEY) provider = 'openai';
        const model = requestedModel || resolveGradingModel(provider);

        const assessmentsData = (await redisGetJson('assessments')) || { assessments: [] };
        const assessment = assessmentsData.assessments.find(a => a.id === assessmentId);
        if (!assessment) return res.status(404).json({ success: false, error: 'Assessment not found' });

        const assessmentVideos = assessment.videos || [];
        const fullMarks = assessment.fullMarks || null;
        const totalQuestions = Math.max(1, assessmentVideos.filter(v => v.question).length);
        const marksPerQuestion = fullMarks ? (fullMarks / totalQuestions) : 1;

        const usersData = (await redisGetJson('users')) || { users: [] };
        const marksData = (await redisGetJson(`assessment_marks:${assessmentId}`)) || {};

        // First pass: collect grading inputs for each eligible student (still sequential I/O but cheap)
        const gradingInputs = [];
        for (const user of usersData.users) {
            const username = (user.email || '').split('@')[0];
            if (!username) continue;
            if (user.role === 'super-admin' || user.isAdmin) continue;

            const redisKey = assessmentMessagesKey(assessmentId, username);
            const messages = (await redisGetJson(redisKey)) || [];
            const responseMessages = messages.filter(m => m.type === 'text' || m.type === 'voice');
            if (responseMessages.length === 0) continue;

            const sortedMsgs = messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const qaPairs = [];
            let currentQuestion = assessmentVideos[0]?.question || 'Assessment Question';
            let currentCorrectAnswer = assessmentVideos[0]?.correctAnswer || null;
            let currentAnswers = [];

            for (const m of sortedMsgs) {
                if (m.type === 'video_shown') {
                    if (currentAnswers.length > 0) {
                        qaPairs.push({ question: currentQuestion, correctAnswer: currentCorrectAnswer, answers: currentAnswers });
                    }
                    const vi = m.videoIndex !== undefined ? m.videoIndex : 0;
                    const video = assessmentVideos[vi];
                    currentQuestion = video?.question || `Question ${vi + 1}`;
                    currentCorrectAnswer = video?.correctAnswer || null;
                    currentAnswers = [];
                    continue;
                }
                if (m.type === 'text') currentAnswers.push(m.text);
                else if (m.type === 'voice' && m.transcript) currentAnswers.push(m.transcript);
            }
            if (currentAnswers.length > 0) {
                qaPairs.push({ question: currentQuestion, correctAnswer: currentCorrectAnswer, answers: currentAnswers });
            }
            if (qaPairs.length === 0) continue;

            gradingInputs.push({ username, displayName: user.name || username, qaPairs });
        }

        if (gradingInputs.length === 0) {
            return res.json({
                success: true,
                results: [],
                summary: {
                    total: 0, graded: 0, failed: 0,
                    durationMs: Date.now() - t0, provider, model
                }
            });
        }

        // Second pass: grade in parallel with concurrency cap.
        const concurrency = Math.min(8, Math.max(1, parseInt(process.env.AI_GRADING_CONCURRENCY, 10) || 5));
        const tasks = gradingInputs.map(input => () => gradeOneStudent({
            ...input,
            assessmentName: assessment.name,
            marksPerQuestion,
            fullMarks: fullMarks || totalQuestions,
            provider,
            model
        }));

        const settled = await runWithConcurrency(tasks, concurrency);

        const results = [];
        for (const s of settled) {
            if (s.status === 'fulfilled') {
                const r = s.value;
                results.push(r);
                if (r.totalScore !== null && r.totalScore !== undefined) {
                    marksData[r.username] = r.totalScore;
                }
            } else {
                const err = s.reason || new Error('unknown');
                results.push({ totalScore: null, error: err.message || String(err) });
            }
        }

        await redisSetJson(`assessment_marks:${assessmentId}`, marksData);

        const graded = results.filter(r => r.totalScore !== null && r.totalScore !== undefined).length;
        const failed = results.length - graded;

        res.json({
            success: true,
            results,
            summary: {
                total: results.length,
                graded,
                failed,
                durationMs: Date.now() - t0,
                provider,
                model,
                concurrency
            }
        });
    } catch (err) {
        console.error('AI grade error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================
// Static Files (MUST be after API routes)
// ============================
app.use(express.static('.'));

// Start server
async function startServer() {
    await initRedis();

    const server = app.listen(PORT, HOST, () => {
        const shownHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
        const originsMsg = allowAnyOrigin
            ? 'any (*)'
            : (allowedOrigins.length ? allowedOrigins.join(', ') : 'reflect (dev)');
        const aiProvider = resolveAIProvider();
        const aiModel = resolveModel(aiProvider);
        const gradingProvider = resolveGradingProvider();
        const gradingModel = resolveGradingModel(gradingProvider);
        console.log(`
╔══════════════════════════════════════════════╗
║          MediHack Dashboard Server           ║
╠══════════════════════════════════════════════╣
  Env:        ${NODE_ENV}
  Listening:  http://${HOST}:${PORT}
  Dashboard:  http://${shownHost}:${PORT}/index.html
  CORS:       ${originsMsg}
  TrustProxy: ${app.get('trust proxy')}
  Secure cookies: ${IS_PROD ? 'on' : 'off'}
  Sessions:   ${sessionStore ? 'redis' : 'memory (dev only)'}
  AI chat:    ${aiProvider} (${aiModel})
  AI grading: ${gradingProvider} (${gradingModel})
  Avatar:     ${resolveAvatarProvider()}${resolveAvatarProvider() === 'auto' ? (isAzureAvatarConfigured() ? ' (azure → mooncalf)' : ' (mooncalf only)') : ''}
╚══════════════════════════════════════════════╝
        `);
    });

    // Graceful shutdown so PM2/Docker can restart cleanly
    const shutdown = (signal) => {
        console.log(`\n[${signal}] received — shutting down gracefully...`);
        server.close(async () => {
            try {
                if (sessionRedisClient?.isOpen) await sessionRedisClient.quit();
                if (redis?.isOpen) await redis.quit();
            } catch (e) { /* ignore */ }
            console.log('HTTP server closed.');
            process.exit(0);
        });
        // Force-exit after 10s
        setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
