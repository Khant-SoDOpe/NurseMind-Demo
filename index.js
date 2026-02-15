// ==========================================
// Avatar Generator Dashboard
// ==========================================

const VOICES_API = '/api/avatar/voices';
const MODELS_API = '/api/avatar/models';
const GENERATE_API = '/api/avatar/generate';

// Sample background photos for the library
const PHOTO_LIBRARY = [
    { url: 'https://images.pexels.com/photos/458917/pexels-photo-458917.jpeg?cs=srgb&dl=pexels-flodahm-458917.jpg&fm=jpg', label: 'Nature' },
    { url: 'https://images.pexels.com/photos/1103970/pexels-photo-1103970.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750', label: 'City' },
    { url: 'https://images.pexels.com/photos/1287145/pexels-photo-1287145.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750', label: 'Mountains' },
    { url: 'https://images.pexels.com/photos/1229042/pexels-photo-1229042.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750', label: 'Ocean' },
    { url: 'https://images.pexels.com/photos/255379/pexels-photo-255379.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750', label: 'Space' },
    { url: 'https://images.pexels.com/photos/1509534/pexels-photo-1509534.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750', label: 'Abstract' },
    { url: 'https://images.pexels.com/photos/35600/road-sun-rays-path.jpg?auto=compress&cs=tinysrgb&w=1260&h=750', label: 'Forest Path' },
    { url: 'https://images.pexels.com/photos/414171/pexels-photo-414171.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750', label: 'Lake' },
];

let avatarModels = {};   // { harry: ['business','casual',...], ... }
let voiceOptions = {};   // { female: [...], male: [...] }
let selectedBgUrl = '';

// ==========================================
// Role-based access
// ==========================================
window.isAdmin = true; // default until auth check completes

async function checkUserRole() {
    try {
        const res = await fetch('/auth/status', { credentials: 'include' });
        const data = await res.json();
        if (data.success && data.authenticated) {
            window.isAdmin = data.user.isAdmin || data.user.role === 'super-admin';
            window.currentUserEmail = data.user.email;
            window.currentUserName = data.user.name;

            // Reveal admin-only elements if user is admin
            if (window.isAdmin) {
                document.body.classList.add('role-admin');
            }

            // Show user info in top bar
            const userBar = document.getElementById('headerUserBar');
            const userName = document.getElementById('headerUserName');
            if (userBar && userName) {
                userName.textContent = data.user.name || data.user.email;
                userBar.style.display = 'flex';
            }
            // Logout handler
            document.getElementById('headerLogoutBtn')?.addEventListener('click', async () => {
                try {
                    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
                } catch (_) {}
                window.location.href = '/login.html';
            });
        }
    } catch (_) {}
    applyRoleRestrictions();
}

function applyRoleRestrictions() {
    if (window.isAdmin) return; // Admin sees everything via CSS body.role-admin


    // Student Board: hide Action column header for students
    const boardThead = document.querySelector('#boardTableBody')?.closest('table')?.querySelector('thead tr');
    if (boardThead) {
        const ths = boardThead.querySelectorAll('th');
        if (ths.length >= 8) ths[7].style.display = 'none'; // Action column
    }

    // Competency Board: hide Delete column header and save/add buttons for students
    const compThead = document.querySelector('#compTableBody')?.closest('table')?.querySelector('thead tr');
    if (compThead) {
        const ths = compThead.querySelectorAll('th');
        if (ths.length >= 10) ths[9].style.display = 'none'; // Delete column
    }

    document.getElementById('compSaveBtn')?.setAttribute('data-student-hidden', '1');
    document.getElementById('compAddRowBtn')?.setAttribute('data-student-hidden', '1');
    const compEmpty = document.getElementById('compEmpty');
    if (compEmpty) compEmpty.querySelector('button')?.remove(); // remove init template button
}

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadVoices();
    loadModels();
    bindEvents();
    renderPhotoLibrary();
    checkUserRole();
});

// ==========================================
// Fetch voices from API
// ==========================================
async function loadVoices() {
    const voiceSelect = document.getElementById('avatarVoice');
    try {
        const res = await fetch(VOICES_API);
        const data = await res.json();
        voiceOptions = data.voices || {};

        voiceSelect.innerHTML = '<option value="" disabled selected>Select a voice</option>';

        // Group by gender
        for (const [gender, voices] of Object.entries(voiceOptions)) {
            const group = document.createElement('optgroup');
            group.label = gender.charAt(0).toUpperCase() + gender.slice(1);
            voices.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                group.appendChild(opt);
            });
            voiceSelect.appendChild(group);
        }
    } catch (err) {
        console.error('Failed to load voices:', err);
        voiceSelect.innerHTML = '<option value="" disabled selected>Failed to load voices</option>';
    }
}

// ==========================================
// Fetch avatar models from API
// ==========================================
async function loadModels() {
    const charSelect = document.getElementById('avatarCharacter');
    try {
        const res = await fetch(MODELS_API);
        const data = await res.json();
        avatarModels = data.avatars || {};

        charSelect.innerHTML = '<option value="" disabled selected>Select a character</option>';

        for (const name of Object.keys(avatarModels)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
            charSelect.appendChild(opt);
        }

        // Also populate Voice Live avatar selects
        loadAvatarLiveCharacters();
    } catch (err) {
        console.error('Failed to load models:', err);
        charSelect.innerHTML = '<option value="" disabled selected>Failed to load models</option>';
    }
}

// ==========================================
// Update styles when character changes
// ==========================================
function updateStyles(character) {
    const styleSelect = document.getElementById('avatarStyle');
    const styles = avatarModels[character] || [];

    styleSelect.innerHTML = '<option value="" disabled selected>Select a style</option>';
    styles.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        styleSelect.appendChild(opt);
    });
}

// ==========================================
// Render photo library grid
// ==========================================
function renderPhotoLibrary() {
    const grid = document.getElementById('photoLibrary');
    grid.innerHTML = PHOTO_LIBRARY.map((photo, i) => `
        <div class="photo-card" data-url="${photo.url}" onclick="selectPhoto(this, '${photo.url}')">
            <img src="${photo.url}" alt="${photo.label}" loading="lazy">
            <span class="photo-label">${photo.label}</span>
        </div>
    `).join('');
}

// ==========================================
// Select a photo from library
// ==========================================
function selectPhoto(el, url) {
    // Remove previous selection
    document.querySelectorAll('.photo-card.selected').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    selectedBgUrl = url;
    document.getElementById('bgUrl').value = url;
}

// ==========================================
// Bind all events
// ==========================================
function bindEvents() {
    // Character change -> update styles
    document.getElementById('avatarCharacter').addEventListener('change', (e) => {
        updateStyles(e.target.value);
    });

    // Background toggle
    document.getElementById('bgToggle').addEventListener('change', (e) => {
        document.getElementById('bgSection').style.display = e.target.checked ? 'block' : 'none';
        if (!e.target.checked) {
            selectedBgUrl = '';
            document.getElementById('bgUrl').value = '';
            document.querySelectorAll('.photo-card.selected').forEach(c => c.classList.remove('selected'));
        }
    });

    // Manual URL input clears photo selection
    document.getElementById('bgUrl').addEventListener('input', (e) => {
        selectedBgUrl = e.target.value;
        document.querySelectorAll('.photo-card.selected').forEach(c => c.classList.remove('selected'));
        // Highlight matching photo if any
        document.querySelectorAll('.photo-card').forEach(card => {
            if (card.dataset.url === e.target.value) {
                card.classList.add('selected');
            }
        });
    });

    // Form submit
    document.getElementById('avatarForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitForm();
    });
}

// ==========================================
// Build the JSON payload
// ==========================================
function buildPayload() {
    const text = document.getElementById('avatarText').value.trim();
    const voice = document.getElementById('avatarVoice').value;
    const character = document.getElementById('avatarCharacter').value;
    const style = document.getElementById('avatarStyle').value;
    const bgEnabled = document.getElementById('bgToggle').checked;
    const bgUrl = document.getElementById('bgUrl').value.trim();

    const outputFilename = document.getElementById('outputFilename').value.trim();

    if (!text || !voice || !character || !style) {
        showResult('warning', 'Please fill in all required fields.');
        return null;
    }

    const payload = {
        text,
        voice,
        talkingAvatarCharacter: character,
        talkingAvatarStyle: style,
    };

    if (outputFilename) {
        payload.outputFilename = outputFilename;
    }

    if (bgEnabled && bgUrl) {
        payload.background = bgUrl;
    }

    return payload;
}

// ==========================================
// Submit the form
// ==========================================
async function submitForm() {
    const payload = buildPayload();
    if (!payload) return;

    const submitBtn = document.getElementById('submitBtn');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Generating...';

    try {
        const res = await fetch(GENERATE_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const data = await res.json().catch(() => null);

        if (res.ok) {
            showResult('success', `
                <strong>Avatar generated successfully!</strong>
                <pre class="mt-2 mb-0" style="font-size:0.85rem; white-space:pre-wrap;">${JSON.stringify(data, null, 2)}</pre>
            `);
        } else {
            const errMsg = data?.error || data?.message || `HTTP ${res.status}: ${res.statusText}`;
            showResult('danger', `<strong>Error:</strong> ${errMsg}`);
        }
    } catch (err) {
        showResult('danger', `<strong>Connection Error:</strong> ${err.message}<br><small>Make sure the server is running at ${GENERATE_API}</small>`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
    }
}

// ==========================================
// Show result message
// ==========================================
function showResult(type, html) {
    const area = document.getElementById('resultArea');
    area.style.display = 'block';
    area.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${html}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ==========================================
// Sidebar Toggle
// ==========================================
document.getElementById('sidebarToggleBtn')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebarColumn');
    sidebar.classList.toggle('hidden');
    localStorage.setItem('sidebarHidden', sidebar.classList.contains('hidden') ? '1' : '0');
});

// Restore sidebar state on load (no animation on initial load)
if (localStorage.getItem('sidebarHidden') === '1') {
    const sidebar = document.getElementById('sidebarColumn');
    if (sidebar) {
        sidebar.style.transition = 'none';
        sidebar.classList.add('hidden');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                sidebar.style.transition = '';
            });
        });
    }
}

// ==========================================
// Sidebar Navigation
// ==========================================
document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;

        // Update active nav
        document.querySelectorAll('.nav-link[data-section]').forEach(l => l.classList.remove('active'));
        link.classList.add('active');

        // Toggle sections
        document.getElementById('home-section').style.display = section === 'home' ? 'block' : 'none';
        document.getElementById('content-area').style.display = section === 'assessment' ? 'block' : 'none';
        document.getElementById('videos-section').style.display = section === 'videos' ? 'block' : 'none';
        document.getElementById('assessments-section').style.display = section === 'assessments' ? 'block' : 'none';
        document.getElementById('answer-assessment-section').style.display = section === 'answer-assessment' ? 'block' : 'none';
        document.getElementById('assessment-board-section').style.display = section === 'assessment-board' ? 'block' : 'none';
        document.getElementById('voice-live-section').style.display = section === 'voice-live' ? 'block' : 'none';
        document.getElementById('students-section').style.display = section === 'students' ? 'block' : 'none';

        if (section === 'students') {
            loadStudentsList();
        }
        if (section === 'home') {
            loadHome();
        }
        if (section === 'videos') {
            loadVideos();
        }
        if (section === 'assessments') {
            loadAssessments();
        }
        if (section === 'answer-assessment') {
            loadAnswerAssessments();
        }
        if (section === 'assessment-board') {
            loadBoardAssessments();
        }
    });
});

// Load home on startup
loadHome();

// ==========================================
// Home Dashboard
// ==========================================
async function loadHome() {
    try {
        const [assessRes, statusRes] = await Promise.all([
            fetch('/api/assessments'),
            fetch('/api/assessment-recordings/status/all')
        ]);
        const assessData = await assessRes.json();
        const statusData = await statusRes.json();

        if (!assessData.success) return;
        const assessments = assessData.assessments || [];
        const answeredMap = statusData.success ? (statusData.answered || {}) : {};
        const videoProgressMap = statusData.videoProgress || {};
        const totalVideosMap = statusData.totalVideos || {};

        const now = new Date();
        const upcoming = [];
        const expired = [];
        const finished = [];
        let completedCount = 0;

        assessments.forEach(a => {
            const count = answeredMap[a.id] || 0;
            const progress = videoProgressMap[a.id] || 0;
            const total = totalVideosMap[a.id] || 0;
            const allDone = total <= 1 ? count > 0 : (progress >= total && count > 0);
            if (allDone) completedCount++;

            // Completed assessments always go to Finished
            if (allDone) {
                finished.push({ ...a, allDone, answerCount: count, progress, total });
            } else if (a.deadline) {
                const dl = new Date(a.deadline);
                if (dl < now) {
                    expired.push({ ...a, allDone, answerCount: count, progress, total });
                } else {
                    upcoming.push({ ...a, allDone, answerCount: count, progress, total, deadline: dl });
                }
            } else {
                // No deadline + not completed → show in upcoming
                upcoming.push({ ...a, allDone, answerCount: count, progress, total, deadline: null });
            }
        });

        // Sort upcoming by deadline (soonest first, no-deadline items last)
        upcoming.sort((a, b) => {
            if (!a.deadline && !b.deadline) return 0;
            if (!a.deadline) return 1;
            if (!b.deadline) return -1;
            return a.deadline - b.deadline;
        });

        // Stats
        document.getElementById('homeTotalAssessments').textContent = assessments.length;
        document.getElementById('homeUpcoming').textContent = upcoming.length;
        document.getElementById('homeExpired').textContent = expired.length;
        document.getElementById('homeCompleted').textContent = finished.length;

        // Render upcoming list
        const upcomingEl = document.getElementById('homeUpcomingList');
        if (upcoming.length === 0) {
            upcomingEl.innerHTML = '<div class="text-center text-muted py-3"><i class="fas fa-check-circle me-1"></i>No upcoming deadlines</div>';
        } else {
            upcomingEl.innerHTML = upcoming.map(a => {
                let timeStr, urgency, dlStr;
                if (a.deadline) {
                    const dl = new Date(a.deadline);
                    const diff = dl - now;
                    const daysLeft = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const hoursLeft = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    timeStr = daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h left` : `${hoursLeft}h left`;
                    urgency = daysLeft === 0 ? 'text-danger fw-bold' : daysLeft <= 2 ? 'text-warning' : 'text-muted';
                    dlStr = dl.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                } else {
                    timeStr = 'Open';
                    urgency = 'text-info';
                    dlStr = 'No deadline set';
                }
                const statusBadge = a.answerCount > 0
                    ? `<span class="badge bg-warning-subtle text-warning"><i class="fas fa-spinner me-1"></i>In progress</span>`
                    : '<span class="badge bg-secondary-subtle text-secondary">Not started</span>';
                const videoCount = (a.videos && a.videos.length) || 0;
                const videoTag = videoCount > 0 ? `<span class="badge bg-primary-subtle text-primary ms-1"><i class="fas fa-video me-1"></i>${videoCount}</span>` : '';
                const icon = a.deadline ? 'fa-clock' : 'fa-infinity';
                return `
                    <div class="home-assessment-row" onclick="openAnswerChat('${a.id}'); document.querySelectorAll('.nav-link[data-section]').forEach(l => l.classList.remove('active')); document.querySelector('[data-section=answer-assessment]').classList.add('active'); document.getElementById('home-section').style.display='none'; document.getElementById('answer-assessment-section').style.display='block';">
                        <div class="d-flex align-items-center gap-3">
                            <div class="home-deadline-badge ${urgency}">
                                <i class="fas ${icon} me-1"></i>${timeStr}
                            </div>
                            <div class="flex-grow-1">
                                <div class="fw-semibold">${escapeHtml(a.name)}${videoTag}</div>
                                <div class="small text-muted"><i class="fas fa-calendar me-1"></i>${dlStr}</div>
                            </div>
                            <div>${statusBadge}</div>
                            <i class="fas fa-chevron-right text-muted"></i>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Render expired list
        const expiredEl = document.getElementById('homeExpiredList');
        if (expired.length === 0) {
            expiredEl.innerHTML = '<div class="text-center text-muted py-3"><i class="fas fa-check-circle me-1"></i>No expired assessments</div>';
        } else {
            expiredEl.innerHTML = expired.map(a => {
                const dl = new Date(a.deadline);
                const dlStr = dl.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const statusBadge = a.allDone
                    ? '<span class="badge bg-success-subtle text-success"><i class="fas fa-check-circle me-1"></i>Completed</span>'
                    : '<span class="badge bg-danger-subtle text-danger"><i class="fas fa-lock me-1"></i>Closed</span>';
                return `
                    <div class="home-assessment-row expired-row" onclick="openAnswerChat('${a.id}'); document.querySelectorAll('.nav-link[data-section]').forEach(l => l.classList.remove('active')); document.querySelector('[data-section=answer-assessment]').classList.add('active'); document.getElementById('home-section').style.display='none'; document.getElementById('answer-assessment-section').style.display='block';">
                        <div class="d-flex align-items-center gap-3">
                            <div class="home-deadline-badge text-danger">
                                <i class="fas fa-lock me-1"></i>Closed
                            </div>
                            <div class="flex-grow-1">
                                <div class="fw-semibold">${escapeHtml(a.name)}</div>
                                <div class="small text-muted"><i class="fas fa-calendar me-1"></i>Was due ${dlStr}</div>
                            </div>
                            <div>${statusBadge}</div>
                            <i class="fas fa-chevron-right text-muted"></i>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Render finished list
        const finishedEl = document.getElementById('homeFinishedList');
        if (finished.length === 0) {
            finishedEl.innerHTML = '<div class="text-center text-muted py-3"><i class="fas fa-inbox me-1"></i>No finished assessments yet</div>';
        } else {
            finishedEl.innerHTML = finished.map(a => {
                const videoCount = (a.videos && a.videos.length) || 0;
                const videoTag = videoCount > 0 ? `<span class="badge bg-primary-subtle text-primary ms-1"><i class="fas fa-video me-1"></i>${videoCount}</span>` : '';
                const dlInfo = a.deadline
                    ? `<div class="small text-muted"><i class="fas fa-calendar me-1"></i>${new Date(a.deadline).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>`
                    : '<div class="small text-muted">No deadline</div>';
                return `
                    <div class="home-assessment-row" onclick="openAnswerChat('${a.id}'); document.querySelectorAll('.nav-link[data-section]').forEach(l => l.classList.remove('active')); document.querySelector('[data-section=answer-assessment]').classList.add('active'); document.getElementById('home-section').style.display='none'; document.getElementById('answer-assessment-section').style.display='block';">
                        <div class="d-flex align-items-center gap-3">
                            <div class="home-deadline-badge text-success">
                                <i class="fas fa-check-circle me-1"></i>Done
                            </div>
                            <div class="flex-grow-1">
                                <div class="fw-semibold">${escapeHtml(a.name)}${videoTag}</div>
                                ${dlInfo}
                            </div>
                            <div><span class="badge bg-success-subtle text-success"><i class="fas fa-check-circle me-1"></i>Completed</span></div>
                            <i class="fas fa-chevron-right text-muted"></i>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (err) {
        console.error('Error loading home:', err);
        document.getElementById('homeUpcomingList').innerHTML = '<div class="text-center text-danger py-3"><i class="fas fa-exclamation-circle me-1"></i>Error loading data</div>';
    }
}

// ==========================================
// Video Library
// ==========================================
let videosLoaded = false;

async function loadVideos(forceRefresh = false) {
    if (videosLoaded && !forceRefresh) return;

    const grid = document.getElementById('videosGrid');
    const loading = document.getElementById('videosLoading');
    const empty = document.getElementById('videosEmpty');

    grid.innerHTML = '';
    loading.style.display = 'block';
    empty.style.display = 'none';

    try {
        const res = await fetch('/api/avatar/videos');
        const data = await res.json();

        loading.style.display = 'none';

        if (!data.success || !data.videos || data.videos.length === 0) {
            empty.style.display = 'block';
            return;
        }

        videosLoaded = true;

        grid.innerHTML = data.videos.map(v => {
            const name = v.filename || v.publicId.split('/').pop();
            const sizeMB = v.size ? (v.size / (1024 * 1024)).toFixed(2) + ' MB' : 'N/A';
            const date = v.created ? new Date(v.created).toLocaleDateString() : '';
            const thumbUrl = v.thumbUrl || '';

            return `
                <div class="video-card">
                    <div class="video-thumbnail" onclick="playVideo('${v.url}')">
                        <img src="${thumbUrl}" alt="${name}" onerror="this.style.display='none'">
                        <div class="play-overlay">
                            <i class="fas fa-play-circle"></i>
                        </div>
                    </div>
                    <div class="video-info">
                        <div class="video-name" title="${name}">${name}</div>
                        <div class="video-meta">
                            ${v.format ? `<span><i class="fas fa-file-video"></i> ${v.format.toUpperCase()}</span>` : ''}
                            <span><i class="fas fa-hdd"></i> ${sizeMB}</span>
                            ${v.width && v.height ? `<span><i class="fas fa-expand"></i> ${v.width}×${v.height}</span>` : ''}
                            ${date ? `<span><i class="fas fa-calendar"></i> ${date}</span>` : ''}
                        </div>
                    </div>
                    <div class="video-actions">
                        <button class="btn btn-primary btn-sm" onclick="playVideo('${v.url}')">
                            <i class="fas fa-play me-1"></i> View
                        </button>
                        <a href="${v.url}" download class="btn btn-outline-secondary btn-sm">
                            <i class="fas fa-download me-1"></i> Download
                        </a>
                        <button class="btn btn-outline-danger btn-sm" onclick="deleteVideo('${v.publicId}')" title="Delete from Cloudinary">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        loading.style.display = 'none';
        grid.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-1"></i>
                Failed to load videos: ${err.message}
            </div>
        `;
    }
}

function playVideo(url) {
    const modal = document.createElement('div');
    modal.className = 'video-modal-backdrop';
    modal.innerHTML = `
        <div class="video-modal-content">
            <button class="video-modal-close" onclick="closeVideoModal(this)">&times;</button>
            <video controls autoplay>
                <source src="${url}" type="video/mp4">
                Your browser does not support video playback.
            </video>
        </div>
    `;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeVideoModal(modal.querySelector('.video-modal-close'));
    });
    document.body.appendChild(modal);
}

function closeVideoModal(btn) {
    const modal = btn.closest('.video-modal-backdrop');
    const video = modal.querySelector('video');
    if (video) video.pause();
    modal.remove();
}

async function deleteVideo(publicId) {
    if (!confirm('Delete this video from Cloudinary? This cannot be undone.')) return;
    try {
        const res = await fetch(`/api/avatar/videos/${encodeURIComponent(publicId)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Delete failed');
        // Refresh the video list
        videosLoaded = false;
        loadVideos(true);
    } catch (err) {
        alert('Failed to delete video: ' + err.message);
    }
}

// Refresh button
document.getElementById('refreshVideosBtn')?.addEventListener('click', () => {
    loadVideos(true);
});

// ==========================================
// Assessments
// ==========================================
let assessmentsLoaded = false;
let selectedVideos = []; // Array of { publicId, url, thumbUrl, filename }

async function loadAssessments(forceRefresh = false) {
    if (assessmentsLoaded && !forceRefresh) return;

    const list = document.getElementById('assessmentsList');
    const loading = document.getElementById('assessmentsLoading');
    const empty = document.getElementById('assessmentsEmpty');

    list.innerHTML = '';
    loading.style.display = 'block';
    empty.style.display = 'none';

    try {
        const res = await fetch('/api/assessments');
        const data = await res.json();
        loading.style.display = 'none';

        if (!data.success || !data.assessments || data.assessments.length === 0) {
            empty.style.display = 'block';
            assessmentsLoaded = true;
            return;
        }

        assessmentsLoaded = true;

        // Sort newest first
        const sorted = data.assessments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        list.innerHTML = sorted.map(a => {
            const date = new Date(a.createdAt).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric'
            });
            const deadlineHtml = a.deadline
                ? (() => {
                    const dl = new Date(a.deadline);
                    const now = new Date();
                    const isPast = dl < now;
                    const dlStr = dl.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    return `<div class="assessment-deadline ${isPast ? 'text-danger' : 'text-warning'}"><i class="fas fa-clock me-1"></i>Deadline: ${dlStr}</div>`;
                  })()
                : '';
            // Support both old single-video and new multi-video format
            const videos = a.videos || (a.videoPublicId ? [{ publicId: a.videoPublicId, url: a.videoUrl, thumbUrl: a.videoThumbUrl, filename: a.videoFilename }] : []);
            const videoHtml = videos.length > 0
                ? `<span class="assessment-video-badge" onclick="playVideo('${videos[0].url}')">
                        <i class="fas fa-play-circle"></i> ${videos.length} video${videos.length > 1 ? 's' : ''} attached
                   </span>`
                : '';
            return `
                <div class="assessment-item" data-id="${a.id}">
                    <div class="assessment-header">
                        <div>
                            <div class="assessment-title">${escapeHtml(a.name)}</div>
                            <div class="assessment-date"><i class="fas fa-calendar-alt me-1"></i>${date}</div>
                        </div>
                        <div class="assessment-actions">
                            <button class="btn btn-outline-info btn-sm" onclick="viewResponses('${a.id}', '${escapeHtml(a.name).replace(/'/g, "\\'") }')" title="View Responses">
                                <i class="fas fa-users"></i>
                            </button>
                            <button class="btn btn-outline-primary btn-sm" onclick="editAssessment('${a.id}')" title="Edit">
                                <i class="fas fa-pen"></i>
                            </button>
                            <button class="btn btn-outline-danger btn-sm" onclick="deleteAssessment('${a.id}')" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    ${a.description ? `<div class="assessment-desc">${escapeHtml(a.description)}</div>` : ''}
                    ${deadlineHtml}
                    ${videoHtml}
                </div>
            `;
        }).join('');
    } catch (err) {
        loading.style.display = 'none';
        list.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i> Failed to load assessments: ${err.message}</div>`;
    }
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ==========================================
// Responses Viewer
// ==========================================
let currentResponsesAssessmentId = null;

async function viewResponses(assessmentId, assessmentName) {
    currentResponsesAssessmentId = assessmentId;
    const modal = document.getElementById('responsesModal');
    const loading = document.getElementById('responsesLoading');
    const empty = document.getElementById('responsesEmpty');
    const list = document.getElementById('responsesList');

    modal.style.display = 'flex';
    loading.style.display = 'block';
    empty.style.display = 'none';
    list.innerHTML = '';
    document.getElementById('responsesAssessmentName').textContent = assessmentName;
    document.getElementById('responsesCount').textContent = '...';

    try {
        const res = await fetch(`/api/assessment-recordings/${assessmentId}/all-responses`);
        const data = await res.json();
        loading.style.display = 'none';

        if (!data.success) throw new Error(data.error || 'Failed to load');

        if (!data.students || data.students.length === 0) {
            empty.style.display = 'block';
            document.getElementById('responsesCount').textContent = '0 students';
            return;
        }

        document.getElementById('responsesCount').textContent = `${data.total} student${data.total !== 1 ? 's' : ''}`;

        const assessmentVideos = data.assessmentVideos || [];

        list.innerHTML = data.students.map(s => {
            const lastDate = s.lastActivity ? new Date(s.lastActivity).toLocaleString() : 'N/A';

            // Group messages by video question using video_shown markers
            const sortedMsgs = s.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const groups = []; // { videoIndex, question, label, answers[] }
            let currentGroup = null;

            for (const m of sortedMsgs) {
                if (m.type === 'video_shown') {
                    const vi = m.videoIndex !== undefined ? m.videoIndex : parseInt(m.text || '0', 10);
                    const video = assessmentVideos[vi];
                    const question = video?.question || null;
                    const correctAnswer = video?.correctAnswer || null;
                    const label = assessmentVideos.length > 1 ? `Video ${vi + 1} of ${assessmentVideos.length}` : 'Assessment Video';
                    currentGroup = { videoIndex: vi, question, correctAnswer, label, answers: [] };
                    groups.push(currentGroup);
                    continue;
                }
                if (m.type === 'video_progress') continue;
                if (m.type !== 'text' && m.type !== 'voice') continue;

                // If no group yet (legacy data or no-video assessment), create a default group
                if (!currentGroup) {
                    // Try to assign first video's question if available
                    const firstVideo = assessmentVideos[0];
                    currentGroup = { videoIndex: 0, question: firstVideo?.question || null, correctAnswer: firstVideo?.correctAnswer || null, label: assessmentVideos.length > 0 ? 'Assessment Video' : null, answers: [] };
                    groups.push(currentGroup);
                }
                currentGroup.answers.push(m);
            }

            // Render grouped messages
            const isAdmin = document.body.dataset.role === 'super-admin';
            const messagesHtml = groups.map(g => {
                let html = '';
                if (g.label || g.question) {
                    html += `<div class="response-question-header">
                        ${g.label ? `<div class="response-question-label"><i class="fas fa-video me-1"></i>${escapeHtml(g.label)}</div>` : ''}
                        ${g.question ? `<div class="response-question-text"><i class="fas fa-question-circle me-1 text-primary"></i><strong>Question:</strong> ${escapeHtml(g.question)}</div>` : ''}
                        ${g.correctAnswer && isAdmin ? `<div class="response-correct-answer"><i class="fas fa-check-circle me-1 text-success"></i><strong>Correct Answer:</strong> ${escapeHtml(g.correctAnswer)}</div>` : ''}
                    </div>`;
                }
                html += g.answers.map(m => {
                    const date = new Date(m.created || m.timestamp).toLocaleString();
                    if (m.type === 'text') {
                        return `<div class="response-msg response-msg-text">
                            <div class="response-msg-meta"><i class="fas fa-comment me-1"></i>${date}</div>
                            <div>${escapeHtml(m.text)}</div>
                        </div>`;
                    } else {
                        return `<div class="response-msg response-msg-voice">
                            <div class="response-msg-meta"><i class="fas fa-microphone me-1"></i>${date}</div>
                            <audio controls preload="metadata" class="response-audio-player">
                                <source src="${m.url}" type="audio/webm">
                                <source src="${m.url}" type="audio/mp4">
                            </audio>
                            ${m.transcript ? `<div class="response-transcript"><i class="fas fa-language me-1 text-muted"></i>${escapeHtml(m.transcript)}</div>` : ''}
                        </div>`;
                    }
                }).join('');
                return html;
            }).join('');

            return `
                <div class="response-student-card">
                    <div class="response-student-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <div class="d-flex align-items-center gap-2 flex-grow-1">
                            <div class="response-avatar"><i class="fas fa-user"></i></div>
                            <div>
                                <div class="fw-bold">${escapeHtml(s.name)}</div>
                                <div class="text-muted small">${escapeHtml(s.email)}</div>
                            </div>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            ${s.textCount > 0 ? `<span class="badge bg-primary-subtle text-primary"><i class="fas fa-comment me-1"></i>${s.textCount}</span>` : ''}
                            ${s.voiceCount > 0 ? `<span class="badge bg-success-subtle text-success"><i class="fas fa-microphone me-1"></i>${s.voiceCount}</span>` : ''}
                            <span class="text-muted small">${lastDate}</span>
                            <i class="fas fa-chevron-down response-chevron"></i>
                        </div>
                    </div>
                    <div class="response-student-body">
                        ${messagesHtml}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        loading.style.display = 'none';
        list.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${err.message}</div>`;
    }
}

async function aiGradeAssessment() {
    if (!currentResponsesAssessmentId) return;
    const btn = document.getElementById('aiGradeBtn');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Grading...';

    try {
        const res = await fetch(`/api/ai-grade-assessment/${currentResponsesAssessmentId}`, { method: 'POST' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Grading failed');

        const results = data.results || [];
        if (results.length === 0) {
            alert('No students to grade.');
            return;
        }

        // Inject AI feedback into each student card
        const studentCards = document.querySelectorAll('.response-student-card');
        for (const card of studentCards) {
            const nameEl = card.querySelector('.fw-bold');
            if (!nameEl) continue;
            const studentName = nameEl.textContent.trim();
            const result = results.find(r => r.name === studentName);
            if (!result || result.error) continue;

            // Add total score badge next to name
            const existingBadge = nameEl.parentElement.querySelector('.ai-grade-badge');
            if (existingBadge) existingBadge.remove();
            const badge = document.createElement('span');
            badge.className = 'badge bg-warning text-dark ai-grade-badge ms-2';
            badge.innerHTML = `<i class="fas fa-magic me-1"></i>${result.totalScore} marks`;
            nameEl.parentElement.appendChild(badge);

            // Add per-question feedback under each question header
            if (result.grades && result.grades.length > 0) {
                const questionHeaders = card.querySelectorAll('.response-question-header');
                result.grades.forEach((g, i) => {
                    const qHeader = questionHeaders[i];
                    if (!qHeader) return;
                    const existingFb = qHeader.querySelector('.ai-grade-feedback');
                    if (existingFb) existingFb.remove();
                    const fb = document.createElement('div');
                    fb.className = 'ai-grade-feedback';
                    fb.innerHTML = `<i class="fas fa-magic me-1 text-warning"></i><strong>${g.score}</strong> marks — ${escapeHtml(g.feedback)}`;
                    qHeader.appendChild(fb);
                });
            }

            // Expand the card to show grades
            card.classList.add('expanded');
        }

        // Summary alert
        const summaryLines = results.map(r => {
            if (r.error) return `${r.name}: Failed`;
            return `${r.name}: ${r.totalScore} marks`;
        });
        alert(`AI Grading Complete!\n\n${summaryLines.join('\n')}`);
    } catch (err) {
        console.error('AI grading error:', err);
        alert('AI grading failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

document.getElementById('closeResponsesBtn')?.addEventListener('click', () => {
    document.getElementById('responsesModal').style.display = 'none';
});

document.getElementById('responsesModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'responsesModal') {
        document.getElementById('responsesModal').style.display = 'none';
    }
});

// ==========================================
// Assessment Board
// ==========================================
let boardAssessmentsCache = [];

async function loadBoardAssessments() {
    const select = document.getElementById('boardAssessmentSelect');
    try {
        const res = await fetch('/api/assessments');
        const data = await res.json();
        if (!data.success) return;
        boardAssessmentsCache = data.assessments || [];
        select.innerHTML = '<option value="">-- Choose an assessment --</option>' +
            boardAssessmentsCache.map(a => `<option value="${a.id}">${escapeHtml(a.name)}${a.fullMarks ? ` (${a.fullMarks} marks)` : ''}</option>`).join('');
    } catch (_) {}
}

document.getElementById('boardAssessmentSelect')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (id) {
        loadBoard(id);
    } else {
        document.getElementById('boardTableWrapper').style.display = 'none';
        document.getElementById('boardEmpty').style.display = 'none';
    }
});

async function loadBoard(assessmentId) {
    const loading = document.getElementById('boardLoading');
    const empty = document.getElementById('boardEmpty');
    const wrapper = document.getElementById('boardTableWrapper');
    const tbody = document.getElementById('boardTableBody');
    const summary = document.getElementById('boardSummary');

    loading.style.display = 'block';
    empty.style.display = 'none';
    wrapper.style.display = 'none';
    tbody.innerHTML = '';

    try {
        const res = await fetch(`/api/assessment-recordings/${assessmentId}/all-responses`);
        const data = await res.json();
        loading.style.display = 'none';

        if (!data.success) throw new Error(data.error);

        if (!data.students || data.students.length === 0) {
            empty.style.display = 'block';
            return;
        }

        const fullMarks = data.fullMarks;
        const totalVideos = data.totalVideos || 0;
        const total = data.students.length;
        const answered = data.students.filter(s => s.responseCount > 0).length;
        const graded = data.students.filter(s => s.marks !== null).length;
        const avgMarks = graded > 0 ? (data.students.filter(s => s.marks !== null).reduce((sum, s) => sum + s.marks, 0) / graded).toFixed(1) : '-';

        summary.innerHTML = `
            <div class="board-summary-card">
                <i class="fas fa-users text-primary"></i>
                <span>Responded:</span>
                <span class="board-summary-value">${answered}</span>
            </div>
            <div class="board-summary-card">
                <i class="fas fa-check-circle text-success"></i>
                <span>Graded:</span>
                <span class="board-summary-value">${graded}/${total}</span>
            </div>
            ${fullMarks ? `<div class="board-summary-card">
                <i class="fas fa-star text-warning"></i>
                <span>Full Marks:</span>
                <span class="board-summary-value">${fullMarks}</span>
            </div>` : ''}
            ${graded > 0 ? `<div class="board-summary-card">
                <i class="fas fa-chart-bar text-info"></i>
                <span>Average:</span>
                <span class="board-summary-value">${avgMarks}${fullMarks ? '/' + fullMarks : ''}</span>
            </div>` : ''}
        `;

        tbody.innerHTML = data.students.map((s, i) => {
            const allDone = totalVideos <= 1 ? s.responseCount > 0 : (s.videoProgress >= totalVideos && s.responseCount > 0);
            const statusClass = allDone ? 'completed' : s.responseCount > 0 ? 'in-progress' : 'not-started';
            const statusLabel = allDone ? 'Completed' : s.responseCount > 0 ? 'In Progress' : 'Not Started';
            const statusIcon = allDone ? 'fa-check-circle' : s.responseCount > 0 ? 'fa-clock' : 'fa-times-circle';
            const marksVal = s.marks !== null ? s.marks : '';
            const marksDisplay = fullMarks ? `/ ${fullMarks}` : '';

            const marksCell = window.isAdmin
                ? `<td>
                        <div class="board-marks-cell">
                            <input type="number" class="form-control form-control-sm board-marks-input" 
                                   value="${marksVal}" min="0" ${fullMarks ? `max="${fullMarks}"` : ''}
                                   data-username="${s.username}" data-assessment="${assessmentId}"
                                   onchange="saveStudentMarks(this)">
                            <span class="board-marks-total">${marksDisplay}</span>
                        </div>
                   </td>`
                : `<td>
                        <span class="fw-bold">${marksVal !== '' ? marksVal : '-'}</span>
                        <span class="text-muted small">${marksDisplay}</span>
                   </td>`;

            const actionCell = window.isAdmin
                ? `<td>
                        <button class="btn btn-outline-primary btn-sm board-view-btn" 
                                onclick="viewResponses('${assessmentId}', '${escapeHtml(s.name).replace(/'/g, "\\'")}')" title="View Responses">
                            <i class="fas fa-eye me-1"></i>View
                        </button>
                   </td>`
                : '';

            return `
                <tr>
                    <td class="text-muted">${i + 1}</td>
                    <td class="fw-semibold">${escapeHtml(s.name)}</td>
                    <td class="text-muted small">${escapeHtml(s.email)}</td>
                    <td><span class="board-status-badge ${statusClass}"><i class="fas ${statusIcon}"></i>${statusLabel}</span></td>
                    <td>${s.videoProgress}/${totalVideos}</td>
                    <td>
                        <span class="badge bg-primary-subtle text-primary me-1">${s.textCount} <i class="fas fa-comment"></i></span>
                        <span class="badge bg-success-subtle text-success">${s.voiceCount} <i class="fas fa-microphone"></i></span>
                    </td>
                    ${marksCell}
                    ${actionCell}
                </tr>
            `;
        }).join('');

        wrapper.style.display = 'block';
    } catch (err) {
        loading.style.display = 'none';
        document.getElementById('boardTableBody').innerHTML = `<tr><td colspan="8" class="text-danger text-center">${err.message}</td></tr>`;
        wrapper.style.display = 'block';
    }
}

async function saveStudentMarks(input) {
    const username = input.dataset.username;
    const assessmentId = input.dataset.assessment;
    const marks = input.value !== '' ? Number(input.value) : null;

    input.style.borderColor = '#fbbf24';
    try {
        const res = await fetch(`/api/assessment-marks/${assessmentId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, marks })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        input.style.borderColor = '#22c55e';
        setTimeout(() => { input.style.borderColor = ''; }, 1500);
    } catch (err) {
        input.style.borderColor = '#ef4444';
        alert('Failed to save marks: ' + err.message);
    }
}

// ==========================================
// Competency Assessment Board (per-student, editable)
// ==========================================
const defaultCompetencies = [
    { type: 'Functional', name: 'Commitment to patient-centered care', standard: 1, self: 3, leader: 3, final: 3, gap: 2 },
    { type: 'Functional', name: 'Problem-solving and clinical decision-making', standard: 1, self: 2, leader: 3, final: 3, gap: 2 },
    { type: 'Functional', name: 'Building and maintaining therapeutic relationships', standard: 1, self: 3, leader: 3, final: 3, gap: 2 },
    { type: 'Functional', name: 'Nursing management and administration', standard: 1, self: 2, leader: 3, final: 3, gap: 2 },
    { type: 'Specific', name: 'Key clinical issues :: Care and services for patients at the health checkup unit', standard: 1, self: 3, leader: 3, final: 3, gap: 2 },
    { type: 'Specific', name: 'Key clinical issues :: Patient satisfaction at health checkup units', standard: 1, self: 3, leader: 4, final: 4, gap: 3 },
    { type: 'Managerial', name: 'Leadership', standard: 1, self: 3, leader: 3, final: 3, gap: 2 },
    { type: 'Managerial', name: 'Vision', standard: 1, self: 3, leader: 3, final: 3, gap: 2 },
    { type: 'Managerial', name: 'Potential for leading change', standard: 1, self: 3, leader: 3, final: 3, gap: 2 },
    { type: 'Managerial', name: 'Self-control', standard: 1, self: 3, leader: 4, final: 4, gap: 3 },
    { type: 'Managerial', name: 'Potential development', standard: 1, self: 3, leader: 4, final: 4, gap: 3 }
];

let currentCompData = null;  // current student's loaded data
let compDirty = false;

function switchBoardTab(tab, el) {
    document.querySelectorAll('#boardTabs .nav-link').forEach(a => a.classList.remove('active'));
    el.classList.add('active');

    if (tab === 'student') {
        document.getElementById('studentBoardPanel').style.display = 'block';
        document.getElementById('competencyBoardPanel').style.display = 'none';
    } else {
        document.getElementById('studentBoardPanel').style.display = 'none';
        document.getElementById('competencyBoardPanel').style.display = 'block';
        if (window.isAdmin) {
            loadCompStudentList();
        } else {
            // Students: auto-load their own competency data
            loadOwnCompetency();
        }
    }
}

async function loadOwnCompetency() {
    // Hide student selector for students
    const selectRow = document.getElementById('compStudentSelect')?.closest('.row');
    if (selectRow) selectRow.style.display = 'none';

    const username = (window.currentUserEmail || '').split('@')[0];
    if (!username) return;

    try {
        const res = await fetch(`/api/competency/${username}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        if (!data.data) {
            const emptyState = document.getElementById('compEmpty');
            emptyState.style.display = 'block';
            // Remove init button for students
            const initBtn = emptyState.querySelector('button');
            if (initBtn) initBtn.style.display = 'none';
            document.getElementById('compContentWrapper').style.display = 'none';
            emptyState.querySelector('p').textContent = 'No competency data assigned yet. Please contact your admin.';
            return;
        }

        currentCompData = data.data;
        showCompetencyBoard();
    } catch (err) {
        console.error('Load own competency error:', err);
    }
}

async function loadCompStudentList() {
    const select = document.getElementById('compStudentSelect');
    try {
        const res = await fetch('/api/students');
        const data = await res.json();
        if (!data.success) return;
        select.innerHTML = '<option value="">-- Choose a student --</option>' +
            data.students.map(s => `<option value="${s.username}">${escapeHtml(s.name)} (${escapeHtml(s.email)})</option>`).join('');
    } catch (_) {}
}

async function loadStudentCompetency() {
    const username = document.getElementById('compStudentSelect').value;
    const contentWrapper = document.getElementById('compContentWrapper');
    const emptyState = document.getElementById('compEmpty');
    const saveBtn = document.getElementById('compSaveBtn');
    const addRowBtn = document.getElementById('compAddRowBtn');
    const saveStatus = document.getElementById('compSaveStatus');

    contentWrapper.style.display = 'none';
    emptyState.style.display = 'none';
    saveBtn.style.display = 'none';
    addRowBtn.style.display = 'none';
    saveStatus.textContent = '';
    currentCompData = null;
    compDirty = false;

    if (!username) return;

    try {
        const res = await fetch(`/api/competency/${username}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        if (!data.data) {
            // No data yet — show empty state with init button
            emptyState.style.display = 'block';
            return;
        }

        currentCompData = data.data;
        showCompetencyBoard();
    } catch (err) {
        emptyState.style.display = 'block';
        console.error('Load competency error:', err);
    }
}

function initDefaultCompetency() {
    const username = document.getElementById('compStudentSelect').value;
    if (!username) return;

    currentCompData = {
        personnelType: 'Level 1',
        level: '0-1 year',
        standardLevel: 'Standard level',
        competencies: JSON.parse(JSON.stringify(defaultCompetencies))
    };
    compDirty = true;
    showCompetencyBoard();
    // Auto-save the default
    saveStudentCompetency();
}

function showCompetencyBoard() {
    const contentWrapper = document.getElementById('compContentWrapper');
    const emptyState = document.getElementById('compEmpty');
    const saveBtn = document.getElementById('compSaveBtn');
    const addRowBtn = document.getElementById('compAddRowBtn');

    emptyState.style.display = 'none';
    contentWrapper.style.display = 'block';

    if (window.isAdmin) {
        saveBtn.style.display = 'inline-flex';
        addRowBtn.style.display = 'inline-flex';
    } else {
        saveBtn.style.display = 'none';
        addRowBtn.style.display = 'none';
    }

    // Fill info fields
    const ptEl = document.getElementById('compPersonnelType');
    const lvEl = document.getElementById('compLevel');
    const slEl = document.getElementById('compStdLevel');
    ptEl.value = currentCompData.personnelType || '';
    lvEl.value = currentCompData.level || '';
    slEl.value = currentCompData.standardLevel || '';

    if (!window.isAdmin) {
        ptEl.readOnly = true;
        lvEl.readOnly = true;
        slEl.readOnly = true;
    }

    renderCompetencyBoard();
}

function renderCompetencyBoard() {
    const d = currentCompData;
    if (!d || !d.competencies) return;

    const comps = d.competencies;
    const total = comps.length;
    const avgFinal = total > 0 ? (comps.reduce((s, c) => s + (c.final || 0), 0) / total).toFixed(1) : '0';
    const avgGap = total > 0 ? (comps.reduce((s, c) => s + (c.gap || 0), 0) / total).toFixed(1) : '0';
    const criticalCount = comps.filter(c => (c.gap || 0) >= 3).length;

    document.getElementById('compSummary').innerHTML = `
        <div class="comp-summary-card">
            <div class="comp-summary-icon" style="background: rgba(59,130,246,0.1); color: #3b82f6;">
                <i class="fas fa-list-check"></i>
            </div>
            <div>
                <div class="comp-summary-label">Total Competencies</div>
                <div class="comp-summary-value">${total}</div>
            </div>
        </div>
        <div class="comp-summary-card">
            <div class="comp-summary-icon" style="background: rgba(16,185,129,0.1); color: #10b981;">
                <i class="fas fa-chart-line"></i>
            </div>
            <div>
                <div class="comp-summary-label">Avg Final Score</div>
                <div class="comp-summary-value">${avgFinal}</div>
            </div>
        </div>
        <div class="comp-summary-card">
            <div class="comp-summary-icon" style="background: rgba(245,158,11,0.1); color: #f59e0b;">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <div>
                <div class="comp-summary-label">Avg Gap</div>
                <div class="comp-summary-value">${avgGap}</div>
            </div>
        </div>
        <div class="comp-summary-card">
            <div class="comp-summary-icon" style="background: rgba(239,68,68,0.1); color: #ef4444;">
                <i class="fas fa-fire"></i>
            </div>
            <div>
                <div class="comp-summary-label">Critical Gaps</div>
                <div class="comp-summary-value">${criticalCount}</div>
            </div>
        </div>
    `;

    // Build table rows — flat list, each row fully editable (admin) or read-only (student)
    const tbody = document.getElementById('compTableBody');
    let rows = '';
    const ro = !window.isAdmin;

    comps.forEach((c, idx) => {
        const gapClass = (c.gap || 0) === 0 ? 'comp-gap-none' : c.gap === 1 ? 'comp-gap-low' : c.gap === 2 ? 'comp-gap-mid' : 'comp-gap-high';
        const gapLabel = (c.gap || 0) === 0 ? 'Met' : c.gap === 1 ? 'Slight' : c.gap === 2 ? 'Moderate' : 'Critical';
        const gapBarWidth = Math.min((c.gap || 0) * 25, 100);

        const typeCell = ro
            ? `<td><span class="badge bg-secondary-subtle text-dark">${escapeHtml(c.type)}</span></td>`
            : `<td>
                    <select class="form-select form-select-sm comp-type-select" data-idx="${idx}" onchange="updateCompField(this, 'type')">
                        <option value="Functional" ${c.type === 'Functional' ? 'selected' : ''}>Functional</option>
                        <option value="Specific" ${c.type === 'Specific' ? 'selected' : ''}>Specific</option>
                        <option value="Managerial" ${c.type === 'Managerial' ? 'selected' : ''}>Managerial</option>
                    </select>
               </td>`;

        const nameCell = ro
            ? `<td>${escapeHtml(c.name)}</td>`
            : `<td>
                    <input type="text" class="form-control form-control-sm comp-name-input" 
                           value="${escapeHtml(c.name)}" data-idx="${idx}" 
                           onchange="updateCompField(this, 'name')" placeholder="Competency name">
               </td>`;

        const roAttr = ro ? ' readonly disabled' : '';

        rows += `
            <tr class="comp-row" id="compRow${idx}">
                <td class="text-muted comp-row-num">${idx + 1}</td>
                ${typeCell}
                ${nameCell}
                <td class="text-center">
                    <input type="number" class="comp-score-input comp-score-standard" 
                           value="${c.standard}" min="0" max="5" data-idx="${idx}" data-field="standard"
                           onchange="updateCompScore(this)"${roAttr}>
                </td>
                <td class="text-center">
                    <input type="number" class="comp-score-input comp-score-self" 
                           value="${c.self}" min="0" max="5" data-idx="${idx}" data-field="self"
                           onchange="updateCompScore(this)"${roAttr}>
                </td>
                <td class="text-center">
                    <input type="number" class="comp-score-input comp-score-leader" 
                           value="${c.leader}" min="0" max="5" data-idx="${idx}" data-field="leader"
                           onchange="updateCompScore(this)"${roAttr}>
                </td>
                <td class="text-center">
                    <input type="number" class="comp-score-input comp-score-final" 
                           value="${c.final}" min="0" max="5" data-idx="${idx}" data-field="final"
                           onchange="updateCompScore(this)"${roAttr}>
                </td>
                <td class="text-center"><span class="comp-gap-badge ${gapClass}" id="compGapBadge${idx}">${c.gap || 0}</span></td>
                <td>
                    <div class="comp-gap-bar-wrapper">
                        <div class="comp-gap-bar ${gapClass}" id="compGapBar${idx}" style="width: ${gapBarWidth}%;"></div>
                        <span class="comp-gap-bar-label" id="compGapLabel${idx}">${gapLabel}</span>
                    </div>
                </td>
                ${ro ? '' : `<td class="text-center">
                    <button class="btn btn-link btn-sm text-danger p-0" onclick="removeCompRow(${idx})" title="Remove">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>`}
            </tr>
        `;
    });

    tbody.innerHTML = rows;
}

function updateCompField(el, field) {
    const idx = parseInt(el.dataset.idx);
    if (!currentCompData || !currentCompData.competencies[idx]) return;
    currentCompData.competencies[idx][field] = el.value;
    markCompDirty();
}

function updateCompScore(input) {
    const idx = parseInt(input.dataset.idx);
    const field = input.dataset.field;
    const val = parseInt(input.value) || 0;

    if (!currentCompData || !currentCompData.competencies[idx]) return;
    currentCompData.competencies[idx][field] = val;

    // Recalculate gap (= final - standard)
    const c = currentCompData.competencies[idx];
    c.gap = Math.max((c.final || 0) - (c.standard || 0), 0);

    // Update gap badge
    const gapBadge = document.getElementById(`compGapBadge${idx}`);
    const gapBar = document.getElementById(`compGapBar${idx}`);
    const gapLabelEl = document.getElementById(`compGapLabel${idx}`);

    const gapClass = c.gap === 0 ? 'comp-gap-none' : c.gap === 1 ? 'comp-gap-low' : c.gap === 2 ? 'comp-gap-mid' : 'comp-gap-high';
    const gapText = c.gap === 0 ? 'Met' : c.gap === 1 ? 'Slight' : c.gap === 2 ? 'Moderate' : 'Critical';
    const gapBarWidth = Math.min(c.gap * 25, 100);

    if (gapBadge) {
        gapBadge.textContent = c.gap;
        gapBadge.className = `comp-gap-badge ${gapClass}`;
    }
    if (gapBar) {
        gapBar.style.width = gapBarWidth + '%';
        gapBar.className = `comp-gap-bar ${gapClass}`;
    }
    if (gapLabelEl) gapLabelEl.textContent = gapText;

    // Flash green
    input.style.borderColor = '#22c55e';
    input.style.boxShadow = '0 0 0 2px rgba(34,197,94,0.25)';
    setTimeout(() => {
        input.style.borderColor = '';
        input.style.boxShadow = '';
    }, 800);

    markCompDirty();
    updateCompSummary();
}

function updateCompSummary() {
    if (!currentCompData) return;
    const comps = currentCompData.competencies;
    const total = comps.length;
    if (total === 0) return;

    const avgFinal = (comps.reduce((s, c) => s + (c.final || 0), 0) / total).toFixed(1);
    const avgGap = (comps.reduce((s, c) => s + (c.gap || 0), 0) / total).toFixed(1);
    const criticalCount = comps.filter(c => (c.gap || 0) >= 3).length;

    const summaryCards = document.querySelectorAll('#compSummary .comp-summary-value');
    if (summaryCards.length >= 4) {
        summaryCards[0].textContent = total;
        summaryCards[1].textContent = avgFinal;
        summaryCards[2].textContent = avgGap;
        summaryCards[3].textContent = criticalCount;
    }
}

function addCompetencyRow() {
    if (!currentCompData) return;
    currentCompData.competencies.push({
        type: 'Functional',
        name: '',
        standard: 1,
        self: 0,
        leader: 0,
        final: 0,
        gap: 0
    });
    markCompDirty();
    renderCompetencyBoard();
    // Focus the new name input
    setTimeout(() => {
        const inputs = document.querySelectorAll('.comp-name-input');
        if (inputs.length > 0) inputs[inputs.length - 1].focus();
    }, 100);
}

function removeCompRow(idx) {
    if (!currentCompData || !currentCompData.competencies[idx]) return;
    const name = currentCompData.competencies[idx].name || 'this row';
    if (!confirm(`Remove "${name}"?`)) return;
    currentCompData.competencies.splice(idx, 1);
    markCompDirty();
    renderCompetencyBoard();
}

function markCompDirty() {
    compDirty = true;
    const saveBtn = document.getElementById('compSaveBtn');
    if (saveBtn) {
        saveBtn.classList.remove('btn-success');
        saveBtn.classList.add('btn-warning');
        saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save *';
    }
}

async function saveStudentCompetency() {
    const username = document.getElementById('compStudentSelect').value;
    if (!username || !currentCompData) return;

    // Read latest info field values
    currentCompData.personnelType = document.getElementById('compPersonnelType').value;
    currentCompData.level = document.getElementById('compLevel').value;
    currentCompData.standardLevel = document.getElementById('compStdLevel').value;

    const saveBtn = document.getElementById('compSaveBtn');
    const saveStatus = document.getElementById('compSaveStatus');
    saveBtn.disabled = true;
    saveStatus.textContent = 'Saving...';

    try {
        const res = await fetch(`/api/competency/${username}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentCompData)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        compDirty = false;
        saveBtn.classList.remove('btn-warning');
        saveBtn.classList.add('btn-success');
        saveBtn.innerHTML = '<i class="fas fa-check me-1"></i>Saved';
        saveStatus.textContent = 'Saved just now';
        saveStatus.style.color = '#22c55e';

        setTimeout(() => {
            saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save';
            saveStatus.style.color = '';
            saveStatus.textContent = '';
        }, 2000);
    } catch (err) {
        saveStatus.textContent = 'Failed: ' + err.message;
        saveStatus.style.color = '#ef4444';
    } finally {
        saveBtn.disabled = false;
    }
}

// ==========================================
// Students Management
// ==========================================
let allStudentsData = [];

async function loadStudentsList() {
    try {
        const res = await fetch('/admin/users');
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        allStudentsData = data.users || [];
        renderStudentTable(allStudentsData);
        // Stats
        document.getElementById('totalStudentCount').textContent = allStudentsData.length;
        document.getElementById('adminStudentCount').textContent = allStudentsData.filter(u => u.isAdmin).length;
    } catch (err) {
        console.error('Load students error:', err);
        document.getElementById('studentTableBody').innerHTML =
            '<tr><td colspan="7" class="text-center text-danger py-4">Failed to load students</td></tr>';
    }
}

function renderStudentTable(users) {
    const tbody = document.getElementById('studentTableBody');
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-user-slash me-2"></i>No students yet</td></tr>';
        return;
    }
    tbody.innerHTML = users.map((u, i) => `
        <tr>
            <td class="text-muted">${i + 1}</td>
            <td><strong>${escapeHtml(u.name || '')}</strong></td>
            <td><span class="text-muted">${escapeHtml(u.email || '')}</span></td>
            <td><code>${escapeHtml(u.studentId || u.id?.toString() || '-')}</code></td>
            <td>
                <span class="badge ${u.isAdmin ? 'bg-danger' : 'bg-primary'} rounded-pill">
                    ${u.isAdmin ? '<i class="fas fa-shield-alt me-1"></i>Admin' : '<i class="fas fa-user me-1"></i>Student'}
                </span>
            </td>
            <td><small class="text-muted">${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}</small></td>
            <td class="text-center">
                <button class="btn btn-sm btn-outline-primary me-1" onclick="editStudent(${u.id})" title="Edit">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteStudent(${u.id}, '${escapeHtml(u.name || '')}')" title="Delete">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function filterStudentList() {
    const q = (document.getElementById('studentSearchInput').value || '').toLowerCase();
    if (!q) { renderStudentTable(allStudentsData); return; }
    const filtered = allStudentsData.filter(u =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.studentId || u.id?.toString() || '').toLowerCase().includes(q)
    );
    renderStudentTable(filtered);
}

function showAddStudentModal() {
    document.getElementById('studentEditId').value = '';
    document.getElementById('studentModalTitle').innerHTML = '<i class="fas fa-user-plus me-2"></i>Add Student';
    document.getElementById('studentNameInput').value = '';
    document.getElementById('studentEmailInput').value = '';
    document.getElementById('studentIdInput').value = '';
    document.getElementById('studentPasswordInput').value = '';
    document.getElementById('studentRoleInput').value = 'data-entry';
    document.getElementById('studentModalError').classList.add('d-none');
    document.getElementById('studentPwdHint').textContent = 'Required for new students';
    document.getElementById('studentPasswordInput').required = true;
    document.getElementById('studentEmailInput').disabled = false;
    new bootstrap.Modal(document.getElementById('studentModal')).show();
}

function editStudent(id) {
    const user = allStudentsData.find(u => u.id === id);
    if (!user) return;
    document.getElementById('studentEditId').value = id;
    document.getElementById('studentModalTitle').innerHTML = '<i class="fas fa-user-edit me-2"></i>Edit Student';
    document.getElementById('studentNameInput').value = user.name || '';
    document.getElementById('studentEmailInput').value = user.email || '';
    document.getElementById('studentEmailInput').disabled = true;
    document.getElementById('studentIdInput').value = user.studentId || '';
    document.getElementById('studentPasswordInput').value = '';
    document.getElementById('studentRoleInput').value = user.role || (user.isAdmin ? 'super-admin' : 'data-entry');
    document.getElementById('studentModalError').classList.add('d-none');
    document.getElementById('studentPwdHint').textContent = 'Leave empty to keep current password';
    document.getElementById('studentPasswordInput').required = false;
    new bootstrap.Modal(document.getElementById('studentModal')).show();
}

function toggleStudentPwdVisibility() {
    const inp = document.getElementById('studentPasswordInput');
    const ico = document.getElementById('studentPwdEyeIcon');
    if (inp.type === 'password') {
        inp.type = 'text';
        ico.className = 'fas fa-eye-slash';
    } else {
        inp.type = 'password';
        ico.className = 'fas fa-eye';
    }
}

async function saveStudent() {
    const editId = document.getElementById('studentEditId').value;
    const name = document.getElementById('studentNameInput').value.trim();
    const email = document.getElementById('studentEmailInput').value.trim();
    const studentId = document.getElementById('studentIdInput').value.trim();
    const password = document.getElementById('studentPasswordInput').value;
    const role = document.getElementById('studentRoleInput').value;
    const errEl = document.getElementById('studentModalError');

    errEl.classList.add('d-none');

    if (!name || !email) {
        errEl.textContent = 'Name and email are required';
        errEl.classList.remove('d-none');
        return;
    }

    if (!editId && (!password || password.length < 6)) {
        errEl.textContent = 'Password must be at least 6 characters';
        errEl.classList.remove('d-none');
        return;
    }

    const saveBtn = document.getElementById('studentSaveBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';

    try {
        let res;
        if (editId) {
            // Update existing
            const body = { role };
            if (password) body.password = password;
            // Also update name and studentId
            body.name = name;
            body.studentId = studentId;
            res = await fetch(`/admin/users/${editId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } else {
            // Create new
            res = await fetch('/admin/students', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, studentId, password, role })
            });
        }

        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        bootstrap.Modal.getInstance(document.getElementById('studentModal')).hide();
        loadStudentsList();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('d-none');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save';
    }
}

async function deleteStudent(id, name) {
    if (!confirm(`Delete student "${name}"? This cannot be undone.`)) return;
    try {
        const res = await fetch(`/admin/users/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        loadStudentsList();
    } catch (err) {
        alert('Failed to delete: ' + err.message);
    }
}

// ==========================================
document.getElementById('newAssessmentBtn')?.addEventListener('click', () => {
    resetAssessmentForm();
    document.getElementById('assessmentFormTitle').textContent = 'New Assessment';
    document.getElementById('assessmentFormCard').style.display = 'block';
    document.getElementById('assessmentName').focus();
});

document.getElementById('cancelAssessmentBtn')?.addEventListener('click', () => {
    document.getElementById('assessmentFormCard').style.display = 'none';
    resetAssessmentForm();
});

function resetAssessmentForm() {
    document.getElementById('assessmentEditId').value = '';
    document.getElementById('assessmentName').value = '';
    document.getElementById('assessmentDesc').value = '';
    document.getElementById('assessmentDeadline').value = '';
    document.getElementById('assessmentFullMarks').value = '';
    selectedVideos = [];
    renderAttachedVideos();
}

function renderAttachedVideos() {
    const container = document.getElementById('attachedVideosPreview');
    if (selectedVideos.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = selectedVideos.map((v, i) => `
        <div class="attached-video-block">
            <div class="attached-video-chip">
                <span class="video-chip-number">${i + 1}</span>
                <i class="fas fa-film"></i>
                ${escapeHtml(v.filename || v.publicId)}
                <span class="remove-video" onclick="removeAttachedVideo(${i})" title="Remove"><i class="fas fa-times-circle"></i></span>
            </div>
            <input type="text" class="form-control form-control-sm mt-1 video-question-input" 
                   placeholder="Question for this video (optional)" 
                   value="${escapeHtml(v.question || '')}" 
                   onchange="updateVideoQuestion(${i}, this.value)">
            <textarea class="form-control form-control-sm mt-1 video-correct-answer-input" 
                      placeholder="Correct answer / key points for AI grading (optional)" 
                      rows="2"
                      onchange="updateVideoCorrectAnswer(${i}, this.value)">${escapeHtml(v.correctAnswer || '')}</textarea>
        </div>
    `).join('');
}

function updateVideoQuestion(index, question) {
    if (selectedVideos[index]) {
        selectedVideos[index].question = question;
    }
}

function updateVideoCorrectAnswer(index, correctAnswer) {
    if (selectedVideos[index]) {
        selectedVideos[index].correctAnswer = correctAnswer;
    }
}

function removeAttachedVideo(index) {
    selectedVideos.splice(index, 1);
    renderAttachedVideos();
}

// Save Assessment
document.getElementById('saveAssessmentBtn')?.addEventListener('click', async () => {
    const editId = document.getElementById('assessmentEditId').value;
    const name = document.getElementById('assessmentName').value.trim();
    const description = document.getElementById('assessmentDesc').value.trim();

    if (!name) {
        alert('Assessment name is required.');
        document.getElementById('assessmentName').focus();
        return;
    }

    const deadline = document.getElementById('assessmentDeadline').value || null;
    const fullMarks = parseInt(document.getElementById('assessmentFullMarks').value) || null;

    const body = {
        name,
        description,
        deadline,
        fullMarks,
        videos: selectedVideos.length > 0 ? selectedVideos : [],
        // Keep backward compat fields for first video
        videoPublicId: selectedVideos[0]?.publicId || null,
        videoUrl: selectedVideos[0]?.url || null,
        videoThumbUrl: selectedVideos[0]?.thumbUrl || null,
        videoFilename: selectedVideos[0]?.filename || null
    };

    const btn = document.getElementById('saveAssessmentBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Saving...';

    try {
        const url = editId ? `/api/assessments/${editId}` : '/api/assessments';
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Save failed');

        document.getElementById('assessmentFormCard').style.display = 'none';
        resetAssessmentForm();
        loadAssessments(true);
    } catch (err) {
        alert('Error saving assessment: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save me-1"></i> Save';
    }
});

// Edit
async function editAssessment(id) {
    try {
        const res = await fetch('/api/assessments');
        const data = await res.json();
        if (!data.success) throw new Error('Failed to load');
        const a = data.assessments.find(x => x.id === id);
        if (!a) throw new Error('Not found');

        document.getElementById('assessmentEditId').value = a.id;
        document.getElementById('assessmentName').value = a.name;
        document.getElementById('assessmentDesc').value = a.description || '';
        document.getElementById('assessmentDeadline').value = a.deadline || '';
        document.getElementById('assessmentFullMarks').value = a.fullMarks || '';
        document.getElementById('assessmentFormTitle').textContent = 'Edit Assessment';

        // Load videos array (support old single-video format)
        if (a.videos && a.videos.length > 0) {
            selectedVideos = [...a.videos];
        } else if (a.videoPublicId) {
            selectedVideos = [{ publicId: a.videoPublicId, url: a.videoUrl, thumbUrl: a.videoThumbUrl, filename: a.videoFilename }];
        } else {
            selectedVideos = [];
        }
        renderAttachedVideos();

        document.getElementById('assessmentFormCard').style.display = 'block';
        document.getElementById('assessmentName').focus();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Delete
async function deleteAssessment(id) {
    if (!confirm('Delete this assessment?')) return;
    try {
        const res = await fetch(`/api/assessments/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Delete failed');
        loadAssessments(true);
    } catch (err) {
        alert('Error deleting: ' + err.message);
    }
}

// ==========================================
// Video Picker for Assessments
// ==========================================
document.getElementById('pickVideoBtn')?.addEventListener('click', async () => {
    const modal = document.getElementById('videoPickerModal');
    const grid = document.getElementById('videoPickerGrid');
    const loading = document.getElementById('videoPickerLoading');

    modal.style.display = 'flex';
    grid.innerHTML = '';
    loading.style.display = 'block';

    try {
        const res = await fetch('/api/avatar/videos');
        const data = await res.json();
        loading.style.display = 'none';

        if (!data.success || !data.videos || data.videos.length === 0) {
            grid.innerHTML = '<p class="text-center text-muted p-4">No videos found in the library.</p>';
            return;
        }

        grid.innerHTML = data.videos.map(v => {
            const name = v.filename || v.publicId.split('/').pop();
            const isSelected = selectedVideos.some(sv => sv.publicId === v.publicId) ? ' selected' : '';
            return `
                <div class="video-picker-item${isSelected}" data-public-id="${v.publicId}"
                     data-url="${v.url}" data-thumb="${v.thumbUrl || ''}"
                     data-filename="${escapeHtml(name)}">
                    <div class="picker-thumb">
                        ${v.thumbUrl ? `<img src="${v.thumbUrl}" alt="${escapeHtml(name)}">` : '<i class="fas fa-video fa-2x text-white"></i>'}
                    </div>
                    <div class="picker-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                </div>
            `;
        }).join('');

        // Click handler on each item — adds to the list (no duplicates)
        grid.querySelectorAll('.video-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                const newVid = {
                    publicId: item.dataset.publicId,
                    url: item.dataset.url,
                    thumbUrl: item.dataset.thumb,
                    filename: item.dataset.filename
                };
                // Don't add duplicate
                if (!selectedVideos.some(v => v.publicId === newVid.publicId)) {
                    selectedVideos.push(newVid);
                }
                renderAttachedVideos();
                modal.style.display = 'none';
            });
        });
    } catch (err) {
        loading.style.display = 'none';
        grid.innerHTML = `<p class="text-center text-danger p-4">Failed to load videos: ${err.message}</p>`;
    }
});

document.getElementById('closeVideoPickerBtn')?.addEventListener('click', () => {
    document.getElementById('videoPickerModal').style.display = 'none';
});

document.getElementById('videoPickerModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('videoPickerModal')) {
        document.getElementById('videoPickerModal').style.display = 'none';
    }
});

// ==========================================
// Answer Assessment (Chat + Voice Recorder)
// ==========================================
let currentAnswerAssessment = null;
let currentVideoIndex = 0;   // which video the user is currently on
let assessmentVideos = [];    // videos array for current assessment
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimerInterval = null;

// Thai Speech-to-Text
let speechRecognition = null;
let finalTranscript = '';
let interimTranscript = '';

async function loadAnswerAssessments() {
    const list = document.getElementById('answerAssessmentList');
    const loading = document.getElementById('answerAssessmentLoading');
    const empty = document.getElementById('answerAssessmentEmpty');

    list.innerHTML = '';
    loading.style.display = 'block';
    empty.style.display = 'none';

    // Show picker, hide chat
    document.getElementById('answerAssessmentPicker').style.display = 'block';
    document.getElementById('answerChatArea').style.display = 'none';

    try {
        const res = await fetch('/api/assessments');
        const data = await res.json();
        loading.style.display = 'none';

        if (!data.success || !data.assessments || data.assessments.length === 0) {
            empty.style.display = 'block';
            return;
        }

        // Render list immediately with loading status badges
        list.innerHTML = data.assessments.map(a => {
            const videoCount = (a.videos && a.videos.length) || (a.videoPublicId ? 1 : 0);
            const videoIndicator = videoCount > 0
                ? `<span class="badge bg-primary-subtle text-primary ms-2"><i class="fas fa-video me-1"></i>${videoCount} video${videoCount > 1 ? 's' : ''}</span>`
                : '';
            const isExpired = a.deadline && new Date(a.deadline) < new Date();
            const deadlineHtml = a.deadline
                ? (() => {
                    const dl = new Date(a.deadline);
                    const dlStr = dl.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    return isExpired
                        ? `<div class="small text-danger mt-1 answer-deadline-text"><i class="fas fa-lock me-1"></i>Closed ${dlStr}</div>`
                        : `<div class="small text-warning mt-1 answer-deadline-text"><i class="fas fa-clock me-1"></i>Due ${dlStr}</div>`;
                  })()
                : '';
            return `
                <div class="answer-assessment-card${isExpired ? ' expired' : ''}" onclick="openAnswerChat('${a.id}')">
                    <div class="d-flex align-items-center">
                        <div class="answer-assessment-icon${isExpired ? ' expired' : ''}" id="answer-icon-${a.id}">
                            <i class="fas ${isExpired ? 'fa-lock' : 'fa-clipboard-check'}"></i>
                        </div>
                        <div class="flex-grow-1">
                            <div class="fw-bold">${escapeHtml(a.name)}${videoIndicator}<span id="answer-status-${a.id}" class="ms-2">${isExpired ? '<span class="badge bg-danger-subtle text-danger"><i class="fas fa-lock me-1"></i>Closed</span>' : '<span class="spinner-border spinner-border-sm text-muted" style="width:14px;height:14px;border-width:2px;" role="status"></span>'}</span></div>
                            ${a.description ? `<div class="text-muted small">${escapeHtml(a.description).substring(0, 80)}${a.description.length > 80 ? '...' : ''}</div>` : ''}
                            ${deadlineHtml}
                        </div>
                        <i class="fas fa-chevron-right text-muted"></i>
                    </div>
                </div>
            `;
        }).join('');

        // Fetch answered status asynchronously and update badges
        try {
            const statusRes = await fetch('/api/assessment-recordings/status/all');
            const statusData = await statusRes.json();
            const answeredMap = statusData.success ? (statusData.answered || {}) : {};
            const videoProgressMap = statusData.videoProgress || {};
            const totalVideosMap = statusData.totalVideos || {};

            data.assessments.forEach(a => {
                const count = answeredMap[a.id] || 0;
                const progress = videoProgressMap[a.id] || 0;
                const total = totalVideosMap[a.id] || 0;
                const allDone = total <= 1 ? count > 0 : (progress >= total && count > 0);
                const badgeEl = document.getElementById(`answer-status-${a.id}`);
                const iconEl = document.getElementById(`answer-icon-${a.id}`);
                if (badgeEl) {
                    if (allDone) {
                        badgeEl.innerHTML = `<span class="badge bg-success-subtle text-success"><i class="fas fa-check-circle me-1"></i>Completed (${count})</span>`;
                    } else if (count > 0) {
                        const progressText = total > 1 ? ` ${progress}/${total}` : '';
                        badgeEl.innerHTML = `<span class="badge bg-warning-subtle text-warning"><i class="fas fa-clock me-1"></i>In progress${progressText}</span>`;
                    } else {
                        badgeEl.innerHTML = `<span class="badge bg-warning-subtle text-warning"><i class="fas fa-clock me-1"></i>Not answered</span>`;
                    }
                }
                if (iconEl && allDone) {
                    iconEl.classList.add('answered');
                    iconEl.classList.remove('expired');
                }
                // Remove expired styling from card if completed, add completed class
                if (allDone) {
                    const cardEl = document.querySelector(`.answer-assessment-card [id="answer-icon-${a.id}"]`)?.closest('.answer-assessment-card');
                    if (cardEl) {
                        cardEl.classList.remove('expired');
                        cardEl.classList.add('completed');
                        // Hide deadline text
                        const deadlineEl = cardEl.querySelector('.answer-deadline-text');
                        if (deadlineEl) deadlineEl.style.display = 'none';
                    }
                }
            });
        } catch (e) {
            // If status check fails, just remove the spinners
            document.querySelectorAll('[id^="answer-status-"]').forEach(el => { el.innerHTML = ''; });
            console.error('Failed to load answered status:', e);
        }
    } catch (err) {
        loading.style.display = 'none';
        list.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-1"></i>${err.message}</div>`;
    }
}

async function openAnswerChat(assessmentId) {
    try {
        const res = await fetch('/api/assessments');
        const data = await res.json();
        if (!data.success) throw new Error('Failed to load assessments');
        const a = data.assessments.find(x => x.id === assessmentId);
        if (!a) throw new Error('Assessment not found');

        // Check deadline
        const isExpired = a.deadline && new Date(a.deadline) < new Date();

        currentAnswerAssessment = a;

        // Build videos array (support old single-video format)
        assessmentVideos = a.videos && a.videos.length > 0
            ? a.videos
            : (a.videoUrl ? [{ publicId: a.videoPublicId, url: a.videoUrl, thumbUrl: a.videoThumbUrl, filename: a.videoFilename }] : []);
        currentVideoIndex = 0;

        // Switch views
        document.getElementById('answerAssessmentPicker').style.display = 'none';
        document.getElementById('answerChatArea').style.display = 'flex';

        // Fill header
        document.getElementById('chatAssessmentName').textContent = a.name;
        document.getElementById('chatAssessmentDesc').textContent = a.description || '';

        // Build chat messages
        const chatDiv = document.getElementById('chatMessages');

        // Assessment info message
        chatDiv.innerHTML = `
            <div class="chat-bubble chat-bubble-system">
                <div class="fw-bold mb-1"><i class="fas fa-clipboard-check me-1"></i>${escapeHtml(a.name)}</div>
                ${a.description ? `<div class="small">${escapeHtml(a.description)}</div>` : ''}
                ${assessmentVideos.length > 1 ? `<div class="small text-primary mt-1"><i class="fas fa-film me-1"></i>${assessmentVideos.length} videos in this assessment</div>` : ''}
                ${isExpired ? `<div class="small text-danger mt-1"><i class="fas fa-lock me-1"></i>This assessment is closed (deadline passed)</div>` : ''}
            </div>
        `;

        // Load existing messages (voice, text, video_shown, video_progress)
        const existingMessages = await fetchExistingMessages(a.id);

        // Render all messages in chronological order
        const videosShownSet = new Set();
        let highestVideoShown = -1;

        if (existingMessages.length > 0) {
            // Sort by timestamp
            existingMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

            existingMessages.forEach(msg => {
                if (msg.type === 'video_progress') return; // skip internal markers

                if (msg.type === 'video_shown') {
                    const vi = msg.videoIndex;
                    if (!videosShownSet.has(vi) && vi < assessmentVideos.length) {
                        videosShownSet.add(vi);
                        if (vi > highestVideoShown) highestVideoShown = vi;
                        renderVideoBubbleInline(chatDiv, vi);
                    }
                    return;
                }

                const date = new Date(msg.created || msg.timestamp).toLocaleString();
                if (msg.type === 'text') {
                    chatDiv.innerHTML += `
                        <div class="chat-bubble chat-bubble-user">
                            <div class="small text-muted mb-2"><i class="fas fa-comment me-1"></i>You &middot; ${date}</div>
                            <div>${escapeHtml(msg.text)}</div>
                        </div>
                    `;
                } else if (msg.type === 'voice') {
                    chatDiv.innerHTML += `
                        <div class="chat-bubble chat-bubble-user">
                            <div class="small text-muted mb-2"><i class="fas fa-microphone me-1"></i>Your Recording &middot; ${date}</div>
                            <audio controls preload="metadata" class="chat-audio">
                                <source src="${msg.url}" type="audio/webm">
                                <source src="${msg.url}" type="audio/mp4">
                            </audio>
                            ${msg.transcript ? `<div class="chat-transcript"><i class="fas fa-language me-1 text-muted"></i>${escapeHtml(msg.transcript)}</div>` : ''}
                        </div>
                    `;
                }
            });
        }

        // Handle videos
        if (assessmentVideos.length > 0) {
            // If no video_shown markers exist (legacy data), show videos based on progress
            if (videosShownSet.size === 0) {
                const progressMsg = existingMessages.find(m => m.type === 'video_progress');
                const savedVideoCount = progressMsg ? progressMsg.videoCount : 0;
                const showUpTo = Math.min(savedVideoCount, assessmentVideos.length);

                if (showUpTo === 0) {
                    // First time — show first video
                    appendVideoBubble(0);
                    currentVideoIndex = 0;
                    saveVideoProgress(a.id, 1);
                } else {
                    for (let i = 0; i < showUpTo; i++) {
                        appendVideoBubble(i);
                    }
                    currentVideoIndex = showUpTo - 1;
                }
            } else {
                // Videos already rendered chronologically above
                currentVideoIndex = highestVideoShown;

                // If not all videos shown yet, check if we need to show the next one
                // (this happens if user hasn't progressed yet)
            }

            hasAnsweredCurrentVideo = false;

            // Check if user already answered the current (last) video
            // by looking for any user message after the last video_shown marker
            if (existingMessages.length > 0) {
                const lastVideoShownIdx = existingMessages.map((m, i) => m.type === 'video_shown' ? i : -1).filter(i => i >= 0);
                const lastVSI = lastVideoShownIdx.length > 0 ? lastVideoShownIdx[lastVideoShownIdx.length - 1] : -1;
                const hasUserMsgAfterLastVideo = existingMessages.slice(lastVSI + 1).some(m => m.type === 'text' || m.type === 'voice');
                if (hasUserMsgAfterLastVideo) {
                    hasAnsweredCurrentVideo = true;
                    updateNextVideoButton();
                }
            }
        } else {
            // No videos, just show instruction
            chatDiv.innerHTML += `
                <div class="chat-bubble chat-bubble-system">
                    <i class="fas fa-info-circle me-1 text-primary"></i>
                    Use the text input or voice recorder below to answer this assessment.
                </div>
            `;
            // Check if already answered (no-video assessments)
            const hasAnyAnswer = existingMessages.some(m => m.type === 'text' || m.type === 'voice');
            if (hasAnyAnswer) {
                hasAnsweredCurrentVideo = true;
                updateNextVideoButton();
            }
        }

        // Scroll to bottom
        chatDiv.scrollTop = chatDiv.scrollHeight;

        // Hide/show input bars based on deadline
        const textBar = document.querySelector('.answer-text-bar');
        const recorderBar = document.querySelector('.answer-recorder-bar');
        if (isExpired) {
            if (textBar) textBar.style.display = 'none';
            if (recorderBar) recorderBar.style.display = 'none';
        } else {
            if (textBar) textBar.style.display = '';
            if (recorderBar) recorderBar.style.display = '';
        }

    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function appendVideoBubble(videoIdx) {
    const chatDiv = document.getElementById('chatMessages');
    const v = assessmentVideos[videoIdx];
    if (!v) return;
    const label = assessmentVideos.length > 1 ? `Video ${videoIdx + 1} of ${assessmentVideos.length}` : 'Assessment Video';
    const filename = v.filename ? ` — ${escapeHtml(v.filename)}` : '';
    const questionHtml = v.question
        ? `<div class="chat-video-question mt-2"><i class="fas fa-question-circle me-1 text-primary"></i><strong>Question:</strong> ${escapeHtml(v.question)}</div>`
        : '';
    chatDiv.innerHTML += `
        <div class="chat-bubble chat-bubble-system" data-video-index="${videoIdx}">
            <div class="small text-muted mb-2"><i class="fas fa-video me-1"></i>${label}${filename}</div>
            <div class="chat-video-container">
                <video controls preload="metadata" class="chat-video">
                    <source src="${v.url}" type="video/mp4">
                </video>
            </div>
            ${questionHtml}
            <div class="small text-muted mt-2">
                <i class="fas fa-info-circle me-1 text-primary"></i>
                Watch the video, then record or type your answer below.
            </div>
        </div>
    `;

    // Save video_shown marker to Redis (non-blocking)
    if (currentAnswerAssessment) {
        saveVideoShown(currentAnswerAssessment.id, videoIdx);
    }
}

async function saveVideoShown(assessmentId, videoIndex) {
    try {
        await fetch('/api/assessment-messages/text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assessmentId,
                text: String(videoIndex),
                type: 'video_shown'
            })
        });
    } catch (_) { /* non-critical */ }
}

function updateNextVideoButton() {
    // Remove existing next-video button / done button if any
    document.getElementById('nextVideoBtn')?.remove();
    document.getElementById('doneAssessmentBtn')?.remove();

    // Only show if user has answered the current video
    if (!hasAnsweredCurrentVideo) return;

    // Don't show buttons if assessment is expired
    const isExpiredNow = currentAnswerAssessment && currentAnswerAssessment.deadline && new Date(currentAnswerAssessment.deadline) < new Date();
    if (isExpiredNow) return;

    const chatDiv = document.getElementById('chatMessages');

    if (assessmentVideos.length > 1 && currentVideoIndex < assessmentVideos.length - 1) {
        // More videos remaining — show Next Video button
        const nextIdx = currentVideoIndex + 1;
        chatDiv.innerHTML += `
            <div class="chat-bubble chat-bubble-system text-center" id="nextVideoBtn">
                <button class="btn btn-primary btn-sm rounded-pill px-4" onclick="showNextVideo()">
                    <i class="fas fa-forward me-1"></i> Next Video (${nextIdx + 1} of ${assessmentVideos.length})
                </button>
            </div>
        `;
    } else {
        // All videos answered (or single video answered) — show Done button
        const completedLabel = assessmentVideos.length > 1
            ? `All ${assessmentVideos.length} videos answered`
            : 'Assessment answered';
        chatDiv.innerHTML += `
            <div class="chat-bubble chat-bubble-system text-center" id="doneAssessmentBtn">
                <div class="mb-2"><i class="fas fa-check-circle me-1 text-success"></i><span class="fw-semibold">${completedLabel}</span></div>
                <div class="small text-muted mb-2">You can still type or record more answers above.</div>
                <button class="btn btn-success btn-sm rounded-pill px-4" onclick="markAssessmentDone()">
                    <i class="fas fa-check me-1"></i> Done
                </button>
            </div>
        `;
    }
    chatDiv.scrollTop = chatDiv.scrollHeight;
}

async function showNextVideo() {
    if (currentVideoIndex >= assessmentVideos.length - 1) return;

    // Remove the "Next Video" button
    document.getElementById('nextVideoBtn')?.remove();

    currentVideoIndex++;

    // Save progress
    await saveVideoProgress(currentAnswerAssessment.id, currentVideoIndex + 1);

    // Show the next video bubble
    appendVideoBubble(currentVideoIndex);

    // Reset answered flag for the new video
    hasAnsweredCurrentVideo = false;

    // Scroll to bottom
    const chatDiv = document.getElementById('chatMessages');
    chatDiv.scrollTop = chatDiv.scrollHeight;
}

function markAssessmentDone() {
    // Go back to the assessment list
    currentAnswerAssessment = null;
    currentVideoIndex = 0;
    assessmentVideos = [];
    hasAnsweredCurrentVideo = false;
    // Exit fullscreen if active
    document.getElementById('answerChatArea')?.classList.remove('chat-fullscreen');
    const fsBtn = document.getElementById('chatFullscreenBtn');
    if (fsBtn) fsBtn.innerHTML = '<i class="fas fa-expand"></i>';
    stopRecording(true);
    document.getElementById('answerAssessmentPicker').style.display = 'block';
    document.getElementById('answerChatArea').style.display = 'none';
    loadAnswerAssessments();
}

async function getSavedVideoProgress(assessmentId) {
    try {
        const res = await fetch(`/api/assessment-recordings/${assessmentId}`);
        const data = await res.json();
        if (!data.success) return 0;
        // videoProgress is stored in the message list as a special marker
        const progress = (data.messages || []).find(m => m.type === 'video_progress');
        return progress ? progress.videoCount : 0;
    } catch (_) {
        return 0;
    }
}

async function saveVideoProgress(assessmentId, videoCount) {
    try {
        await fetch('/api/assessment-messages/text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assessmentId,
                text: `__video_progress__${videoCount}`,
                type: 'video_progress'
            })
        });
    } catch (_) { /* non-critical */ }
}

// Render a video bubble inline (used during chronological rebuild)
function renderVideoBubbleInline(chatDiv, videoIdx) {
    const v = assessmentVideos[videoIdx];
    if (!v) return;
    const label = assessmentVideos.length > 1 ? `Video ${videoIdx + 1} of ${assessmentVideos.length}` : 'Assessment Video';
    const filename = v.filename ? ` — ${escapeHtml(v.filename)}` : '';
    const questionHtml = v.question
        ? `<div class="chat-video-question mt-2"><i class="fas fa-question-circle me-1 text-primary"></i><strong>Question:</strong> ${escapeHtml(v.question)}</div>`
        : '';
    chatDiv.innerHTML += `
        <div class="chat-bubble chat-bubble-system" data-video-index="${videoIdx}">
            <div class="small text-muted mb-2"><i class="fas fa-video me-1"></i>${label}${filename}</div>
            <div class="chat-video-container">
                <video controls preload="metadata" class="chat-video">
                    <source src="${v.url}" type="video/mp4">
                </video>
            </div>
            ${questionHtml}
            <div class="small text-muted mt-2">
                <i class="fas fa-info-circle me-1 text-primary"></i>
                Watch the video, then record or type your answer below.
            </div>
        </div>
    `;
}

// Fetch messages from server without rendering (for chronological rebuild)
async function fetchExistingMessages(assessmentId) {
    try {
        const res = await fetch(`/api/assessment-recordings/${assessmentId}`);
        const data = await res.json();
        if (!data.success || !data.messages || data.messages.length === 0) return [];
        return data.messages;
    } catch (err) {
        console.error('Failed to load messages:', err);
        return [];
    }
}

// Back button
document.getElementById('backToAssessmentListBtn')?.addEventListener('click', () => {
    currentAnswerAssessment = null;
    currentVideoIndex = 0;
    assessmentVideos = [];
    hasAnsweredCurrentVideo = false;
    // Exit fullscreen if active
    document.getElementById('answerChatArea')?.classList.remove('chat-fullscreen');
    const fsBtn = document.getElementById('chatFullscreenBtn');
    if (fsBtn) fsBtn.innerHTML = '<i class="fas fa-expand"></i>';
    stopRecording(true);
    document.getElementById('answerAssessmentPicker').style.display = 'block';
    document.getElementById('answerChatArea').style.display = 'none';
    loadAnswerAssessments();
});

// Retest button
document.getElementById('retestBtn')?.addEventListener('click', async () => {
    if (!currentAnswerAssessment) return;
    const isExpired = currentAnswerAssessment.deadline && new Date(currentAnswerAssessment.deadline) < new Date();
    if (isExpired) {
        alert('Cannot retest — this assessment is closed (deadline passed).');
        return;
    }
    if (!confirm('Are you sure you want to retest? All your previous answers (text & voice) will be deleted.')) return;
    try {
        const res = await fetch(`/api/assessment-recordings/${currentAnswerAssessment.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to clear messages');
        // Re-open the same assessment from scratch
        openAnswerChat(currentAnswerAssessment.id);
    } catch (err) {
        alert('Retest failed: ' + err.message);
    }
});

// Fullscreen toggle
document.getElementById('chatFullscreenBtn')?.addEventListener('click', () => {
    const chatArea = document.getElementById('answerChatArea');
    const btn = document.getElementById('chatFullscreenBtn');
    chatArea.classList.toggle('chat-fullscreen');
    const isFs = chatArea.classList.contains('chat-fullscreen');
    btn.innerHTML = isFs ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
    btn.title = isFs ? 'Exit fullscreen' : 'Toggle fullscreen';
    // Scroll to bottom
    const chatDiv = document.getElementById('chatMessages');
    chatDiv.scrollTop = chatDiv.scrollHeight;
});

// ==========================================
// Text Message Sending
// ==========================================
document.getElementById('sendTextBtn')?.addEventListener('click', sendTextMessage);
document.getElementById('chatTextInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendTextMessage();
    }
});

async function sendTextMessage() {
    const input = document.getElementById('chatTextInput');
    const text = input.value.trim();
    if (!text || !currentAnswerAssessment) return;

    input.value = '';
    input.disabled = true;
    const sendBtn = document.getElementById('sendTextBtn');
    sendBtn.disabled = true;

    try {
        const res = await fetch('/api/assessment-messages/text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assessmentId: currentAnswerAssessment.id,
                text
            })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to send');

        // Remove action buttons before adding message so they stay at bottom
        document.getElementById('nextVideoBtn')?.remove();
        document.getElementById('doneAssessmentBtn')?.remove();

        // Add to chat
        const chatDiv = document.getElementById('chatMessages');
        const now = new Date().toLocaleString();
        chatDiv.innerHTML += `
            <div class="chat-bubble chat-bubble-user">
                <div class="small text-muted mb-2"><i class="fas fa-comment me-1"></i>You &middot; ${now}</div>
                <div>${escapeHtml(text)}</div>
            </div>
        `;

        // Mark as answered and re-add action buttons at bottom
        if (!hasAnsweredCurrentVideo) {
            hasAnsweredCurrentVideo = true;
        }
        updateNextVideoButton();
        chatDiv.scrollTop = chatDiv.scrollHeight;
    } catch (err) {
        alert('Failed to send message: ' + err.message);
        input.value = text; // Restore text on failure
    } finally {
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
    }
}

// ==========================================
// Voice Recorder
// ==========================================
document.getElementById('startRecordBtn')?.addEventListener('click', startRecording);
document.getElementById('stopRecordBtn')?.addEventListener('click', () => stopRecording(false));
document.getElementById('cancelRecordBtn')?.addEventListener('click', () => stopRecording(true));
document.getElementById('sendRecordBtn')?.addEventListener('click', uploadRecording);
document.getElementById('reRecordBtn')?.addEventListener('click', () => { discardPreview(); startRecording(); });
document.getElementById('discardRecordBtn')?.addEventListener('click', discardPreview);

let pendingRecordingBlob = null;
let pendingRecordingMime = null;

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];

        // Prefer webm, fall back to mp4
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';

        mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            // Stop all tracks
            stream.getTracks().forEach(t => t.stop());
        };

        mediaRecorder.start(250); // collect chunks every 250ms
        recordingStartTime = Date.now();
        updateRecordingTimer();
        recordingTimerInterval = setInterval(updateRecordingTimer, 1000);

        // Start Thai speech recognition
        startSpeechRecognition();

        // UI toggle
        document.getElementById('recorderIdle').style.display = 'none';
        document.getElementById('recorderActive').style.display = 'block';
        document.getElementById('transcriptContainer').style.display = 'block';
    } catch (err) {
        alert('Microphone access denied or not available: ' + err.message);
    }
}

function updateRecordingTimer() {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    document.getElementById('recordingTimer').textContent = `${mins}:${secs}`;
}

async function stopRecording(cancel = false) {
    clearInterval(recordingTimerInterval);

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        // Already stopped, just reset UI
        document.getElementById('recorderIdle').style.display = 'block';
        document.getElementById('recorderActive').style.display = 'none';
        return;
    }

    // Wait for the stop event to fire so we get all chunks
    await new Promise(resolve => {
        mediaRecorder.onstop = () => {
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
            resolve();
        };
        mediaRecorder.stop();
    });

    // Stop speech recognition
    stopSpeechRecognition();

    // Reset UI
    document.getElementById('recorderActive').style.display = 'none';

    if (cancel || audioChunks.length === 0) {
        document.getElementById('recorderIdle').style.display = 'block';
        document.getElementById('transcriptContainer').style.display = 'none';
        finalTranscript = '';
        interimTranscript = '';
        audioChunks = [];
        return;
    }

    // Build blob and show preview
    pendingRecordingMime = mediaRecorder.mimeType || 'audio/webm';
    pendingRecordingBlob = new Blob(audioChunks, { type: pendingRecordingMime });
    audioChunks = [];

    const previewAudio = document.getElementById('previewAudio');
    previewAudio.src = URL.createObjectURL(pendingRecordingBlob);
    document.getElementById('recorderPreview').style.display = 'block';

    // Show transcript in preview if we got any text
    const previewTranscript = document.getElementById('previewTranscript');
    if (finalTranscript.trim()) {
        previewTranscript.textContent = finalTranscript.trim();
        previewTranscript.style.display = 'block';
    } else {
        previewTranscript.style.display = 'none';
    }
}

function discardPreview() {
    const previewAudio = document.getElementById('previewAudio');
    if (previewAudio.src) {
        URL.revokeObjectURL(previewAudio.src);
        previewAudio.src = '';
    }
    pendingRecordingBlob = null;
    pendingRecordingMime = null;
    finalTranscript = '';
    interimTranscript = '';
    document.getElementById('recorderPreview').style.display = 'none';
    document.getElementById('previewTranscript').style.display = 'none';
    document.getElementById('transcriptContainer').style.display = 'none';
    document.getElementById('recorderIdle').style.display = 'block';
}

async function uploadRecording() {
    if (!pendingRecordingBlob) return;

    // Hide preview, show uploading
    document.getElementById('recorderPreview').style.display = 'none';
    document.getElementById('recorderUploading').style.display = 'block';

    try {
        const ext = pendingRecordingMime.includes('mp4') ? 'mp4' : 'webm';
        const formData = new FormData();
        formData.append('audio', pendingRecordingBlob, `recording.${ext}`);
        formData.append('assessmentId', currentAnswerAssessment.id);
        formData.append('assessmentName', currentAnswerAssessment.name);
        // Include transcript if available
        const savedTranscript = finalTranscript.trim();
        if (savedTranscript) {
            formData.append('transcript', savedTranscript);
        }

        const res = await fetch('/api/assessment-recordings/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (!data.success) throw new Error(data.error || 'Upload failed');

        // Remove action buttons before adding message so they stay at bottom
        document.getElementById('nextVideoBtn')?.remove();
        document.getElementById('doneAssessmentBtn')?.remove();

        // Add to chat
        const chatDiv = document.getElementById('chatMessages');
        const now = new Date().toLocaleString();
        chatDiv.innerHTML += `
            <div class="chat-bubble chat-bubble-user">
                <div class="small text-muted mb-2"><i class="fas fa-microphone me-1"></i>Your Recording &middot; ${now}</div>
                <audio controls preload="metadata" class="chat-audio">
                    <source src="${data.url}" type="${pendingRecordingMime}">
                </audio>
                ${savedTranscript ? `<div class="chat-transcript"><i class="fas fa-language me-1 text-muted"></i>${escapeHtml(savedTranscript)}</div>` : ''}
            </div>
        `;

        // Mark as answered and re-add action buttons at bottom
        if (!hasAnsweredCurrentVideo) {
            hasAnsweredCurrentVideo = true;
        }
        updateNextVideoButton();
        chatDiv.scrollTop = chatDiv.scrollHeight;

    } catch (err) {
        alert('Failed to upload recording: ' + err.message);
    } finally {
        // Clean up
        const previewAudio = document.getElementById('previewAudio');
        if (previewAudio.src) URL.revokeObjectURL(previewAudio.src);
        previewAudio.src = '';
        pendingRecordingBlob = null;
        pendingRecordingMime = null;
        finalTranscript = '';
        interimTranscript = '';
        document.getElementById('recorderUploading').style.display = 'none';
        document.getElementById('recorderIdle').style.display = 'block';
        document.getElementById('transcriptContainer').style.display = 'none';
        document.getElementById('previewTranscript').style.display = 'none';
    }
}

// ==========================================
// Thai Speech Recognition (Web Speech API)
// ==========================================
function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('Speech Recognition API not supported in this browser');
        return;
    }

    finalTranscript = '';
    interimTranscript = '';

    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'th-TH';
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.maxAlternatives = 1;

    const transcriptEl = document.getElementById('transcriptText');

    speechRecognition.onresult = (event) => {
        interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }
        const display = finalTranscript + (interimTranscript ? `<span class="interim">${interimTranscript}</span>` : '');
        transcriptEl.innerHTML = display || '<span class="interim">Listening...</span>';
        transcriptEl.classList.toggle('empty', !display);
    };

    speechRecognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        // If it's a no-speech error, just keep going
        if (event.error === 'no-speech') return;
    };

    speechRecognition.onend = () => {
        // Restart if still recording (the API can stop on its own)
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try {
                speechRecognition.start();
            } catch (e) {
                console.warn('Could not restart speech recognition:', e);
            }
        }
    };

    try {
        speechRecognition.start();
    } catch (e) {
        console.warn('Failed to start speech recognition:', e);
    }
}

function stopSpeechRecognition() {
    if (speechRecognition) {
        try {
            speechRecognition.onend = null; // prevent auto-restart
            speechRecognition.stop();
        } catch (e) {
            // ignore
        }
        speechRecognition = null;
    }
}

// ==========================================
// Voice Live - Azure Speech AI Conversation
// ==========================================
let voiceLiveState = {
    isListening: false,
    topic: '',
    messages: [],       // conversation history for AI
    recognizer: null,
    synthesizer: null,
    speechToken: null,
    speechRegion: null,
    isSpeaking: false,
    voiceGender: 'boy', // 'boy' or 'girl'
    // Avatar state
    avatarMode: false,
    avatarSynthesizer: null,
    avatarConnected: false,
    peerConnection: null,
    // Fullscreen state
    micMuted: false,
    speakerMuted: false
};

function setVoiceGender(gender) {
    voiceLiveState.voiceGender = gender;
    document.getElementById('voiceGenderBoy').classList.toggle('active', gender === 'boy');
    document.getElementById('voiceGenderGirl').classList.toggle('active', gender === 'girl');
}

function getSelectedVoiceName() {
    return voiceLiveState.voiceGender === 'girl' ? 'th-TH-PremwadeeNeural' : 'th-TH-NiwatNeural';
}

async function getAzureSpeechToken() {
    try {
        const res = await fetch('/api/speech-token');
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        voiceLiveState.speechToken = data.token;
        voiceLiveState.speechRegion = data.region;
        return true;
    } catch (err) {
        console.error('Failed to get speech token:', err);
        document.getElementById('voiceStatus').textContent = 'Error: Could not connect to Azure Speech Service';
        return false;
    }
}

function setVoiceTopic() {
    const input = document.getElementById('voiceTopic');
    const topic = input.value.trim();
    if (!topic) return;
    voiceLiveState.topic = topic;
    document.getElementById('voiceTopicBanner').style.display = 'flex';
    document.getElementById('voiceTopicText').textContent = topic;
    input.value = '';
    // Reset conversation when topic changes
    voiceLiveState.messages = [];
}

function clearVoiceTopic() {
    voiceLiveState.topic = '';
    document.getElementById('voiceTopicBanner').style.display = 'none';
    document.getElementById('voiceTopicText').textContent = '';
}

function clearVoiceConversation() {
    if (voiceLiveState.isListening) {
        toggleVoiceLive();
    }
    stopAISpeaking();
    voiceLiveState.messages = [];
    const conv = document.getElementById('voiceConversation');
    conv.innerHTML = `
        <div class="voice-empty-state" id="voiceEmptyState">
            <i class="fas fa-microphone-alt fa-3x text-muted mb-3"></i>
            <h5 class="text-muted">Ready to Talk</h5>
            <p class="text-muted small">Press the microphone button below to start speaking.<br>The AI will respond with voice.</p>
        </div>
    `;
    document.getElementById('voiceStatus').textContent = 'Click the microphone to start';
}

function addVoiceBubble(role, text) {
    const emptyState = document.getElementById('voiceEmptyState');
    if (emptyState) emptyState.remove();

    const conv = document.getElementById('voiceConversation');
    const bubble = document.createElement('div');
    bubble.className = `voice-bubble voice-bubble-${role}`;

    const icon = role === 'user' ? 'fa-user' : 'fa-robot';
    const label = role === 'user' ? 'You' : 'AI';

    bubble.innerHTML = `
        <div class="voice-bubble-header">
            <i class="fas ${icon} me-1"></i> ${label}
        </div>
        <div class="voice-bubble-text">${text}</div>
    `;
    conv.appendChild(bubble);
    conv.scrollTop = conv.scrollHeight;
    return bubble;
}

async function toggleVoiceLive() {
    if (voiceLiveState.isListening) {
        // Stop listening
        stopVoiceListening();
        return;
    }

    // Start listening
    const btn = document.getElementById('voiceMicBtn');
    const icon = document.getElementById('voiceMicIcon');
    const status = document.getElementById('voiceStatus');

    status.textContent = 'Connecting to Azure Speech...';

    // Get token
    const gotToken = await getAzureSpeechToken();
    if (!gotToken) return;

    try {
        const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
            voiceLiveState.speechToken,
            voiceLiveState.speechRegion
        );
        speechConfig.speechRecognitionLanguage = 'th-TH';

        const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
        voiceLiveState.recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

        // Set up continuous recognition
        voiceLiveState.recognizer.recognizing = (s, e) => {
            if (e.result.reason === SpeechSDK.ResultReason.RecognizingSpeech) {
                status.textContent = `Hearing: ${e.result.text}`;
                // Show live transcript in fullscreen
                if (voiceLiveState.avatarConnected) {
                    const fsTrans = document.getElementById('avatarFsTranscript');
                    const fsTransText = document.getElementById('avatarFsTranscriptText');
                    if (fsTrans && fsTransText) {
                        fsTransText.textContent = e.result.text;
                        fsTrans.style.display = 'block';
                    }
                }
            }
        };

        voiceLiveState.recognizer.recognized = async (s, e) => {
            if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text.trim()) {
                const userText = e.result.text.trim();
                status.textContent = 'Waiting...';

                // Debounce: wait 2 seconds before processing to let user finish
                if (voiceLiveState._recognizedTimer) clearTimeout(voiceLiveState._recognizedTimer);

                // Accumulate recognized text segments
                if (!voiceLiveState._pendingText) voiceLiveState._pendingText = '';
                voiceLiveState._pendingText += (voiceLiveState._pendingText ? ' ' : '') + userText;

                voiceLiveState._recognizedTimer = setTimeout(async () => {
                    const fullText = voiceLiveState._pendingText;
                    voiceLiveState._pendingText = '';
                    if (!fullText) return;

                    status.textContent = 'Processing...';

                    // If AI is currently speaking, interrupt it
                    if (voiceLiveState.isSpeaking) {
                        stopAISpeaking();
                    }

                    // Hide live transcript in fullscreen
                    if (voiceLiveState.avatarConnected) {
                        const fsTrans = document.getElementById('avatarFsTranscript');
                        if (fsTrans) fsTrans.style.display = 'none';
                    }

                    // Add user bubble
                    addVoiceBubble('user', fullText);
                    voiceLiveState.messages.push({ role: 'user', content: fullText });

                    // Get AI response
                    await getAIResponseAndSpeak(fullText);

                    // Hide subtitles after a delay
                    if (voiceLiveState.avatarConnected) {
                        setTimeout(() => {
                            const fsSubs = document.getElementById('avatarFsSubtitles');
                            if (fsSubs) fsSubs.style.display = 'none';
                        }, 2000);
                    }

                    if (voiceLiveState.isListening) {
                        status.textContent = 'Listening... speak now';
                    }
                },1500); // 1.5-second delay before AI responds
            }
        };

        voiceLiveState.recognizer.canceled = (s, e) => {
            console.warn('Speech recognition canceled:', e.errorDetails);
            if (e.reason === SpeechSDK.CancellationReason.Error) {
                status.textContent = 'Error: ' + (e.errorDetails || 'Speech recognition failed');
                stopVoiceListening();
            }
        };

        voiceLiveState.recognizer.sessionStopped = () => {
            console.log('Speech session stopped');
        };

        // Start continuous recognition
        voiceLiveState.recognizer.startContinuousRecognitionAsync(
            () => {
                voiceLiveState.isListening = true;
                btn.classList.add('voice-btn-mic-active');
                icon.className = 'fas fa-stop';
                status.textContent = 'Listening... speak now';
            },
            (err) => {
                console.error('Failed to start recognition:', err);
                status.textContent = 'Failed to start microphone';
            }
        );
    } catch (err) {
        console.error('Voice Live error:', err);
        status.textContent = 'Error initializing speech service';
    }
}

function stopVoiceListening() {
    const btn = document.getElementById('voiceMicBtn');
    const icon = document.getElementById('voiceMicIcon');
    const status = document.getElementById('voiceStatus');

    voiceLiveState.isListening = false;
    btn.classList.remove('voice-btn-mic-active');
    icon.className = 'fas fa-microphone';
    status.textContent = 'Click the microphone to start';

    if (voiceLiveState.recognizer) {
        voiceLiveState.recognizer.stopContinuousRecognitionAsync(
            () => {
                voiceLiveState.recognizer.close();
                voiceLiveState.recognizer = null;
            },
            (err) => console.error('Error stopping recognition:', err)
        );
    }
}

async function getAIResponseAndSpeak(userText) {
    try {
        const res = await fetch('/api/voice-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: voiceLiveState.messages,
                topic: voiceLiveState.topic
            })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        const reply = data.reply;
        voiceLiveState.messages.push({ role: 'assistant', content: reply });
        addVoiceBubble('assistant', reply);

        // Speak the response
        await speakText(reply);
    } catch (err) {
        console.error('AI response error:', err);
        addVoiceBubble('assistant', '⚠️ Sorry, I could not process that. Please try again.');
    }
}

async function speakText(text) {
    // If avatar mode is on and connected, use avatar synthesizer
    if (voiceLiveState.avatarMode && voiceLiveState.avatarConnected && voiceLiveState.avatarSynthesizer) {
        return speakWithAvatar(text);
    }

    try {
        // Get fresh token for synthesis
        await getAzureSpeechToken();

        const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
            voiceLiveState.speechToken,
            voiceLiveState.speechRegion
        );
        speechConfig.speechSynthesisVoiceName = getSelectedVoiceName();

        const audioConfig = SpeechSDK.AudioConfig.fromDefaultSpeakerOutput();
        voiceLiveState.synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);

        voiceLiveState.isSpeaking = true;
        document.getElementById('voiceStopSpeakBtn').style.display = 'inline-flex';

        return new Promise((resolve) => {
            voiceLiveState.synthesizer.speakTextAsync(
                text,
                (result) => {
                    voiceLiveState.isSpeaking = false;
                    document.getElementById('voiceStopSpeakBtn').style.display = 'none';
                    if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                        // done
                    } else {
                        console.warn('Speech synthesis issue:', result.errorDetails);
                    }
                    voiceLiveState.synthesizer.close();
                    voiceLiveState.synthesizer = null;
                    resolve();
                },
                (err) => {
                    console.error('Speech synthesis error:', err);
                    voiceLiveState.isSpeaking = false;
                    document.getElementById('voiceStopSpeakBtn').style.display = 'none';
                    if (voiceLiveState.synthesizer) {
                        voiceLiveState.synthesizer.close();
                        voiceLiveState.synthesizer = null;
                    }
                    resolve();
                }
            );
        });
    } catch (err) {
        console.error('Speak error:', err);
        voiceLiveState.isSpeaking = false;
        document.getElementById('voiceStopSpeakBtn').style.display = 'none';
    }
}

async function speakWithAvatar(text) {
    try {
        voiceLiveState.isSpeaking = true;
        document.getElementById('voiceStopSpeakBtn').style.display = 'inline-flex';

        // Show subtitles in fullscreen
        if (voiceLiveState.avatarConnected) {
            const fsSubs = document.getElementById('avatarFsSubtitles');
            const fsSubText = document.getElementById('avatarFsSubtitleText');
            if (fsSubs && fsSubText) {
                fsSubText.textContent = text;
                fsSubs.style.display = 'block';
            }
        }

        const voiceName = getSelectedVoiceName();
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="th-TH">
            <voice name="${voiceName}">${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</voice>
        </speak>`;

        return new Promise((resolve) => {
            voiceLiveState.avatarSynthesizer.speakSsmlAsync(
                ssml,
                (result) => {
                    voiceLiveState.isSpeaking = false;
                    document.getElementById('voiceStopSpeakBtn').style.display = 'none';
                    if (result.reason !== SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                        console.warn('Avatar speak issue:', result.errorDetails);
                    }
                    resolve();
                },
                (err) => {
                    console.error('Avatar speak error:', err);
                    voiceLiveState.isSpeaking = false;
                    document.getElementById('voiceStopSpeakBtn').style.display = 'none';
                    resolve();
                }
            );
        });
    } catch (err) {
        console.error('Avatar speak error:', err);
        voiceLiveState.isSpeaking = false;
        document.getElementById('voiceStopSpeakBtn').style.display = 'none';
    }
}

function stopAISpeaking() {
    if (voiceLiveState.synthesizer) {
        try {
            voiceLiveState.synthesizer.close();
        } catch (e) { /* ignore */ }
        voiceLiveState.synthesizer = null;
    }
    // Also stop avatar speaking
    if (voiceLiveState.avatarSynthesizer && voiceLiveState.isSpeaking) {
        try {
            voiceLiveState.avatarSynthesizer.stopSpeakingAsync(() => {}, () => {});
        } catch (e) { /* ignore */ }
    }
    voiceLiveState.isSpeaking = false;
    document.getElementById('voiceStopSpeakBtn').style.display = 'none';
}

// ==========================================
// Avatar Mode Functions
// ==========================================
function toggleAvatarMode() {
    const enabled = document.getElementById('avatarToggle').checked;
    voiceLiveState.avatarMode = enabled;
    document.getElementById('avatarSettings').style.display = enabled ? 'block' : 'none';

    if (!enabled) {
        disconnectAvatar();
    }
}

function updateAvatarLiveStyles() {
    const charSelect = document.getElementById('avatarLiveCharacter');
    const styleSelect = document.getElementById('avatarLiveStyle');
    const character = charSelect.value;
    const styles = avatarModels[character] || [];
    styleSelect.innerHTML = styles.map((s, i) => {
        const label = s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `<option value="${s}"${i === 0 ? ' selected' : ''}>${label}</option>`;
    }).join('');
}

function loadAvatarLiveCharacters() {
    const charSelect = document.getElementById('avatarLiveCharacter');
    if (!charSelect) return;
    const characters = Object.keys(avatarModels);
    if (characters.length === 0) return;
    charSelect.innerHTML = characters.map((c, i) => {
        const label = c.charAt(0).toUpperCase() + c.slice(1);
        return `<option value="${c}"${i === 0 ? ' selected' : ''}>${label}</option>`;
    }).join('');
    updateAvatarLiveStyles();
}

async function connectAvatar() {
    // Always clean up any existing connection first to avoid throttling
    if (voiceLiveState.avatarConnected || voiceLiveState.avatarSynthesizer || voiceLiveState.peerConnection) {
        disconnectAvatar();
        // Give Azure a moment to release the WebSocket
        await new Promise(r => setTimeout(r, 1000));
    }

    const status = document.getElementById('voiceStatus');
    const overlay = document.getElementById('avatarOverlay');
    const wrapper = document.getElementById('avatarVideoWrapper');
    const fsOverlay = document.getElementById('avatarFullscreen');
    const fsLoading = document.getElementById('avatarFullscreenLoading');

    status.textContent = 'Connecting avatar...';
    wrapper.style.display = 'block';
    overlay.style.display = 'flex';

    // Open fullscreen overlay immediately with loading
    fsOverlay.style.display = 'flex';
    fsLoading.style.display = 'flex';
    voiceLiveState.micMuted = false;
    voiceLiveState.speakerMuted = false;

    // Show topic in fullscreen if set
    const topicInput = document.getElementById('voiceTopic');
    const fsTopic = document.getElementById('avatarFsTopic');
    if (topicInput && topicInput.value.trim()) {
        document.getElementById('avatarFsTopicText').textContent = topicInput.value.trim();
        fsTopic.style.display = 'block';
    } else {
        fsTopic.style.display = 'none';
    }

    try {
        // Get speech token and ICE token in parallel
        const [tokenOk, iceRes] = await Promise.all([
            getAzureSpeechToken(),
            fetch('/api/ice-token').then(r => r.json())
        ]);

        if (!tokenOk || !iceRes.success) {
            throw new Error('Failed to get tokens');
        }

        const character = document.getElementById('avatarLiveCharacter').value;
        const style = document.getElementById('avatarLiveStyle').value;

        // Create speech config
        const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
            voiceLiveState.speechToken,
            voiceLiveState.speechRegion
        );
        speechConfig.speechSynthesisVoiceName = getSelectedVoiceName();

        // Create avatar config
        const avatarConfig = new SpeechSDK.AvatarConfig(character, style);
        avatarConfig.customized = false;

        // Create peer connection with ICE servers
        const iceServerData = iceRes.iceServers;
        const peerConnection = new RTCPeerConnection({
            iceServers: [{
                urls: iceServerData.Urls || iceServerData.urls,
                username: iceServerData.Username || iceServerData.username,
                credential: iceServerData.Password || iceServerData.password
            }]
        });

        voiceLiveState.peerConnection = peerConnection;

        // Handle incoming tracks — pipe to BOTH inline and fullscreen elements
        peerConnection.ontrack = (event) => {
            if (event.track.kind === 'video') {
                const videoEl = document.getElementById('avatarVideo');
                const fsVideoEl = document.getElementById('avatarFullscreenVideo');
                videoEl.srcObject = event.streams[0];
                fsVideoEl.srcObject = event.streams[0];
                videoEl.play().catch(() => {});
                fsVideoEl.play().catch(() => {});
            }
            if (event.track.kind === 'audio') {
                const audioEl = document.getElementById('avatarAudio');
                const fsAudioEl = document.getElementById('avatarFullscreenAudio');
                audioEl.srcObject = event.streams[0];
                fsAudioEl.srcObject = event.streams[0];
                audioEl.play().catch(() => {});
                fsAudioEl.play().catch(() => {});
            }
        };

        peerConnection.addTransceiver('video', { direction: 'recvonly' });
        peerConnection.addTransceiver('audio', { direction: 'recvonly' });

        // Create avatar synthesizer
        const avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);
        voiceLiveState.avatarSynthesizer = avatarSynthesizer;

        // Start avatar connection
        const result = await avatarSynthesizer.startAvatarAsync(peerConnection);

        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            voiceLiveState.avatarConnected = true;
            overlay.style.display = 'none';
            fsLoading.style.display = 'none';
            status.textContent = 'Avatar connected! Fullscreen mode active';
            console.log('Avatar connected successfully — fullscreen mode');

            // Auto-start mic listening in fullscreen
            if (!voiceLiveState.isListening) {
                toggleVoiceLive();
            }
        } else {
            throw new Error('Avatar connection failed: ' + (result.errorDetails || 'Unknown error'));
        }

    } catch (err) {
        console.error('Avatar connection error:', err);
        overlay.innerHTML = `
            <i class="fas fa-exclamation-triangle fa-2x text-warning"></i>
            <p class="text-light mt-2 mb-0 small">${err.message || 'Failed to connect avatar'}</p>
        `;
        fsOverlay.style.display = 'none';
        status.textContent = 'Avatar connection failed';
        voiceLiveState.avatarConnected = false;
    }
}

function disconnectAvatar() {
    // Force close peer connection first to free WebSocket
    if (voiceLiveState.peerConnection) {
        try { voiceLiveState.peerConnection.close(); } catch (e) {}
        voiceLiveState.peerConnection = null;
    }

    if (voiceLiveState.avatarSynthesizer) {
        try {
            voiceLiveState.avatarSynthesizer.stopAvatarAsync(
                () => { try { voiceLiveState.avatarSynthesizer.close(); } catch(e) {} voiceLiveState.avatarSynthesizer = null; },
                () => { try { voiceLiveState.avatarSynthesizer.close(); } catch(e) {} voiceLiveState.avatarSynthesizer = null; }
            );
        } catch (e) {
            try { voiceLiveState.avatarSynthesizer.close(); } catch(e2) {}
            voiceLiveState.avatarSynthesizer = null;
        }
    }

    voiceLiveState.avatarConnected = false;

    // Clear inline elements
    const videoEl = document.getElementById('avatarVideo');
    const audioEl = document.getElementById('avatarAudio');
    if (videoEl) videoEl.srcObject = null;
    if (audioEl) audioEl.srcObject = null;

    // Clear fullscreen elements
    const fsVideoEl = document.getElementById('avatarFullscreenVideo');
    const fsAudioEl = document.getElementById('avatarFullscreenAudio');
    if (fsVideoEl) fsVideoEl.srcObject = null;
    if (fsAudioEl) fsAudioEl.srcObject = null;

    // Close fullscreen overlay
    const fsOverlay = document.getElementById('avatarFullscreen');
    if (fsOverlay) fsOverlay.style.display = 'none';

    // Reset fullscreen UI
    const fsSubs = document.getElementById('avatarFsSubtitles');
    const fsTrans = document.getElementById('avatarFsTranscript');
    if (fsSubs) fsSubs.style.display = 'none';
    if (fsTrans) fsTrans.style.display = 'none';

    // Reset mic/speaker button states
    const micBtn = document.getElementById('avatarFsMicBtn');
    const spkBtn = document.getElementById('avatarFsSpeakerBtn');
    if (micBtn) micBtn.classList.remove('muted');
    if (spkBtn) spkBtn.classList.remove('muted');
    const micIcon = document.getElementById('avatarFsMicIcon');
    const spkIcon = document.getElementById('avatarFsSpeakerIcon');
    if (micIcon) micIcon.className = 'fas fa-microphone';
    if (spkIcon) spkIcon.className = 'fas fa-volume-up';

    document.getElementById('avatarVideoWrapper').style.display = 'none';
    document.getElementById('avatarOverlay').innerHTML = `
        <div class="spinner-border text-light" role="status"></div>
        <p class="text-light mt-2 mb-0 small">Connecting avatar...</p>
    `;
    document.getElementById('voiceStatus').textContent = 'Click the microphone to start';
}

// ==========================================
// Fullscreen Avatar Controls
// ==========================================
function toggleAvatarFsMic() {
    voiceLiveState.micMuted = !voiceLiveState.micMuted;
    const btn = document.getElementById('avatarFsMicBtn');
    const icon = document.getElementById('avatarFsMicIcon');

    if (voiceLiveState.micMuted) {
        btn.classList.add('muted');
        icon.className = 'fas fa-microphone-slash';
        // Pause speech recognition
        if (voiceLiveState.recognizer && voiceLiveState.isListening) {
            voiceLiveState.recognizer.stopContinuousRecognitionAsync(() => {}, () => {});
        }
    } else {
        btn.classList.remove('muted');
        icon.className = 'fas fa-microphone';
        // Resume speech recognition
        if (voiceLiveState.recognizer && voiceLiveState.isListening) {
            voiceLiveState.recognizer.startContinuousRecognitionAsync(() => {}, () => {});
        } else if (!voiceLiveState.isListening) {
            toggleVoiceLive();
        }
    }
}

function toggleAvatarFsSpeaker() {
    voiceLiveState.speakerMuted = !voiceLiveState.speakerMuted;
    const btn = document.getElementById('avatarFsSpeakerBtn');
    const icon = document.getElementById('avatarFsSpeakerIcon');
    const fsAudio = document.getElementById('avatarFullscreenAudio');
    const inlineAudio = document.getElementById('avatarAudio');

    if (voiceLiveState.speakerMuted) {
        btn.classList.add('muted');
        icon.className = 'fas fa-volume-mute';
        if (fsAudio) fsAudio.muted = true;
        if (inlineAudio) inlineAudio.muted = true;
    } else {
        btn.classList.remove('muted');
        icon.className = 'fas fa-volume-up';
        if (fsAudio) fsAudio.muted = false;
        if (inlineAudio) inlineAudio.muted = false;
    }
}

function endAvatarCall() {
    // Stop listening
    if (voiceLiveState.isListening) {
        stopVoiceListening();
    }
    // Stop any ongoing AI speech
    stopAISpeaking();
    // Disconnect avatar (also closes fullscreen)
    disconnectAvatar();
    // Uncheck the avatar toggle
    const toggle = document.getElementById('avatarToggle');
    if (toggle) {
        toggle.checked = false;
        voiceLiveState.avatarMode = false;
        document.getElementById('avatarSettings').style.display = 'none';
    }
}
