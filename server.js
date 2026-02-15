require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { v2: cloudinary } = require('cloudinary');
const { createClient } = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || 'medihack-dashboard-secret-change-this-in-production';

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(cookieParser());
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
const AVATAR_API_BASE = 'https://team-mooncalf.vercel.app';

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

const GENERATE_AVATAR_API = 'https://team-mooncalf.vercel.app/generate-avatar';

app.post('/api/avatar/generate', async (req, res) => {
    try {
        const outputFilename = req.body.outputFilename;
        // Don't forward outputFilename to the external API (it doesn't use it)
        const forwardBody = { ...req.body };
        delete forwardBody.outputFilename;

        // Inject secret key from environment
        if (process.env.AVATAR_SECRET_KEY) {
            forwardBody.key = process.env.AVATAR_SECRET_KEY;
        }

        const response = await fetch(GENERATE_AVATAR_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(forwardBody),
        });
        const data = await response.json().catch(() => null);

        // If successful and outputFilename provided, rename the video in Cloudinary
        if (response.ok && data && outputFilename) {
            try {
                // Find the most recently uploaded video in avatar_videos
                const searchResult = await cloudinary.search
                    .expression('folder:avatar_videos AND resource_type:video')
                    .sort_by('created_at', 'desc')
                    .max_results(1)
                    .execute();

                if (searchResult.resources && searchResult.resources.length > 0) {
                    const latestVideo = searchResult.resources[0];
                    const oldPublicId = latestVideo.public_id;
                    // Sanitize the filename: remove extension, keep only safe chars
                    const safeName = outputFilename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
                    const newPublicId = `avatar_videos/${safeName}`;

                    if (oldPublicId !== newPublicId) {
                        await cloudinary.uploader.rename(oldPublicId, newPublicId, {
                            resource_type: 'video',
                            type: 'authenticated',
                            overwrite: true
                        });
                        console.log(`✅ Renamed video: ${oldPublicId} → ${newPublicId}`);
                        if (data) data.renamedTo = safeName;
                    }
                }
            } catch (renameErr) {
                console.error('Failed to rename video:', renameErr.message);
                // Don't fail the whole request, just note the rename error
                if (data) data.renameError = renameErr.message;
            }
        }

        res.status(response.status).json(data);
    } catch (err) {
        console.error('Failed to proxy generate-avatar:', err.message);
        res.status(502).json({ error: 'Failed to reach avatar generation server. Make sure it is running at ' + GENERATE_AVATAR_API });
    }
});

// ============================
// Avatar Videos from Cloudinary
// ============================
app.get('/api/avatar/videos', requireAuth, async (req, res) => {
    try {
        // Videos are uploaded as 'authenticated' type, so use Search API
        const result = await cloudinary.search
            .expression('folder:avatar_videos AND resource_type:video')
            .sort_by('created_at', 'desc')
            .max_results(100)
            .execute();

        const videos = (result.resources || []).map(v => {
            // Generate a signed URL for authenticated videos
            const signedUrl = cloudinary.url(v.public_id, {
                resource_type: 'video',
                type: 'authenticated',
                sign_url: true,
                secure: true,
                format: v.format || 'mp4'
            });
            // Generate a signed thumbnail
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
                thumbUrl: thumbUrl,
                filename: v.public_id.split('/').pop(),
                format: v.format,
                size: v.bytes,
                duration: v.duration,
                width: v.width,
                height: v.height,
                created: v.created_at
            };
        });

        res.json({ success: true, videos });
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

// Voice Live - AI Chat (Google Gemini)
app.post('/api/voice-chat', requireAuth, async (req, res) => {
    const { messages, topic } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

    if (!geminiKey) {
        return res.status(500).json({ success: false, message: 'Google Gemini API not configured. Add GEMINI_API_KEY to .env' });
    }

    try {
        const systemInstruction = topic
            ? `You are a helpful medical education AI assistant. The current discussion topic is: "${topic}". Keep responses concise (2-3 sentences max) and conversational since this is a voice chat. Focus on the topic and provide accurate medical information. Always respond in Thai language.`
            : `You are a helpful medical education AI assistant. Keep responses concise (2-3 sentences max) and conversational since this is a voice chat. Always respond in Thai language.`;

        // Convert OpenAI-style messages to Gemini format
        const contents = (messages || []).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
        const aiRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents,
                generationConfig: {
                    maxOutputTokens: 300,
                    temperature: 0.7
                }
            })
        });

        if (!aiRes.ok) {
            const errBody = await aiRes.text();
            console.error('Gemini API error:', errBody);
            throw new Error('Gemini API request failed');
        }

        const data = await aiRes.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';
        res.json({ success: true, reply });
    } catch (err) {
        console.error('Voice chat error:', err);
        res.status(500).json({ success: false, message: 'Failed to get AI response' });
    }
});

// ============================
// AI Grading - Auto-grade student assessment answers using Gemini
// ============================
app.post('/api/ai-grade-assessment/:assessmentId', requireAdmin, async (req, res) => {
    const assessmentId = req.params.assessmentId;
    const geminiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

    if (!geminiKey) {
        return res.status(500).json({ success: false, error: 'Gemini API not configured' });
    }

    try {
        // Get assessment info
        const assessmentsData = (await redisGetJson('assessments')) || { assessments: [] };
        const assessment = assessmentsData.assessments.find(a => a.id === assessmentId);
        if (!assessment) return res.status(404).json({ success: false, error: 'Assessment not found' });

        const assessmentVideos = assessment.videos || [];
        const fullMarks = assessment.fullMarks || null;
        const totalQuestions = assessmentVideos.filter(v => v.question).length || 1;
        const marksPerQuestion = fullMarks ? (fullMarks / totalQuestions) : 1;

        // Get all users
        const usersData = (await redisGetJson('users')) || { users: [] };
        const marksData = (await redisGetJson(`assessment_marks:${assessmentId}`)) || {};
        const results = [];

        for (const user of usersData.users) {
            const username = (user.email || '').split('@')[0];
            if (!username) continue;
            if (user.role === 'super-admin' || user.isAdmin) continue;

            const redisKey = assessmentMessagesKey(assessmentId, username);
            const messages = (await redisGetJson(redisKey)) || [];
            const responseMessages = messages.filter(m => m.type === 'text' || m.type === 'voice');
            if (responseMessages.length === 0) continue;

            // Group answers by question
            const sortedMsgs = messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const qaPairs = [];
            let currentQuestion = null;
            let currentCorrectAnswer = null;
            let currentAnswers = [];

            for (const m of sortedMsgs) {
                if (m.type === 'video_shown') {
                    if (currentQuestion && currentAnswers.length > 0) {
                        qaPairs.push({ question: currentQuestion, correctAnswer: currentCorrectAnswer, answers: currentAnswers });
                    }
                    const vi = m.videoIndex !== undefined ? m.videoIndex : 0;
                    const video = assessmentVideos[vi];
                    currentQuestion = video?.question || `Question ${vi + 1}`;
                    currentCorrectAnswer = video?.correctAnswer || null;
                    currentAnswers = [];
                    continue;
                }
                if (m.type === 'text') {
                    currentAnswers.push(m.text);
                } else if (m.type === 'voice' && m.transcript) {
                    currentAnswers.push(m.transcript);
                }
            }
            // Push last group
            if (currentAnswers.length > 0) {
                if (!currentQuestion) currentQuestion = 'Assessment Question';
                qaPairs.push({ question: currentQuestion, correctAnswer: currentCorrectAnswer, answers: currentAnswers });
            }

            if (qaPairs.length === 0) continue;

            // Build prompt for Gemini
            const qaText = qaPairs.map((qa, i) => {
                let block = `Question ${i + 1}: ${qa.question}\nStudent's Answer: ${qa.answers.join(' ')}`;
                if (qa.correctAnswer) {
                    block += `\nCorrect Answer (Key Points): ${qa.correctAnswer}`;
                }
                return block;
            }).join('\n\n');

            const prompt = `You are a strict assessment grader. Grade the following student answers.
Today's date: ${new Date().toISOString().split('T')[0]}

Assessment: ${assessment.name}
Max marks per question: ${marksPerQuestion}
Total full marks: ${fullMarks || totalQuestions}

${qaText}

For each question, assign a score from 0 to ${marksPerQuestion} (you can use increments of 0.5).

GRADING RULES (follow strictly):
1. CORRECTNESS is the HIGHEST priority. The correct answer / key points provided are the PRIMARY basis for grading.
2. A short but completely correct answer MUST receive full marks. Do NOT reward length.
3. A long answer with unnecessary details but partially incorrect content MUST lose marks. Penalize factual errors — even if the explanation is detailed, incorrect information must reduce the score.
4. Clear, precise, and correct answers are preferred. Extra explanation is NOT required unless necessary for correctness.
5. Ignore writing style unless it affects clarity. Minor grammar mistakes should NOT reduce marks — only reduce if the answer becomes unclear or misleading.
6. If no correct answer is provided, grade based on general accuracy and relevance.

FEEDBACK FORMAT: Give a brief reason (1-2 sentences maximum).

IMPORTANT: Respond ONLY with valid JSON in this exact format, no extra text:
{"grades": [{"question": 1, "score": 0.5, "feedback": "brief reason"}, ...], "totalScore": 1.5}`;

            try {
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
                const aiRes = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        generationConfig: { maxOutputTokens: 1000, temperature: 0.3 }
                    })
                });

                if (!aiRes.ok) throw new Error('Gemini API failed');

                const aiData = await aiRes.json();
                let reply = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

                // Parse JSON from reply (handle markdown code blocks)
                reply = reply.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                const gradeResult = JSON.parse(reply);

                const totalScore = gradeResult.totalScore ?? gradeResult.grades.reduce((s, g) => s + g.score, 0);

                // Save marks
                marksData[username] = totalScore;

                results.push({
                    username,
                    name: user.name || username,
                    totalScore,
                    grades: gradeResult.grades
                });
            } catch (aiErr) {
                console.error(`AI grading failed for ${username}:`, aiErr.message);
                results.push({ username, name: user.name || username, totalScore: null, error: aiErr.message });
            }
        }

        // Save all marks to Redis
        await redisSetJson(`assessment_marks:${assessmentId}`, marksData);

        res.json({ success: true, results });
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

    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════════╗
║          MediHack Dashboard Server           ║
║                                              ║
║  Server running at: http://localhost:${PORT}   ║
║  Dashboard URL: http://localhost:${PORT}/index.html ║
║                                              ║
║  API Endpoints:                              ║
║  • GET  /api/avatar/voices                   ║
║  • GET  /api/avatar/models                   ║
║  • POST /api/avatar/generate                 ║
║  • GET  /api/avatar/videos                   ║
║  • CRUD /api/assessments                     ║
║  • POST /api/assessment-recordings/upload    ║
║  • GET  /api/assessment-recordings/status/all║
║                                              ║
║  Press Ctrl+C to stop the server            ║
╚══════════════════════════════════════════════╝
        `);
    });
}

startServer().catch(console.error);
