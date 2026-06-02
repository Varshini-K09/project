const API = '/api';
let allJobs = [], selectedId = null;

// ── Auth guard ──────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('access');
  const stored = localStorage.getItem('employee');
  if (!token || !stored) {
    window.location.href = '/api/login-page/';
    return;
  }
  const me = JSON.parse(stored);
  document.getElementById('navUser').textContent = me.emp_name || '';
  loadJobs();
});

// ── Authenticated fetch helper ──────────────────────────────────────────
async function authFetch(url) {
  const token = localStorage.getItem('access');
  let res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access')}`
        }
      });
    } else {
      handleLogout();
      return null;
    }
  }

  if (res.status === 401 || res.status === 403) {
    handleLogout();
    return null;
  }

  return res;
}

async function tryRefresh() {
  const r = localStorage.getItem('refresh');
  if (!r) return false;
  try {
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
  } catch {
    return false;
  }
}

// ── Load jobs ───────────────────────────────────────────────────────────
async function loadJobs() {
  try {
    const res = await authFetch(`${API}/jobs/`);
    if (!res) return;
    if (!res.ok) { showListState('Could not load positions.'); return; }

    const data = await res.json();
    allJobs = Array.isArray(data) ? data : (data.results || []);

    const depts = [...new Set(allJobs.map(j => j.department_name).filter(Boolean))];
    const df = document.getElementById('deptFilters');
    depts.forEach(d => {
      const lbl = document.createElement('label');
      lbl.className = 'filter-option';
      lbl.innerHTML = `<input type="radio" name="dept" value="${d}" onchange="filterJobs()"> ${d}`;
      df.appendChild(lbl);
    });

    filterJobs();
  } catch {
    showListState('Server connection failed.');
  }
}

function filterJobs() {
  const search   = document.getElementById('searchInput').value.toLowerCase();
  const dept     = document.querySelector('input[name="dept"]:checked')?.value || '';
  const workmode = document.querySelector('input[name="workmode"]:checked')?.value || '';
  const emptype  = document.querySelector('input[name="emptype"]:checked')?.value || '';

  const filtered = allJobs.filter(j => {
    const hay = [j.requirement_title, j.department_name, j.location, j.work_mode, j.employment_type, ...(j.skills||[]).map(s=>s.skill_name)].join(' ').toLowerCase();
    return (
      (!search   || hay.includes(search)) &&
      (!dept     || (j.department_name === dept)) &&
      (!workmode || (j.work_mode||'').toLowerCase() === workmode.toLowerCase()) &&
      (!emptype  || (j.employment_type||'').toLowerCase() === emptype.toLowerCase())
    );
  });

  const cnt = `${filtered.length} open position${filtered.length !== 1 ? 's' : ''}`;
  document.getElementById('listCount').textContent = cnt;
  document.getElementById('navCount').textContent  = cnt;

  if (!filtered.length) { showListState('No positions match your filters.'); return; }

  document.getElementById('jobList').innerHTML = filtered.map(j => `
    <div class="job-item ${j.id === selectedId ? 'selected' : ''}" id="item-${j.id}" onclick="selectJob(${j.id})">
      <div class="job-item-top">
        <div class="job-item-title">${j.requirement_title || 'Open Position'}</div>
        <span class="job-item-dept">${j.department_name || 'General'}</span>
      </div>
      <div class="job-item-meta">
        ${j.location         ? `<span class="meta-item">${iPin()}${j.location}</span>` : ''}
        ${j.employment_type  ? `<span class="meta-item">${iBag()}${j.employment_type}</span>` : ''}
        ${j.work_mode        ? `<span class="meta-item">${iScreen()}${j.work_mode}</span>` : ''}
        ${j.salary_range     ? `<span class="meta-item">${iCoin()}${j.salary_range}</span>` : ''}
        ${j.experience_required ? `<span class="meta-item">${iStar()}${j.experience_required}</span>` : ''}
        ${j.vacancies        ? `<span class="meta-item">${iPeople()}${j.vacancies} opening${j.vacancies !== 1 ? 's' : ''}</span>` : ''}
      </div>
      ${(j.skills||[]).length ? `<div class="job-item-skills">${j.skills.slice(0,5).map(s=>`<span class="skill-pill">${s.skill_name}</span>`).join('')}${j.skills.length > 5 ? `<span class="skill-pill">+${j.skills.length-5}</span>` : ''}</div>` : ''}
    </div>
  `).join('');

  if (!selectedId || !filtered.find(j => j.id === selectedId)) {
    if (filtered.length) selectJob(filtered[0].id);
  }
}

async function selectJob(id) {
  document.querySelectorAll('.job-item').forEach(el => el.classList.remove('selected'));
  const el = document.getElementById(`item-${id}`);
  if (el) { el.classList.add('selected'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  selectedId = id;

  document.getElementById('detailPanel').innerHTML = `<div class="detail-empty"><div class="spinner" style="width:22px;height:22px;border:2.5px solid #e5e7eb;border-top-color:#1d4ed8;border-radius:50%;animation:spin 0.7s linear infinite;margin:0 auto 14px"></div><p>Loading…</p></div>`;

  try {
    const res = await authFetch(`${API}/jobs/${id}/`);
    if (!res) return;
    if (!res.ok) { showDetailError(); return; }
    renderDetail(await res.json());
  } catch {
    showDetailError();
  }
}

function renderDetail(j) {
  document.getElementById('detailPanel').innerHTML = `
    <div class="detail-header">
      <div class="detail-dept-badge">${j.department_name || 'General'}</div>
      <div class="detail-title">${j.requirement_title || 'Open Position'}</div>
      <div class="detail-info-grid">
        ${j.location          ? `<div class="info-box"><div class="info-box-label">Location</div><div class="info-box-value">${iPin()}${j.location}</div></div>` : ''}
        ${j.employment_type   ? `<div class="info-box"><div class="info-box-label">Employment</div><div class="info-box-value">${iBag()}${j.employment_type}</div></div>` : ''}
        ${j.work_mode         ? `<div class="info-box"><div class="info-box-label">Work Mode</div><div class="info-box-value">${iScreen()}${j.work_mode}</div></div>` : ''}
        ${j.salary_range      ? `<div class="info-box"><div class="info-box-label">Salary Range</div><div class="info-box-value">${iCoin()}${j.salary_range}</div></div>` : ''}
        ${j.experience_required ? `<div class="info-box"><div class="info-box-label">Experience</div><div class="info-box-value">${iStar()}${j.experience_required}</div></div>` : ''}
      </div>
    </div>
    <div class="detail-body">
      ${j.vacancies ? `<div class="detail-section"><div class="vacancies-row"><span style="font-size:18px">✅</span><span class="vacancies-text">${j.vacancies} open position${j.vacancies !== 1 ? 's' : ''} available</span></div></div>` : ''}
      ${j.skills && j.skills.length ? `<div class="detail-section"><div class="detail-section-title">Required Skills</div><div class="skills-wrap">${j.skills.map(s=>`<span class="skill-badge">${s.skill_name}</span>`).join('')}</div></div>` : ''}
      ${j.job_description ? `<div class="detail-section"><div class="detail-section-title">About the Role</div><div class="detail-description">${j.job_description}</div></div>` : ''}
    </div>
    <div class="detail-footer">Internal listing · Synergy Recruitment · Visible to employees only</div>
  `;
}

function showDetailError() {
  document.getElementById('detailPanel').innerHTML = '<div class="detail-empty"><p>Could not load job details.</p></div>';
}

function showListState(msg) {
  document.getElementById('jobList').innerHTML = `<div class="state-box">${msg}</div>`;
  document.getElementById('listCount').textContent = '0 positions';
  document.getElementById('navCount').textContent = '';
}

function resetFilters() {
  document.querySelectorAll('input[name="dept"]')[0].checked = true;
  document.querySelectorAll('input[name="workmode"]')[0].checked = true;
  document.querySelectorAll('input[name="emptype"]')[0].checked = true;
  document.getElementById('searchInput').value = '';
  filterJobs();
}

// ── Logout ──────────────────────────────────────────────────────────────
async function handleLogout() {
  try {
    const token = localStorage.getItem('access');
    const refresh = localStorage.getItem('refresh');
    if (token && refresh) {
      await fetch(`${API}/auth/logout/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ refresh })
      });
    }
  } catch { /* ignore errors, clear anyway */ }
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = '/api/login-page/?signedout=1';
}

// ── SVG icons ───────────────────────────────────────────────────────────
function iPin()    { return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="13" height="13"><path d="M8 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M8 15s-5-4.686-5-8a5 5 0 0 1 10 0c0 3.314-5 8-5 8z"/></svg>`; }
function iBag()    { return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="13" height="13"><rect x="1" y="5" width="14" height="9" rx="1.5"/><path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2h3A1.5 1.5 0 0 1 11 3.5V5"/></svg>`; }
function iScreen() { return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="13" height="13"><rect x="1" y="2" width="14" height="9" rx="1.5"/><path d="M5 14h6M8 11v3"/></svg>`; }
function iCoin()   { return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="13" height="13"><circle cx="8" cy="8" r="6"/><path d="M8 5v6M6.5 6.5h2a1 1 0 1 1 0 2H7a1 1 0 1 1 0 2h2.5"/></svg>`; }
function iStar()   { return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="13" height="13"><path d="M8 1l1.8 3.6L14 5.4l-3 2.9.7 4.1L8 10.4 4.3 12.4l.7-4.1-3-2.9 4.2-.8z"/></svg>`; }
function iPeople() { return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="13" height="13"><circle cx="6" cy="5" r="2.5"/><path d="M1 13c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="12" cy="5" r="2"/><path d="M15 13c0-2.2-1.3-4-3-4.5"/></svg>`; }