const API = '/api';
let ME = null, allSkills = [], allDepts = [], allRoles = [];
let _empDetailId = null;

window.addEventListener('DOMContentLoaded', async () => {
    const stored = localStorage.getItem('employee');
    if (!stored || !localStorage.getItem('access')) {
        window.location.href = '/api/login-page/';
        return;
    }
    ME = JSON.parse(stored);
    const role = (ME.role_name || '').toLowerCase();

    document.getElementById('uName').textContent = ME.emp_name;
    document.getElementById('uEmail').textContent = ME.emp_email;
    document.getElementById('uRole').textContent = ME.role_name || 'Employee';
    document.getElementById('tbSub').textContent = `Good day, ${ME.emp_name.split(' ')[0]}`;

    const initials = ME.emp_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    document.getElementById('uAvatar').textContent = initials;

    if (role === 'admin' || role === 'recruiter' || role === 'hr') {
        document.getElementById('mgmtSection').style.display = 'block';
    }
    if (role === 'admin' || role === 'hr' || role === 'recruiter' || role === 'employee') {
        document.getElementById('adminSection').style.display = 'block';
    }

    // Recruiter gets read-only access to admin section — hide add buttons
    if (role === 'recruiter' || role === 'employee') {
        document.querySelectorAll('#view-departments .btn-blue, #view-roles .btn-blue, #view-skills .btn-blue')
            .forEach(btn => btn.style.display = 'none');
    }

    await Promise.all([fetchSkills(), fetchDepts(), fetchRoles()]);
    loadHomeStats();
});

/* =============================================
   API HELPERS
============================================= */
async function req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('access');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    let res = await fetch(`${API}${path}`, opts);
    if (res.status === 401) {
        if (await tryRefresh()) {
            headers['Authorization'] = `Bearer ${localStorage.getItem('access')}`;
            res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
        } else {
            handleLogout();
            return null;
        }
    }
    return res;
}

async function tryRefresh() {
    const r = localStorage.getItem('refresh');
    if (!r) return false;
    const res = await fetch(`${API}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: r })
    });
    if (!res.ok) return false;
    const d = await res.json();
    localStorage.setItem('access', d.access);
    if (d.refresh) localStorage.setItem('refresh', d.refresh);
    return true;
}

function listOf(d) {
    return Array.isArray(d) ? d : (d.results || []);
}

function fillSelect(id, items, val, label) {
    const s = document.getElementById(id);
    if (!s) return;
    s.innerHTML = '<option value="">— Select —</option>';
    items.forEach(i => {
        const o = document.createElement('option');
        o.value = i[val];
        o.textContent = i[label];
        s.appendChild(o);
    });
}

/* =============================================
   NAVIGATION
============================================= */
const viewMeta = {
    home: { title: 'Dashboard', sub: 'Your recruitment overview' },
    profile: { title: 'My Profile', sub: 'Your account details' },
    requirements: { title: 'Requirements', sub: 'Manage hiring requirements' },
    employees: { title: 'Employees', sub: 'Manage employee accounts' },
    departments: { title: 'Departments', sub: 'Manage organization departments' },
    roles: { title: 'Roles', sub: 'Manage access roles' },
    skills: { title: 'Skills', sub: 'Manage skill master data' },
    interviews: { title: 'Interviews', sub: 'Scheduled candidate interviews' },
};

function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`view-${name}`).classList.add('active');
    document.getElementById(`nav-${name}`)?.classList.add('active');

    const m = viewMeta[name] || {};
    document.getElementById('tbTitle').textContent = m.title || '';
    document.getElementById('tbSub').textContent = m.sub || '';

    const loaders = {
        home: loadHomeStats,
        profile: loadProfile,
        requirements: loadReqs,
        employees: loadEmps,
        departments: loadDepts,
        roles: loadRoles,
        skills: loadSkills,
        interviews: loadInterviews,
    };
    loaders[name]?.();
}

/* =============================================
   TOAST
============================================= */
function toast(msg, type = 'ok') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast show ${type}`;
    setTimeout(() => el.classList.remove('show'), 3000);
}

/* =============================================
   OVERLAY
============================================= */
function openOverlay(id) { document.getElementById(id).classList.add('open'); }
function closeOverlay(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.overlay').forEach(o =>
    o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); })
);

/* =============================================
   MASTER DATA
============================================= */
async function fetchSkills() {
    const r = await req('GET', '/skills/');
    if (r?.ok) allSkills = listOf(await r.json());
}
async function fetchDepts() {
    const r = await req('GET', '/departments/');
    if (r?.ok) allDepts = listOf(await r.json());
}
async function fetchRoles() {
    const r = await req('GET', '/roles/');
    if (r?.ok) allRoles = listOf(await r.json());
}

/* =============================================
   HOME
============================================= */
async function loadHomeStats() {
    const role = (ME.role_name || '').toLowerCase();
    const isAdminUser = role === 'admin' || role === 'hr';

    // ── Requirements stats ───────────────────────────────────────────
    const r = await req('GET', '/requirements/');
    if (!r) return;
    const list = listOf(await r.json());

    document.getElementById('sTot').textContent = list.length;
    document.getElementById('sPend').textContent = list.filter(x => x.status === 'pending').length;
    document.getElementById('sApp').textContent = list.filter(x => x.status === 'approved').length;
    document.getElementById('sRej').textContent = list.filter(x => x.status === 'rejected').length;

    renderReqTable('recentTable', list.slice(0, 6), true);

    // ── Interview email stats (admin/hr only) ────────────────────────
    if (isAdminUser) {
        const ir = await req('GET', '/interviews/');
        if (ir?.ok) {
            const interviews = listOf(await ir.json());
            const totalInterviews = interviews.length;
            const emailSent = interviews.filter(i => i.email_sent).length;
            const emailPending = interviews.filter(i => !i.email_sent).length;

            const emailStatsEl = document.getElementById('emailStatsSection');
            if (emailStatsEl) {
                emailStatsEl.innerHTML = `
                  <div class="card" style="margin-top:20px">
        <div class="card-head">
            <span class="card-head-title">📧 Interview Email Stats</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:4px 16px 16px">
            <div style="background:#ede9fe;border-radius:10px;padding:14px 12px;text-align:center">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#4f46e5;margin-bottom:6px">Total Interviews</div>
                <div style="font-size:28px;font-weight:700;color:#4f46e5">${totalInterviews}</div>
            </div>
            <div style="background:#dcfce7;border-radius:10px;padding:14px 12px;text-align:center">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#15803d;margin-bottom:6px">Emails Sent</div>
                <div style="font-size:28px;font-weight:700;color:#15803d">${emailSent}</div>
            </div>
            <div style="background:#fef3c7;border-radius:10px;padding:14px 12px;text-align:center">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#92400e;margin-bottom:6px">Emails Pending</div>
                <div style="font-size:28px;font-weight:700;color:#d97706">${emailPending}</div>
            </div>
        </div>
    </div>
                `;
            }

            const pendingEmailEl = document.getElementById('pendingEmailTable');
            if (pendingEmailEl) {
                const pending = interviews.filter(i => !i.email_sent).slice(0, 5);
                if (!pending.length) {
                    pendingEmailEl.innerHTML = '<div class="empty" style="padding:16px">✅ All interview emails have been sent.</div>';
                } else {
                    let h = `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:0 4px 12px">
                            <span style="font-weight:600;font-size:14px;color:var(--text)">📧 Pending Interview Emails</span>
                            <button id="sendAllBtnHome" class="btn-outline green" onclick="sendAllEmails('home')" style="font-size:12px;padding:5px 12px">
                                📧 Send All Pending
                            </button>
                        </div>
                        <table><thead><tr>
                            <th>Candidate</th><th>Requirement</th><th>Scheduled</th><th>Action</th>
                        </tr></thead><tbody>`;
                    pending.forEach(i => {
                        const dateStr = i.scheduled_at
                            ? new Date(i.scheduled_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '—';
                        h += `<tr>
                            <td style="font-weight:600">${i.candidate_name}</td>
                            <td style="color:var(--sub)">${i.requirement_title || '—'}</td>
                            <td style="color:var(--sub);font-size:12px">${dateStr}</td>
                            <td><button class="btn-outline green" style="font-size:11px;padding:4px 10px" onclick="sendInterviewEmail(${i.id}, 'home')">📧 Send</button></td>
                        </tr>`;
                    });
                    h += '</tbody></table>';
                    if (interviews.filter(i => !i.email_sent).length > 5) {
                        h += `<div style="padding:8px 4px;font-size:11.5px;color:var(--muted)">Showing 5 of ${interviews.filter(i => !i.email_sent).length} pending. <a href="#" onclick="showView('interviews')" style="color:var(--primary)">View all →</a></div>`;
                    }
                    pendingEmailEl.innerHTML = h;
                }
            }
        }
    }

    // ── Kanban pipeline stats (admin/hr only) ────────────────────────
    if (isAdminUser) {
        const kr = await req('GET', '/resumes/');   // fixed: req() already prepends /api
        if (kr?.ok) {
            const resumes = listOf(await kr.json());

            // Stage totals
            const stageCounts = {
                applied: resumes.filter(r => (r.stage || 'applied') === 'applied').length,
                screening: resumes.filter(r => r.stage === 'screening').length,
                shortlisted: resumes.filter(r => r.stage === 'shortlisted').length,
                interview_scheduled: resumes.filter(r => r.stage === 'interview_scheduled').length,
                selected: resumes.filter(r => r.stage === 'selected').length,
                rejected: resumes.filter(r => r.stage === 'rejected').length,
            };

            // Per-requirement breakdown
            const byReq = {};
            resumes.forEach(resume => {
                const key = resume.requirement_title || 'Unknown';
                if (!byReq[key]) byReq[key] = { applied: 0, shortlisted: 0, selected: 0 };
                const stage = resume.stage || 'applied';
                if (stage === 'applied') byReq[key].applied++;
                if (stage === 'shortlisted') byReq[key].shortlisted++;
                if (stage === 'selected') byReq[key].selected++;
            });

            const reqRows = Object.entries(byReq).map(([title, counts]) => `
                <div style="display:flex;align-items:center;justify-content:space-between;
                            padding:10px 0;border-bottom:.5px solid #e5e7eb;flex-wrap:wrap;gap:8px">
                    <div style="font-size:13px;font-weight:600;color:var(--text)">${title}</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                        <span style="font-size:11px;padding:2px 8px;border-radius:6px;
                                     background:#ede9fe;color:#4f46e5;font-weight:600">
                            ${counts.applied} applied
                        </span>
                        <span style="font-size:11px;padding:2px 8px;border-radius:6px;
                                     background:#fef3c7;color:#92400e;font-weight:600">
                            ${counts.shortlisted} shortlisted
                        </span>
                        <span style="font-size:11px;padding:2px 8px;border-radius:6px;
                                     background:#dcfce7;color:#166534;font-weight:600">
                            ${counts.selected} selected
                        </span>
                    </div>
                </div>
            `).join('');

            const STAGE_CONFIG = [
                { key: 'applied', label: 'Applied', color: '#4f46e5', bg: '#ede9fe' },
                { key: 'screening', label: 'Screening', color: '#b45309', bg: '#fef9c3' },
                { key: 'shortlisted', label: 'Shortlisted', color: '#1d4ed8', bg: '#dbeafe' },
                { key: 'interview_scheduled', label: 'Interview', color: '#7c3aed', bg: '#f3e8ff' },
                { key: 'selected', label: 'Selected', color: '#15803d', bg: '#dcfce7' },
                { key: 'rejected', label: 'Rejected', color: '#b91c1c', bg: '#fee2e2' },
            ];

            const kbStatsEl = document.getElementById('kbStatsSection');
            if (kbStatsEl) {
                kbStatsEl.innerHTML = `
                    <div class="card" style="margin-top:20px">
                        <div class="card-head">
                            <span class="card-head-title">🗂 Kanban Pipeline</span>
                            <button class="btn-outline" style="font-size:12px;padding:4px 12px"
                                    onclick="showView('kanban')">View Board →</button>
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;padding:4px 16px 16px">
                            ${STAGE_CONFIG.map(s => `
                                <div style="background:${s.bg};border-radius:10px;padding:14px 12px;
                                            text-align:center;cursor:pointer"
                                     onclick="showView('kanban')">
                                    <div style="font-size:22px;font-weight:700;color:${s.color}">
                                        ${stageCounts[s.key]}
                                    </div>
                                    <div style="font-size:11px;font-weight:600;color:${s.color};
                                                text-transform:uppercase;letter-spacing:.4px;margin-top:4px">
                                        ${s.label}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="card" style="margin-top:16px">
                        <div class="card-head">
                            <span class="card-head-title">📋 Pipeline by Requirement</span>
                        </div>
                        <div style="padding:0 16px 8px">
                            ${reqRows || '<div style="padding:16px;color:var(--muted);font-size:13px">No candidates yet.</div>'}
                        </div>
                    </div>
                `;
            }
        }
    }
}

/* =============================================
   REQUIREMENTS
============================================= */
async function loadReqs() {
    document.getElementById('reqTable').innerHTML = '<div class="loading">Loading…</div>';
    const r = await req('GET', '/requirements/');
    if (!r) return;
    renderReqTable('reqTable', listOf(await r.json()), false);
}

function renderReqTable(tid, list, compact) {
    const role = (ME.role_name || '').toLowerCase();
    const canReview = role === 'admin' || role === 'recruiter' || role === 'hr';
    const canEditJD = role === 'admin' || role === 'hr';

    if (!list.length) {
        document.getElementById(tid).innerHTML = '<div class="empty">No requirements found.</div>';
        return;
    }

    let h = `<table><thead><tr>
        <th>Title</th><th>Department</th>
        ${!compact ? '<th>Skills</th>' : ''}
        <th>Status</th><th>Requested By</th><th>Actions</th>
    </tr></thead><tbody>`;

    list.forEach(r => {
        const skills = (r.skills || []).map(s => `<span class="skill-pill">${s.skill_name}</span>`).join('');
        const jdEscaped = (r.job_description || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
        const titleEscaped = (r.requirement_title || '').replace(/'/g, "\\'");

        h += `<tr>
            <td>
                <div style="font-weight:600;color:var(--text)">${r.requirement_title}</div>
                <div style="font-size:12px;color:var(--muted);margin-top:2px">${[r.employment_type, r.work_mode].filter(Boolean).join(' · ')}</div>
            </td>
            <td style="color:var(--sub)">${r.department_name || '—'}</td>
            ${!compact ? `<td>${skills || '<span style="color:var(--muted)">—</span>'}</td>` : ''}
            <td><span class="badge badge-${r.status}">${r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span></td>
            <td style="color:var(--sub)">${r.requested_by_name || '—'}</td>
            <td>
                <button class="btn-outline" onclick="editReq(${r.id})">Edit</button>
                ${canEditJD ? `<button class="btn-outline" style="color:var(--indigo)" onclick="openJdEdit(${r.id}, '${jdEscaped}', '${titleEscaped}')">📝 JD</button>` : ''}
                ${canReview && r.status === 'pending' ? `<button class="btn-outline green" onclick="openStatusOverlay(${r.id})">Review</button>` : ''}
                <button class="btn-outline ${r.is_active ? 'red' : 'green'}" onclick="toggleReq(${r.id}, ${r.is_active})">${r.is_active ? 'Deactivate' : 'Activate'}</button>
            </td>
        </tr>`;
    });

    h += '</tbody></table>';
    document.getElementById(tid).innerHTML = h;
}

function openReqModal(pre = null) {
    ['reqTitle', 'reqExp', 'reqLoc', 'reqSal', 'reqJD', 'reqNewSkill'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('reqId').value = '';
    document.getElementById('reqVac').value = '';
    document.getElementById('reqMTitle').textContent = 'New Requirement';

    fillSelect('reqDept', allDepts, 'id', 'department_name');
    document.getElementById('skillBoxes').innerHTML = allSkills.map(s =>
        `<label><input type="checkbox" value="${s.id}"> ${s.skill_name}</label>`
    ).join('');

    if (pre) {
        document.getElementById('reqMTitle').textContent = 'Edit Requirement';
        document.getElementById('reqId').value = pre.id;
        document.getElementById('reqTitle').value = pre.requirement_title;
        document.getElementById('reqVac').value = pre.vacancies;
        document.getElementById('reqExp').value = pre.experience_required || '';
        document.getElementById('reqLoc').value = pre.location || '';
        document.getElementById('reqSal').value = pre.salary_range || '';
        document.getElementById('reqJD').value = pre.job_description || '';
        document.getElementById('reqNewSkill').value = pre.requested_new_skill || '';
        document.getElementById('reqDept').value = pre.department || '';
        document.getElementById('reqEType').value = pre.employment_type || '';
        document.getElementById('reqWMode').value = pre.work_mode || '';

        const ids = (pre.skills || []).map(s => s.id);
        document.querySelectorAll('#skillBoxes input').forEach(cb => {
            cb.checked = ids.includes(parseInt(cb.value));
        });
    }
    openOverlay('reqOverlay');
}

async function editReq(id) {
    const r = await req('GET', `/requirements/${id}/`);
    if (!r?.ok) return;
    openReqModal(await r.json());
}

async function saveReq() {
    const id = document.getElementById('reqId').value;
    const title = document.getElementById('reqTitle').value.trim();
    if (!title) { toast('Title is required', 'err'); return; }

    const body = {
        requirement_title: title,
        department: document.getElementById('reqDept').value || null,
        vacancies: document.getElementById('reqVac').value || 1,
        experience_required: document.getElementById('reqExp').value,
        location: document.getElementById('reqLoc').value,
        salary_range: document.getElementById('reqSal').value,
        employment_type: document.getElementById('reqEType').value,
        work_mode: document.getElementById('reqWMode').value,
        job_description: document.getElementById('reqJD').value,
        requested_new_skill: document.getElementById('reqNewSkill').value,
        skill_ids: [...document.querySelectorAll('#skillBoxes input:checked')].map(c => parseInt(c.value)),
    };

    const r = await req(id ? 'PUT' : 'POST', id ? `/requirements/${id}/` : '/requirements/', body);
    if (r?.ok) {
        toast(id ? 'Updated!' : 'Created!');
        closeOverlay('reqOverlay');
        loadReqs();
        loadHomeStats();
    } else {
        const e = await r?.json();
        toast(Object.values(e || {}).flat()[0] || 'Error', 'err');
    }
}

async function toggleReq(id, currentStatus) {
    const action = currentStatus ? 'deactivate' : 'activate';
    if (!confirm(`Do you want to ${action} this requirement?`)) return;
    const r = await req('PATCH', `/requirements/${id}/toggle-active/`);
    if (r?.ok) { toast(`Requirement ${action}d`); loadReqs(); loadHomeStats(); }
    else toast('Failed', 'err');
}

function openStatusOverlay(id) {
    document.getElementById('sReqId').value = id;
    document.getElementById('sComments').value = '';
    openOverlay('statusOverlay');
}

async function submitStatus() {
    const id = document.getElementById('sReqId').value;
    const dec = document.getElementById('sDecision').value;
    const com = document.getElementById('sComments').value;
    const r = await req('PATCH', `/requirements/${id}/update-status/`, { status: dec, recruiter_comments: com });
    if (r?.ok) {
        toast(`Requirement ${dec}`);
        closeOverlay('statusOverlay');
        loadReqs();
        loadHomeStats();
    } else toast('Failed', 'err');
}

/* =============================================
   PROFILE
============================================= */
async function loadProfile() {
    document.getElementById('profileContent').innerHTML = '<div class="loading">Loading…</div>';
    const r = await req('GET', `/employees/${ME.id}/`);
    if (!r?.ok) {
        document.getElementById('profileContent').innerHTML = '<div class="empty">Could not load profile.</div>';
        return;
    }
    const e = await r.json();
    const role = (ME.role_name || '').toLowerCase();
    const initials = e.emp_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const memberSince = new Date(e.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    const isActive = e.is_active !== false;
    const isVerified = e.is_verified;

    const heroChips = `
        <span class="profile-chip"><span class="dot ${isActive ? '' : 'warn'}"></span>${isActive ? 'Active' : 'Inactive'}</span>
        <span class="profile-chip">${e.role_name || 'Employee'}</span>
        ${e.department_name ? `<span class="profile-chip">🏢 ${e.department_name}</span>` : ''}
    `;

    let adminSection = '';
    if (role === 'admin' || role === 'hr') {
        adminSection = `
        <div class="profile-admin-box">
            <div class="profile-section-title">⚙ Admin Visibility</div>
            <div class="profile-admin-flags">
                <span class="flag-chip ${isVerified ? 'yes' : 'no'}">${isVerified ? '✓' : '✗'} Verified</span>
                <span class="flag-chip ${isActive ? 'yes' : 'no'}">${isActive ? '✓' : '✗'} Active</span>
                <span class="flag-chip ${e.is_staff ? 'yes' : 'neutral'}">${e.is_staff ? '✓' : '—'} Staff Access</span>
            </div>
        </div>`;
    } else if (role === 'recruiter') {
        adminSection = `
        <div class="profile-admin-box" style="background:#eff6ff;border-color:#bfdbfe">
            <div class="profile-section-title" style="color:#1e40af">👁 Recruiter Info</div>
            <div class="profile-admin-flags">
                <span class="flag-chip ${isActive ? 'yes' : 'no'}">${isActive ? '✓' : '✗'} Active Account</span>
                ${e.created_by_employee ? `<span class="flag-chip neutral">Created by ID ${e.created_by_employee}</span>` : ''}
            </div>
        </div>`;
    }

    document.getElementById('profileContent').innerHTML = `
        <div class="profile-hero">
            <div class="profile-hero-inner">
                <div class="profile-avatar-lg">${initials}</div>
                <div class="profile-hero-text">
                    <div class="profile-hero-name">${e.emp_name}</div>
                    <div class="profile-hero-email">${e.emp_email}</div>
                    <div class="profile-hero-chips">${heroChips}</div>
                </div>
            </div>
        </div>
        <div class="profile-section-title">Personal Information</div>
        <div class="profile-grid">
            <div class="profile-info-card">
                <span class="pic-icon">🪪</span>
                <div class="pic-label">Employee ID</div>
                <div class="pic-value mono">${e.emp_id}</div>
            </div>
            <div class="profile-info-card">
                <span class="pic-icon">📱</span>
                <div class="pic-label">Phone Number</div>
                <div class="pic-value mono">${e.phone_number || '—'}</div>
            </div>
            <div class="profile-info-card">
                <span class="pic-icon">🏢</span>
                <div class="pic-label">Department</div>
                <div class="pic-value">${e.department_name || '—'}</div>
            </div>
            <div class="profile-info-card">
                <span class="pic-icon">🔑</span>
                <div class="pic-label">Role</div>
                <div class="pic-value">${e.role_name || '—'}</div>
            </div>
        </div>
        ${adminSection}
        <div class="member-since-bar">
            <div class="member-since-icon">📅</div>
            <div>
                <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:3px">Member Since</div>
                <div style="font-size:14px;font-weight:600;color:var(--text)">${memberSince}</div>
            </div>
        </div>
    `;
}

/* =============================================
   EMPLOYEES
============================================= */
async function loadEmps() {
    document.getElementById('empTable').innerHTML = '<div class="loading">Loading…</div>';
    const r = await req('GET', '/employees/');
    if (!r?.ok) {
        document.getElementById('empTable').innerHTML = '<div class="empty">Access restricted.</div>';
        return;
    }
    const list = listOf(await r.json());
    if (!list.length) { document.getElementById('empTable').innerHTML = '<div class="empty">No employees found.</div>'; return; }

    const role = (ME.role_name || '').toLowerCase();
    const canView = role === 'admin' || role === 'hr';
    const canDeactivate = role === 'admin';

    let h = `<table><thead><tr>
        <th>Employee</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>`;

    list.forEach(e => {
        const rowAttrs = canView ? `class="emp-row-clickable" onclick="openEmpDetail(${e.id})"` : '';
        h += `<tr ${rowAttrs}>
            <td>
                <div style="font-weight:600">${e.emp_name}</div>
                <div style="font-size:12px;color:var(--muted)">${e.emp_id}</div>
            </td>
            <td style="color:var(--sub)">${e.emp_email}</td>
            <td>${e.department_name || '—'}</td>
            <td>${e.role_name || '—'}</td>
            <td>
                <span class="badge ${e.is_verified ? 'badge-approved' : 'badge-pending'}">${e.is_verified ? 'Verified' : 'Unverified'}</span>
                <span class="badge ${e.is_active ? 'badge-active' : 'badge-inactive'}" style="margin-left:4px">${e.is_active ? 'Active' : 'Inactive'}</span>
            </td>
            <td onclick="event.stopPropagation()">
                ${!e.is_verified && canView ? `<button class="btn-outline green" onclick="verifyEmp(${e.id})">Verify</button>` : ''}
                ${canDeactivate ? `<button class="btn-outline red" onclick="deactivateEmp(${e.id})">Deactivate</button>` : ''}
            </td>
        </tr>`;
    });

    h += '</tbody></table>';
    if (canView) {
        h += `<div style="padding:10px 22px 12px;font-size:11.5px;color:var(--muted)">💡 Click any row to view full employee details</div>`;
    }
    document.getElementById('empTable').innerHTML = h;
}

async function openEmpDetail(id) {
    _empDetailId = id;
    document.getElementById('empDetailContent').innerHTML = '<div class="loading">Loading…</div>';
    document.getElementById('empDetailVerifyBtn').style.display = 'none';
    openOverlay('empDetailOverlay');

    const r = await req('GET', `/employees/${id}/`);
    if (!r?.ok) {
        document.getElementById('empDetailContent').innerHTML = '<div class="empty">Could not load employee details.</div>';
        return;
    }
    renderEmpDetailModal(await r.json());
}

function renderEmpDetailModal(e) {
    const initials = e.emp_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const memberSince = new Date(e.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    const updatedAt = new Date(e.updated_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    const isActive = e.is_active !== false;
    const isVerified = e.is_verified;
    const isStaff = e.is_staff;

    if (!isVerified) document.getElementById('empDetailVerifyBtn').style.display = 'inline-flex';

    document.getElementById('empDetailContent').innerHTML = `
        <div class="emp-detail-hero">
            <div class="emp-detail-avatar">${initials}</div>
            <div class="emp-detail-hero-text">
                <div class="emp-detail-name">${e.emp_name}</div>
                <div class="emp-detail-id">${e.emp_id} &middot; ${e.emp_email}</div>
                <div class="emp-status-row">
                    <span class="emp-status-chip"><span class="dot ${isActive ? 'dot-green' : 'dot-red'}"></span>${isActive ? 'Active' : 'Inactive'}</span>
                    <span class="emp-status-chip"><span class="dot ${isVerified ? 'dot-green' : 'dot-yellow'}"></span>${isVerified ? 'Verified' : 'Unverified'}</span>
                    ${isStaff ? '<span class="emp-status-chip">⚡ Staff</span>' : ''}
                </div>
            </div>
        </div>

        <div class="emp-detail-section-title">Contact &amp; Identity</div>
        <div class="emp-detail-grid">
            <div class="emp-detail-field"><div class="edf-label">Employee ID</div><div class="edf-value mono">${e.emp_id}</div></div>
            <div class="emp-detail-field"><div class="edf-label">Full Name</div><div class="edf-value">${e.emp_name}</div></div>
            <div class="emp-detail-field full"><div class="edf-label">Company Email</div><div class="edf-value mono">${e.emp_email}</div></div>
            <div class="emp-detail-field full"><div class="edf-label">Phone Number</div><div class="edf-value mono">${e.phone_number || '—'}</div></div>
        </div>

        <div class="emp-detail-section-title">Organisation</div>
        <div class="emp-detail-grid">
            <div class="emp-detail-field"><div class="edf-label">Department</div><div class="edf-value">${e.department_name || '—'}</div></div>
            <div class="emp-detail-field"><div class="edf-label">Role</div><div class="edf-value">${e.role_name || '—'}</div></div>
            <div class="emp-detail-field"><div class="edf-label">Created By (ID)</div><div class="edf-value mono">${e.created_by_employee ?? '—'}</div></div>
            <div class="emp-detail-field"><div class="edf-label">Internal DB ID</div><div class="edf-value mono">#${e.id}</div></div>
        </div>

        <div class="emp-detail-section-title">Admin Flags</div>
        <div class="emp-admin-flags">
            <div class="eaf-item">
                <div class="eaf-label">Verified</div>
                <span class="badge ${isVerified ? 'badge-approved' : 'badge-pending'}">${isVerified ? '✓ Yes' : '✗ No'}</span>
            </div>
            <div class="eaf-item">
                <div class="eaf-label">Active</div>
                <span class="badge ${isActive ? 'badge-active' : 'badge-inactive'}">${isActive ? '✓ Yes' : '✗ No'}</span>
            </div>
            <div class="eaf-item">
                <div class="eaf-label">Staff Access</div>
                <span class="badge ${isStaff ? 'badge-active' : 'badge-inactive'}">${isStaff ? '✓ Yes' : '— No'}</span>
            </div>
        </div>

        <div class="emp-detail-section-title">Timeline</div>
        <div class="emp-detail-grid">
            <div class="emp-detail-field"><div class="edf-label">Member Since</div><div class="edf-value">${memberSince}</div></div>
            <div class="emp-detail-field"><div class="edf-label">Last Updated</div><div class="edf-value">${updatedAt}</div></div>
        </div>
    `;
}

async function verifyEmpFromDetail() {
    if (!_empDetailId) return;
    const r = await req('PATCH', `/employees/${_empDetailId}/verify/`, {});
    if (r?.ok) {
        toast('Employee verified!');
        document.getElementById('empDetailVerifyBtn').style.display = 'none';
        const r2 = await req('GET', `/employees/${_empDetailId}/`);
        if (r2?.ok) renderEmpDetailModal(await r2.json());
        loadEmps();
    } else toast('Failed', 'err');
}

function openEmpModal() {
    ['eId', 'eName', 'eEmail', 'ePhone', 'ePw'].forEach(id => document.getElementById(id).value = '');
    fillSelect('eDept', allDepts, 'id', 'department_name');
    fillSelect('eRole', allRoles, 'id', 'role_name');
    openOverlay('empOverlay');
}

async function saveEmp() {
    const body = {
        emp_id: document.getElementById('eId').value.trim(),
        emp_name: document.getElementById('eName').value.trim(),
        emp_email: document.getElementById('eEmail').value.trim(),
        phone_number: document.getElementById('ePhone').value.trim() || null,
        password: document.getElementById('ePw').value,
        department: document.getElementById('eDept').value || null,
        role: document.getElementById('eRole').value || null,
        created_by_employee: ME.id
    };
    if (!body.emp_id || !body.emp_name || !body.emp_email || !body.password) {
        toast('Fill in required fields', 'err');
        return;
    }
    const r = await req('POST', '/employees/', body);
    if (r?.ok) {
        toast('Employee added!');
        closeOverlay('empOverlay');
        loadEmps();
    } else {
        const e = await r?.json();
        toast(Object.values(e || {}).flat()[0] || 'Error', 'err');
    }
}

async function verifyEmp(id) {
    const r = await req('PATCH', `/employees/${id}/verify/`, {});
    if (r?.ok) { toast('Employee verified!'); loadEmps(); }
    else toast('Failed', 'err');
}

async function deactivateEmp(id) {
    if (!confirm('Deactivate this employee?')) return;
    const r = await req('DELETE', `/employees/${id}/`);
    if (r?.ok) { toast('Employee deactivated'); loadEmps(); }
    else toast('Failed', 'err');
}

/* =============================================
   DEPARTMENTS
============================================= */
async function loadDepts() {
    const role = (ME.role_name || '').toLowerCase();  
    const canEdit = role === 'admin' || role === 'hr';
    document.getElementById('deptTable').innerHTML = '<div class="loading">Loading…</div>';
    const r = await req('GET', '/departments/');
    if (!r?.ok) return;
    const list = listOf(await r.json());
    if (!list.length) { document.getElementById('deptTable').innerHTML = '<div class="empty">No departments.</div>'; return; }

    let h = `<table><thead><tr><th>Name</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
    list.forEach(d => {
        h += `<tr>
            <td style="font-weight:600">${d.department_name}</td>
            <td style="color:var(--sub)">${d.description || '—'}</td>
            <td><span class="badge ${d.is_active ? 'badge-active' : 'badge-inactive'}">${d.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
    ${canEdit ? `
        <button class="btn-outline" onclick="editDept(${d.id},'${d.department_name.replace(/'/g, "\\'")}','${(d.description || '').replace(/'/g, "\\'")}')">Edit</button>
        <button class="btn-outline red" onclick="deactivateDept(${d.id})">Deactivate</button>
    ` : '<span style="color:var(--muted);font-size:12px">View only</span>'}
</td>
        </tr>`;
    });
    h += '</tbody></table>';
    document.getElementById('deptTable').innerHTML = h;
}

function openDeptModal() {
    document.getElementById('dId').value = '';
    document.getElementById('dName').value = '';
    document.getElementById('dDesc').value = '';
    document.getElementById('dMTitle').textContent = 'Add Department';
    openOverlay('deptOverlay');
}

function editDept(id, name, desc) {
    document.getElementById('dId').value = id;
    document.getElementById('dName').value = name;
    document.getElementById('dDesc').value = desc;
    document.getElementById('dMTitle').textContent = 'Edit Department';
    openOverlay('deptOverlay');
}

async function saveDept() {
    const id = document.getElementById('dId').value;
    const name = document.getElementById('dName').value.trim();
    const desc = document.getElementById('dDesc').value.trim();
    if (!name) { toast('Name required', 'err'); return; }
    const r = await req(id ? 'PUT' : 'POST', id ? `/departments/${id}/` : '/departments/', { department_name: name, description: desc });
    if (r?.ok) {
        toast(id ? 'Updated!' : 'Created!');
        closeOverlay('deptOverlay');
        loadDepts();
        await fetchDepts();
    } else toast('Failed', 'err');
}

async function deactivateDept(id) {
    if (!confirm('Deactivate?')) return;
    const r = await req('DELETE', `/departments/${id}/`);
    if (r?.ok) { toast('Deactivated'); loadDepts(); }
    else toast('Failed', 'err');
}

/* =============================================
   ROLES
============================================= */
async function loadRoles() {
    const role = (ME.role_name || '').toLowerCase();
    const canEdit = role === 'admin' || role === 'hr';
    document.getElementById('roleTable').innerHTML = '<div class="loading">Loading…</div>';
    const r = await req('GET', '/roles/');
    if (!r?.ok) return;
    const list = listOf(await r.json());
    if (!list.length) { document.getElementById('roleTable').innerHTML = '<div class="empty">No roles.</div>'; return; }

    let h = `<table><thead><tr><th>Role</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
    list.forEach(ro => {
        h += `<tr>
            <td style="font-weight:600">${ro.role_name}</td>
            <td style="color:var(--sub)">${ro.role_description || '—'}</td>
            <td><span class="badge ${ro.is_active ? 'badge-active' : 'badge-inactive'}">${ro.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
    ${canEdit ? `
        <button class="btn-outline" onclick="editRole(${ro.id},'${ro.role_name.replace(/'/g, "\\'")}','${(ro.role_description || '').replace(/'/g, "\\'")}')">Edit</button>
    ` : '<span style="color:var(--muted);font-size:12px">View only</span>'}
    </td>
        </tr>`;
    });
    h += '</tbody></table>';
    document.getElementById('roleTable').innerHTML = h;
}

function openRoleModal() {
    document.getElementById('rId').value = '';
    document.getElementById('rName').value = '';
    document.getElementById('rDesc').value = '';
    document.getElementById('rMTitle').textContent = 'Add Role';
    openOverlay('roleOverlay');
}

function editRole(id, name, desc) {
    document.getElementById('rId').value = id;
    document.getElementById('rName').value = name;
    document.getElementById('rDesc').value = desc;
    document.getElementById('rMTitle').textContent = 'Edit Role';
    openOverlay('roleOverlay');
}

async function saveRole() {
    const id = document.getElementById('rId').value;
    const name = document.getElementById('rName').value.trim();
    const desc = document.getElementById('rDesc').value.trim();
    if (!name) { toast('Name required', 'err'); return; }
    const r = await req(id ? 'PUT' : 'POST', id ? `/roles/${id}/` : '/roles/', { role_name: name, role_description: desc });
    if (r?.ok) {
        toast(id ? 'Updated!' : 'Created!');
        closeOverlay('roleOverlay');
        loadRoles();
        await fetchRoles();
    } else toast('Failed', 'err');
}

/* =============================================
   SKILLS
============================================= */
async function loadSkills() {
    const role = (ME.role_name || '').toLowerCase();
    const canEdit = role === 'admin' || role === 'hr';
    document.getElementById('skillTable').innerHTML = '<div class="loading">Loading…</div>';
    const r = await req('GET', '/skills/');
    if (!r?.ok) return;
    const list = listOf(await r.json());
    if (!list.length) { document.getElementById('skillTable').innerHTML = '<div class="empty">No skills.</div>'; return; }

    let h = `<table><thead><tr><th>Skill</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
    list.forEach(s => {
        h += `<tr>
            <td style="font-weight:600">${s.skill_name}</td>
            <td><span class="badge ${s.is_active ? 'badge-active' : 'badge-inactive'}">${s.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
    ${canEdit ? `
        <button class="btn-outline" onclick="editSkill(${s.id},'${s.skill_name.replace(/'/g, "\\'")}')">Edit</button>
    ` : '<span style="color:var(--muted);font-size:12px">View only</span>'}
    </td>
        </tr>`;
    });
    h += '</tbody></table>';
    document.getElementById('skillTable').innerHTML = h;
}

function openSkillModal() {
    document.getElementById('skId').value = '';
    document.getElementById('skName').value = '';
    document.getElementById('skMTitle').textContent = 'Add Skill';
    openOverlay('skillOverlay');
}

function editSkill(id, name) {
    document.getElementById('skId').value = id;
    document.getElementById('skName').value = name;
    document.getElementById('skMTitle').textContent = 'Edit Skill';
    openOverlay('skillOverlay');
}

async function saveSkill() {
    const id = document.getElementById('skId').value;
    const name = document.getElementById('skName').value.trim();
    if (!name) { toast('Name required', 'err'); return; }
    const r = await req(id ? 'PUT' : 'POST', id ? `/skills/${id}/` : '/skills/', { skill_name: name });
    if (r?.ok) {
        toast(id ? 'Updated!' : 'Created!');
        closeOverlay('skillOverlay');
        loadSkills();
        await fetchSkills();
    } else toast('Failed', 'err');
}

/* =============================================
   INTERVIEWS
============================================= */
async function loadInterviews() {
    document.getElementById('interviewTable').innerHTML = '<div class="loading">Loading…</div>';
    const r = await req('GET', '/interviews/');
    if (!r?.ok) {
        document.getElementById('interviewTable').innerHTML = '<div class="empty">Could not load interviews.</div>';
        return;
    }
    const list = listOf(await r.json());
    const role = (ME.role_name || '').toLowerCase();
    const isAdminUser = role === 'admin' || role === 'hr';

    if (!list.length) {
        document.getElementById('interviewTable').innerHTML = '<div class="empty">No interviews scheduled yet.</div>';
        return;
    }

    let h = '';
    if (isAdminUser) {
        const pendingCount = list.filter(i => !i.email_sent).length;
        h += `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
            <div style="font-size:13px;color:var(--muted)">
                ${pendingCount > 0
                ? `<span style="color:#d97706;font-weight:600">⚠ ${pendingCount} email(s) not yet sent</span>`
                : '<span style="color:#16a34a;font-weight:600">✅ All emails sent</span>'}
            </div>
            <button id="sendAllBtn" class="btn-outline green" onclick="sendAllEmails('interviews')" ${pendingCount === 0 ? 'disabled' : ''}>
                📧 Send All Pending
            </button>
        </div>`;
    }

    h += `<table><thead><tr>
        <th>Candidate</th>
        <th>Requirement</th>
        <th>Score</th>
        ${isAdminUser ? '<th>Date &amp; Time</th><th>Venue</th><th>Email Sent</th>' : ''}
        <th>Status</th>
        ${isAdminUser ? '<th>Actions</th>' : ''}
    </tr></thead><tbody>`;

    list.forEach(i => {
        const scoreEl = i.screening_score !== null && i.screening_score !== undefined
            ? `<span style="font-weight:700;color:${i.screening_score >= 70 ? 'var(--success-mid)' : i.screening_score >= 40 ? 'var(--warn-mid)' : 'var(--error-mid)'}">${i.screening_score}%</span>`
            : '—';

        const statusBadge = {
            scheduled: '<span class="badge badge-pending">Scheduled</span>',
            completed: '<span class="badge badge-approved">Completed</span>',
            cancelled: '<span class="badge badge-rejected">Cancelled</span>',
        }[i.status] || i.status;

        const dateStr = isAdminUser && i.scheduled_at
            ? new Date(i.scheduled_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '';

        const emailChip = i.email_sent
            ? '<span class="badge badge-approved">✓ Sent</span>'
            : '<span class="badge badge-inactive">Not sent</span>';

        h += `<tr>
            <td style="font-weight:600">${i.candidate_name}</td>
            <td style="color:var(--sub)">${i.requirement_title || '—'}</td>
            <td>${scoreEl}</td>
            ${isAdminUser ? `<td style="color:var(--sub);font-size:12.5px">${dateStr}</td><td style="color:var(--sub);font-size:12.5px">${i.venue || '—'}</td><td>${emailChip}</td>` : ''}
            <td>${statusBadge}</td>
            ${isAdminUser ? `<td>
                <button class="btn-outline green" onclick="sendInterviewEmail(${i.id}, 'interviews')">📧 Resend</button>
                <button class="btn-outline red"   onclick="cancelInterview(${i.id})">Cancel</button>
            </td>` : ''}
        </tr>`;
    });

    h += '</tbody></table>';
    document.getElementById('interviewTable').innerHTML = h;
}

async function sendInterviewEmail(id, source = 'interviews') {
    if (!confirm('Resend interview invite email to this candidate?')) return;
    const r = await req('POST', `/interviews/${id}/send-email/`, {});
    if (r?.ok) {
        toast('Email sent!');
        if (source === 'home') loadHomeStats();
        else loadInterviews();
    } else toast('Failed to send email', 'err');
}

async function sendAllEmails(source = 'interviews') {
    if (!confirm('Send emails to all candidates where email is not sent?')) return;

    const btnId = source === 'home' ? 'sendAllBtnHome' : 'sendAllBtn';
    const btn = document.getElementById(btnId);
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    const r = await req('POST', '/interviews/send-all-emails/', {});
    if (r?.ok) {
        const data = await r.json();
        toast(`✅ Sent: ${data.success} | ❌ Failed: ${data.failed}`);
        if (source === 'home') loadHomeStats();
        else loadInterviews();
    } else {
        toast('Failed to send emails', 'err');
        if (btn) { btn.disabled = false; btn.textContent = '📧 Send All Pending'; }
    }
}

async function cancelInterview(id) {
    if (!confirm('Cancel this interview?')) return;
    const r = await req('DELETE', `/interviews/${id}/`);
    if (r?.ok) { toast('Interview cancelled'); loadInterviews(); }
    else toast('Failed', 'err');
}

/* =============================================
   LOGOUT
============================================= */
async function handleLogout() {
    await req('POST', '/auth/logout/', { refresh: localStorage.getItem('refresh') });
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/api/login-page/?signedout=1';
}