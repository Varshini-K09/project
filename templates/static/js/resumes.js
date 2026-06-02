const API = '/api';
let ME = null, allReqs = [], selectedFile = null, selectedBulkFile = null;

window.addEventListener('DOMContentLoaded', async () => {
  const stored = localStorage.getItem('employee');
  if (!stored || !localStorage.getItem('access')) { window.location.href = '/api/login-page/'; return; }
  ME = JSON.parse(stored);

  const role = (ME.role_name || '').toLowerCase();
  // Only recruiters and admins can access this page
  if (role !== 'recruiter' && role !== 'admin' && role !== 'hr') {
    window.location.href = '/api/dashboard/';
    return;
  }

  document.getElementById('uAvatar').textContent = ME.emp_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('uName').textContent = ME.emp_name;
  document.getElementById('uEmail').textContent = ME.emp_email;
  document.getElementById('uRole').textContent = ME.role_name || '—';

  await loadRequirements();
  loadResumes();
});

// ── Auth fetch ──────────────────────────────────────────────────────────
async function apiFetch(method, path, body, isFormData = false) {
  const headers = {};
  const token = localStorage.getItem('access');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  const opts = { method, headers };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  let res = await fetch(`${API}${path}`, opts);
  if (res.status === 401) {
    if (await tryRefresh()) {
      headers['Authorization'] = `Bearer ${localStorage.getItem('access')}`;
      res = await fetch(`${API}${path}`, { ...opts, headers });
    } else { handleLogout(); return null; }
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

// ── Helpers ──────────────────────────────────────────────────────────────
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.classList.remove('show'), 3200);
}

function openOverlay(id) { document.getElementById(id).classList.add('open'); }
function closeOverlay(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.overlay').forEach(o =>
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); })
);

// ── Load requirements for filter + upload dropdown ──────────────────────
async function loadRequirements() {
  const r = await apiFetch('GET', '/requirements/');
  if (!r?.ok) return;
  allReqs = (await r.json()) || [];
  if (Array.isArray(allReqs.results)) allReqs = allReqs.results;

  const sel = document.getElementById('reqFilter');
  const uSel = document.getElementById('uReq');
  const bulkSel = document.getElementById('bulkReq');   // NEW

  sel.innerHTML = '<option value="">All Requirements</option>';
  uSel.innerHTML = '<option value="">— None —</option>';
  bulkSel.innerHTML = '<option value="">— Select requirement —</option>';  // NEW

  allReqs.forEach(req => {
    [sel, uSel, bulkSel].forEach(s => {   // NEW: added bulkSel
      const o = document.createElement('option');
      o.value = req.id;
      o.textContent = req.requirement_title + (req.department_name ? ` · ${req.department_name}` : '');
      s.appendChild(o);
    });
  });
}

// ── Load and render resumes table ────────────────────────────────────────
async function loadResumes() {
  document.getElementById('resumeTable').innerHTML = '<div class="loading">Loading…</div>';
  const reqId = document.getElementById('reqFilter').value;
  const path = reqId ? `/resumes/?requirement=${reqId}` : '/resumes/';
  const r = await apiFetch('GET', path);
  if (!r) return;
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    document.getElementById('resumeTable').innerHTML = `<div class="empty">Error: ${err.detail || r.status}</div>`;
    return;
  }
  const data = await r.json();
  const resumes = Array.isArray(data) ? data : (data.results || []);
  renderTable(resumes);
}

function scoreClass(score) {
  if (score === null || score === undefined) return 'score-none';
  if (score >= 70) return 'score-high';
  if (score >= 40) return 'score-mid';
  return 'score-low';
}

function renderTable(resumes) {
  if (!resumes.length) {
    document.getElementById('resumeTable').innerHTML = '<div class="empty">No resumes uploaded yet. Click <strong>Upload Resume</strong> to get started.</div>';
    return;
  }

  const isAdmin = ['admin', 'hr'].includes(ME.role_name?.toLowerCase());

  let h = `<table>
    <thead><tr>
      <th>Candidate</th>
      <th>Contact</th>
      <th>Requirement</th>
      <th>Resume</th>
      <th>Screening</th>
      <th>Uploaded</th>
      <th>Actions</th>
    </tr></thead><tbody>`;

  resumes.forEach(r => {
    const score = r.screening_result?.score;
    const done = r.screening_done;
    const scoreEl = done
      ? `<div class="score-ring ${scoreClass(score)}">${score}%</div>`
      : `<span class="badge badge-neutral">Pending</span>`;

    const date = new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    h += `<tr>
      <td>
        <div style="font-weight:600">${r.candidate_name}</div>
        ${r.notes ? `<div style="font-size:11.5px;color:var(--muted);margin-top:2px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.notes}</div>` : ''}
      </td>
      <td style="color:var(--sub)">
        ${r.candidate_email ? `<div style="font-size:12.5px">${r.candidate_email}</div>` : ''}
        ${r.candidate_phone ? `<div style="font-size:12px;color:var(--muted)">${r.candidate_phone}</div>` : ''}
      </td>
      <td>${r.requirement_title ? `<span class="req-badge" title="${r.requirement_title}">${r.requirement_title}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td>
  ${r.resume_url
        ? `<a class="pdf-link" href="#" onclick="viewPDF('${r.resume_url}','${r.candidate_name}'); return false;">📄 View PDF</a>`
        : `<span style="font-size:12px;color:var(--muted)">No file · Bulk screened</span>`
      }
</td>
      <td>${scoreEl}</td>
      <td style="color:var(--muted);font-size:12.5px">${date}<br><span style="font-size:11px">${r.uploaded_by_name || '—'}</span></td>
      <td>
        ${done
        ? `<button class="btn-outline" onclick="viewScreening(${r.id})">Details</button>`
        : (isAdmin
          ? `<button class="btn-outline" onclick="screenResume(${r.id}, this)">Screen</button>`
          : `<span style="font-size:12px;color:var(--muted)">Not screened</span>`)
      }
        ${isAdmin
        ? `<button class="btn-outline" onclick="openScheduleModal(${r.id}, '${r.candidate_name.replace(/'/g, "\\'")}', '${(r.requirement_title || '').replace(/'/g, "\\'")}')">Schedule</button>`
        : ''
      }
        <button class="btn-outline red" onclick="deleteResume(${r.id})">Remove</button>
      </td>
    </tr>`;
  });

  h += '</tbody></table>';
  document.getElementById('resumeTable').innerHTML = h;
}

async function screenResume(id, btn) {
  if (!confirm('Run AI screening for this resume? This may take a few seconds.')) return;
  btn.disabled = true;
  btn.textContent = 'Screening…';
  const r = await apiFetch('POST', `/resumes/${id}/screen/`);
  if (r?.ok) {
    toast('Screening complete!');
    loadResumes();
  } else {
    const err = await r?.json().catch(() => ({}));
    toast(err?.detail || 'Screening failed', 'err');
    btn.disabled = false;
    btn.textContent = 'Screen';
  }
}

// ── Single upload modal ──────────────────────────────────────────────────
function openUploadModal() {
  ['uCandName', 'uCandEmail', 'uCandPhone', 'uNotes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('uReq').value = '';
  selectedFile = null;
  document.getElementById('fileChosen').style.display = 'none';
  document.getElementById('dropZone').classList.remove('drag-over');
  openOverlay('uploadOverlay');
}

function handleDragOver(e) { e.preventDefault(); document.getElementById('dropZone').classList.add('drag-over'); }
function handleDragLeave() { document.getElementById('dropZone').classList.remove('drag-over'); }
function handleDrop(e) { e.preventDefault(); handleDragLeave(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }
function handleFileSelect(e) { const f = e.target.files[0]; if (f) setFile(f); }

function setFile(f) {
  if (f.type !== 'application/pdf') { toast('Only PDF files are allowed', 'err'); return; }
  if (f.size > 10 * 1024 * 1024) { toast('File too large (max 10 MB)', 'err'); return; }
  selectedFile = f;
  const el = document.getElementById('fileChosen');
  el.textContent = `✓ ${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
  el.style.display = 'block';
}

async function uploadResume() {
  const name = document.getElementById('uCandName').value.trim();
  const email = document.getElementById('uCandEmail').value.trim();
  const phone = document.getElementById('uCandPhone').value.trim();
  const reqId = document.getElementById('uReq').value;
  const notes = document.getElementById('uNotes').value.trim();

  if (!name) { toast('Candidate name is required', 'err'); return; }
  if (!selectedFile) { toast('Please select a PDF file', 'err'); return; }

  const btn = document.getElementById('uploadBtn');
  btn.innerHTML = '<span class="spinner-sm"></span> Uploading…';
  btn.disabled = true;

  const fd = new FormData();
  fd.append('candidate_name', name);
  fd.append('resume_file', selectedFile);
  if (email) fd.append('candidate_email', email);
  if (phone) fd.append('candidate_phone', phone);
  if (reqId) fd.append('requirement', reqId);
  if (notes) fd.append('notes', notes);

  const r = await apiFetch('POST', '/resumes/', fd, true);
  btn.innerHTML = 'Upload Resume';
  btn.disabled = false;

  if (!r) { toast('No response from server', 'err'); return; }

  if (r.ok) {
    toast('Resume uploaded successfully!');
    closeOverlay('uploadOverlay');
    loadResumes();
  } else {
    const err = await r.json().catch(() => ({}));
    const msg = Object.values(err).flat()[0] || `Upload failed (${r.status})`;
    toast(msg, 'err');
  }
}

// ── Bulk upload modal (NEW) ───────────────────────────────────────────────
function openBulkModal() {
  selectedBulkFile = null;
  document.getElementById('bulkReq').value = '';
  document.getElementById('bulkFileInput').value = '';
  document.getElementById('bulkFileChosen').style.display = 'none';
  document.getElementById('bulkDropZone').classList.remove('drag-over');
  setBulkStatus('', '');
  document.getElementById('bulkUploadBtn').disabled = false;
  document.getElementById('bulkUploadBtn').textContent = 'Upload & Screen All';
  document.getElementById('bulkCancelBtn').textContent = 'Cancel';
  openOverlay('bulkOverlay');
}

function handleBulkDragOver(e) { e.preventDefault(); document.getElementById('bulkDropZone').classList.add('drag-over'); }
function handleBulkDragLeave() { document.getElementById('bulkDropZone').classList.remove('drag-over'); }
function handleBulkDrop(e) { e.preventDefault(); handleBulkDragLeave(); const f = e.dataTransfer.files[0]; if (f) setBulkFile(f); }
function handleBulkFileSelect(e) { const f = e.target.files[0]; if (f) setBulkFile(f); }

function setBulkFile(f) {
  if (!f.name.toLowerCase().endsWith('.zip')) { toast('Please select a .zip file', 'err'); return; }
  selectedBulkFile = f;
  const el = document.getElementById('bulkFileChosen');
  el.textContent = `✓ ${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
  el.style.display = 'block';
  setBulkStatus('', '');
}

function setBulkStatus(html, type) {
  const el = document.getElementById('bulkStatus');
  if (!html) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const colours = {
    info: 'background:var(--indigo-light);border:1px solid var(--indigo-border);color:var(--indigo-dark)',
    success: 'background:#f0fdf4;border:1px solid #bbf7d0;color:#166534',
    error: 'background:#fef2f2;border:1px solid #fecaca;color:#991b1b',
    warn: 'background:#fffbeb;border:1px solid #fde68a;color:#92400e',
  };
  el.style.cssText = (colours[type] || colours.info) + ';padding:12px 14px;border-radius:var(--radius-md);font-size:13px;line-height:1.7';
  el.style.display = 'block';
  el.innerHTML = html;
}

async function uploadBulk() {
  const reqId = document.getElementById('bulkReq').value;
  if (!reqId) { toast('Please select a requirement', 'err'); return; }
  if (!selectedBulkFile) { toast('Please select a ZIP file', 'err'); return; }

  const btn = document.getElementById('bulkUploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Processing…';
  setBulkStatus('⏳ Uploading ZIP and screening resumes — this may take a moment…', 'info');

  const fd = new FormData();
  fd.append('requirement', reqId);
  fd.append('zip_file', selectedBulkFile);

  const r = await apiFetch('POST', '/resumes/bulk-upload/', fd, true);

  btn.disabled = false;
  btn.textContent = 'Upload & Screen All';

  if (!r) { setBulkStatus('No response from server.', 'error'); return; }

  const data = await r.json().catch(() => ({}));

  if (r.ok || r.status === 207) {
    const processed = data.processed || 0;
    const failed = data.failed || 0;

    // Build per-file summary rows
    const rows = (data.results || []).map(res =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.05)">
        <span style="font-weight:500">${res.candidate_name || '—'}</span>
        <span style="font-size:12px;color:var(--muted)">${res.file?.split('/').pop()}</span>
        <span class="score-ring ${scoreClass(res.score)}" style="width:36px;height:36px;font-size:12px">${res.score ?? '—'}%</span>
      </div>`
    ).join('');

    const errRows = (data.errors || []).map(e =>
      `<div style="color:#b91c1c;font-size:12px;padding:3px 0">✗ ${e.file} — ${e.error}</div>`
    ).join('');

    const type = failed > 0 ? 'warn' : 'success';
    setBulkStatus(
      `<strong>✓ ${processed} resume${processed !== 1 ? 's' : ''} processed${failed ? `, ${failed} failed` : ''}.</strong>
      <div style="margin-top:10px">${rows}</div>
      ${errRows ? `<div style="margin-top:8px">${errRows}</div>` : ''}`,
      type
    );

    document.getElementById('bulkCancelBtn').textContent = 'Close';
    loadResumes();   // refresh the main table

    if (processed > 0) toast(`${processed} resume${processed !== 1 ? 's' : ''} uploaded & screened!`);
  } else {
    setBulkStatus(`Error: ${data.error || data.detail || `Server returned ${r.status}`}`, 'error');
  }
}

// ── PDF viewer ───────────────────────────────────────────────────────────
function viewPDF(url, name) {
  document.getElementById('pdfModalTitle').textContent = `Resume – ${name}`;
  document.getElementById('pdfFrame').src = url;
  document.getElementById('pdfDownloadLink').href = url;
  openOverlay('pdfOverlay');
}

// ── Screening details modal ───────────────────────────────────────────────
async function viewScreening(id) {
  const r = await apiFetch('GET', `/resumes/${id}/`);
  if (!r?.ok) { toast('Could not load details', 'err'); return; }
  const resume = await r.json();
  const result = resume.screening_result;
  if (!result) { toast('No screening result available', 'err'); return; }

  const scoreClass2 = result.score >= 70 ? 'score-high' : result.score >= 40 ? 'score-mid' : 'score-low';
  const matchedHtml = (result.matched || []).map(s => `<span class="chip chip-green">✓ ${s}</span>`).join('');
  const missingHtml = (result.missing || []).map(s => `<span class="chip chip-red">✗ ${s}</span>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-title">Screening Result – ${resume.candidate_name}</div>
      <div style="text-align:center;margin-bottom:20px">
        <div class="score-ring ${scoreClass2}" style="width:72px;height:72px;font-size:20px;margin:0 auto 8px">${result.score}%</div>
        <div style="font-size:13px;color:var(--sub)">Match Score</div>
      </div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px 18px;margin-bottom:16px;font-size:13.5px;color:var(--sub);line-height:1.7">
        ${result.summary || 'No summary available.'}
      </div>
      ${matchedHtml ? `<div style="margin-bottom:14px"><div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px">Matched Skills</div>${matchedHtml}</div>` : ''}
      ${missingHtml ? `<div><div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px">Missing Skills</div>${missingHtml}</div>` : ''}
      <div class="modal-actions">
        <button class="btn-ghost">Close</button>
        <a href="${resume.resume_url}" target="_blank" class="btn btn-primary" style="text-decoration:none">📄 View PDF</a>
      </div>
    </div>`;
  overlay.querySelector('.btn-ghost').onclick = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
  document.body.appendChild(overlay);
}

// ── Interview scheduling ─────────────────────────────────────────────────
function openScheduleModal(resumeId, candidateName, reqTitle) {
  document.getElementById('sResumeId').value = resumeId;
  document.getElementById('sCandName').value = candidateName;
  document.getElementById('sReqTitle').value = reqTitle || '—';
  document.getElementById('sDateTime').value = '';
  document.getElementById('sVenue').value = '';
  document.getElementById('sNotes').value = '';
  document.getElementById('sSendEmail').checked = true;
  openOverlay('scheduleOverlay');
}

async function saveInterview() {
  const resumeId = document.getElementById('sResumeId').value;
  const dateTime = document.getElementById('sDateTime').value;
  const venue = document.getElementById('sVenue').value.trim();
  const notes = document.getElementById('sNotes').value.trim();
  const sendEmail = document.getElementById('sSendEmail').checked;

  if (!dateTime) { toast('Please select a date and time', 'err'); return; }

  const btn = document.getElementById('saveInterviewBtn');
  btn.disabled = true;
  btn.textContent = 'Scheduling…';

  const r = await apiFetch('POST', '/interviews/', {
    resume: resumeId,
    scheduled_at: new Date(dateTime).toISOString(),
    venue: venue || null,
    interviewer_notes: notes || null,
    send_email: sendEmail,
  });

  btn.disabled = false;
  btn.textContent = 'Schedule Interview';

  if (r?.ok) {
    const data = await r.json();
    let msg = 'Interview scheduled!';
    if (sendEmail && data.email_sent) msg += ' Email sent to Mailinator.';
    toast(msg);
    closeOverlay('scheduleOverlay');
  } else {
    const err = await r?.json().catch(() => ({}));
    toast(Object.values(err).flat()[0] || 'Scheduling failed', 'err');
  }
}

// ── Delete ───────────────────────────────────────────────────────────────
async function deleteResume(id) {
  if (!confirm('Remove this resume?')) return;
  const r = await apiFetch('DELETE', `/resumes/${id}/`);
  if (r?.ok) { toast('Resume removed'); loadResumes(); }
  else toast('Failed to remove', 'err');
}

// ── Logout ───────────────────────────────────────────────────────────────
async function handleLogout() {
  await apiFetch('POST', '/auth/logout/', { refresh: localStorage.getItem('refresh') });
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = '/api/login-page/?signedout=1';
}