const API = '/api';
let ME = null, allReqs = [], selectedFile = null, selectedBulkFile = null;

window.addEventListener('DOMContentLoaded', async () => {
  const stored = localStorage.getItem('employee');
  if (!stored || !localStorage.getItem('access')) { window.location.href = '/api/login-page/'; return; }
  ME = JSON.parse(stored);

  const role = (ME.role_name || '').toLowerCase();
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

async function loadRequirements() {
  const r = await apiFetch('GET', '/requirements/');
  if (!r?.ok) return;
  allReqs = (await r.json()) || [];
  if (Array.isArray(allReqs.results)) allReqs = allReqs.results;

  const sel = document.getElementById('reqFilter');
  const uSel = document.getElementById('uReq');
  const spSel = document.getElementById('spReq');
  const jdReqSel = document.getElementById('jdReq');

  sel.innerHTML = '<option value="">All Requirements</option>';
  uSel.innerHTML = '<option value="">— None —</option>';
  spSel.innerHTML = '<option value="">— Select requirement —</option>';
  jdReqSel.innerHTML = '<option value="">— Select requirement —</option>';

  allReqs.forEach(req => {
    [sel, uSel, spSel, jdReqSel].forEach(s => {
      const o = document.createElement('option');
      o.value = req.id;
      o.textContent = req.requirement_title + (req.department_name ? ` · ${req.department_name}` : '');
      s.appendChild(o);
    });
  });
}

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
    const extractionFailed = r.screening_result?.extraction_failed;

    const scoreEl = extractionFailed
      ? `<span class="badge badge-warn" title="PDF could not be read — please upload a text-based PDF">⚠ PDF unreadable</span>`
      : done
        ? `<div class="score-ring ${scoreClass(score)}">${score}%</div>`
        : `<span class="badge badge-neutral">Pending</span>`;

    const date = new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    const screeningAction = (done && !extractionFailed)
      ? `<button class="btn-outline" onclick="viewScreening(${r.id})">Details</button>`
      : (isAdmin
        ? `<button class="btn-outline" onclick="screenResume(${r.id}, this)">${extractionFailed ? 'Retry' : 'Screen'}</button>`
        : `<span style="font-size:12px;color:var(--muted)">Not screened</span>`);

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
  <div style="display:flex;flex-direction:column;gap:5px">
    ${r.resume_url
        ? `<a class="pdf-link" href="#"
            title="View local PDF"
            onclick="viewPDF('${r.resume_url}','${r.candidate_name}'); return false;"
            style="display:inline-flex;align-items:center;gap:4px">
            🖥️ <span>view pdf</span>
         </a>`
        : ''
      }
    ${r.sharepoint_url
        ? `<a class="pdf-link" href="#"
            title="View from SharePoint"
            onclick="viewPDF('${r.sharepoint_url}','${r.candidate_name}'); return false;"
            style="display:inline-flex;align-items:center;gap:4px;color:#0078d4">
            ☁️ <span>view pdf</span>
         </a>`
        : ''
      }
    ${!r.resume_url && !r.sharepoint_url
        ? `<span style="font-size:12px;color:var(--muted)">No file</span>`
        : ''
      }
  </div>
</td>
      <td>${scoreEl}</td>
      <td style="color:var(--muted);font-size:12.5px">${date}<br><span style="font-size:11px">${r.uploaded_by_name || '—'}</span></td>
      <td>
        ${screeningAction}
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

function openBulkModal() {
  selectedBulkFile = null;
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

  if (!selectedBulkFile) { toast('Please select a ZIP file', 'err'); return; }

  const btn = document.getElementById('bulkUploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Processing…';
  setBulkStatus('⏳ Uploading ZIP and screening resumes — this may take a moment…', 'info');

  const fd = new FormData();
  fd.append('zip_file', selectedBulkFile);

  const r = await apiFetch('POST', '/resumes/bulk-upload/', fd, true);

  btn.disabled = false;
  btn.textContent = 'Upload & Screen All';

  if (!r) { setBulkStatus('No response from server.', 'error'); return; }

  const data = await r.json().catch(() => ({}));

  if (r.ok || r.status === 207) {
    const processed = data.processed || 0;
    const failed = data.failed || 0;

    const rows = (data.results || []).map(res =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.05)">
    <span style="font-weight:500">${res.candidate_name || '—'}</span>
    <span style="font-size:12px;color:var(--muted)">${res.file?.split('/').pop()}</span>
    <span style="font-size:12px;color:var(--muted);font-style:italic">Pending JD Screen</span>
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
    loadResumes();

    if (processed > 0) toast(`${processed} resume${processed !== 1 ? 's' : ''} uploaded & screened!`);
  } else {
    setBulkStatus(`Error: ${data.error || data.detail || `Server returned ${r.status}`}`, 'error');
  }
}

function openJDScreenModal() {
  document.getElementById('jdReq').value = '';
  document.getElementById('jdTopN').value = '15';
  document.getElementById('jdThreshold').value = '75';

  const resultsEl = document.getElementById('jdResults');
  resultsEl.style.display = 'none';
  resultsEl.innerHTML = '';

  document.getElementById('jdScreenBtn').disabled = false;
  document.getElementById('jdScreenBtn').textContent = '🔍 Fetch & Screen';
  openOverlay('jdScreenOverlay');
}

async function runJDScreen() {
  const reqId = document.getElementById('jdReq').value;
  const topN = parseInt(document.getElementById('jdTopN').value) || 15;
  const threshold = parseInt(document.getElementById('jdThreshold').value) || 75;

  if (!reqId) { toast('Please select a requirement', 'err'); return; }
  const btn = document.getElementById('jdScreenBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Searching & screening…';

  const resultsEl = document.getElementById('jdResults');
  resultsEl.style.cssText = `
    display:block;margin-top:14px;padding:12px 14px;border-radius:var(--radius-md);
    background:var(--indigo-light);border:1px solid var(--indigo-border);
    color:var(--indigo-dark);font-size:13px;line-height:1.8
  `;
  resultsEl.innerHTML = '<span class="spinner-sm"></span>&nbsp; Embedding JD and querying ChromaDB — this may take 20–40 seconds…';

  const r = await apiFetch('POST', '/resumes/fetch-and-screen/', {
    requirement: parseInt(reqId),
    top_n: topN,
    score_threshold: threshold,
  });

  btn.disabled = false;
  btn.textContent = '🔍 Fetch & Screen';

  if (!r) {
    resultsEl.style.cssText = `
      display:block;margin-top:14px;padding:12px 14px;border-radius:var(--radius-md);
      background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:13px;line-height:1.8
    `;
    resultsEl.innerHTML = '<strong>Error:</strong> No response from server.';
    return;
  }

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    resultsEl.style.cssText = `
      display:block;margin-top:14px;padding:12px 14px;border-radius:var(--radius-md);
      background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:13px;line-height:1.8
    `;
    resultsEl.innerHTML = `<strong>Error:</strong> ${data.error || data.detail || `Server returned ${r.status}`}`;
    return;
  }

  const results = data.results || [];
  const screened = data.screened || 0;
  const note = data.note || '';

  if (!results.length) {
    resultsEl.style.cssText = `
      display:block;margin-top:14px;padding:12px 14px;border-radius:var(--radius-md);
      background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:13px;line-height:1.8
    `;
    resultsEl.innerHTML = `<strong>No resumes found</strong> in ChromaDB for this requirement.<br>
      Upload resumes first via <strong>Bulk Upload ZIP</strong> or <strong>Upload Resume</strong>.`;
    return;
  }

  results.sort((a, b) => (b.score || 0) - (a.score || 0));

  const aboveThreshold = results.filter(res => res.above_threshold);
  const below = results.filter(res => !res.above_threshold);

  function scoreFg(s) {
    if (s >= 70) return '#166534';
    if (s >= 40) return '#92400e';
    return '#991b1b';
  }
  function scoreBg(s) {
    if (s >= 70) return '#f0fdf4';
    if (s >= 40) return '#fffbeb';
    return '#fef2f2';
  }
  function recBadge(rec) {
    if (!rec) return 'background:#f1f5f9;color:#475569';
    const rv = rec.toLowerCase();
    if (rv.includes('strong yes')) return 'background:#dcfce7;color:#166534';
    if (rv.includes('yes')) return 'background:#d1fae5;color:#065f46';
    if (rv.includes('maybe')) return 'background:#fef3c7;color:#92400e';
    return 'background:#fee2e2;color:#991b1b';
  }

  function buildRow(res) {
    const score = res.score ?? 0;
    const rec = res.hiring_recommendation || '—';
    const summ = res.summary || '';
    return `
      <div style="background:#fff;border:0.5px solid #e2e8f0;border-radius:var(--radius-md);
                  padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="font-weight:600;font-size:13.5px;color:#1e293b">${res.candidate_name || '—'}</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;
                         font-weight:700;background:${scoreBg(score)};color:${scoreFg(score)};
                         min-width:44px;text-align:center">${score}%</span>
            <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;
                         font-weight:600;${recBadge(rec)}">${rec}</span>
            <span style="font-size:11px;color:#94a3b8">Stage: ${res.current_stage || '—'}</span>
          </div>
        </div>
        ${summ ? `<div style="margin-top:6px;font-size:12.5px;color:#64748b;line-height:1.6">${summ}</div>` : ''}
        ${res.above_threshold
        ? `<div style="margin-top:8px;font-size:11.5px;color:#0f6e56;font-weight:500">
               ✓ Above threshold (${threshold}%) — drag to <strong>Shortlisted</strong> in Kanban to send to SharePoint
             </div>`
        : `<div style="margin-top:6px;font-size:11.5px;color:#94a3b8">Below threshold</div>`
      }
      </div>`;
  }

  let html = `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;
                padding:10px 14px;border-radius:var(--radius-md);margin-bottom:12px;font-size:13px">
      <strong>✓ ${screened} resume${screened !== 1 ? 's' : ''} screened</strong>
      from ${data.retrieved || 0} retrieved. Scores saved to database.
    </div>
    ${note ? `<div style="font-size:12px;color:#64748b;margin-bottom:10px;line-height:1.6">${note}</div>` : ''}
  `;

  if (aboveThreshold.length) {
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
                          color:#0f6e56;margin-bottom:6px">⭐ Above threshold — ${aboveThreshold.length} candidate${aboveThreshold.length !== 1 ? 's' : ''}</div>`;
    html += aboveThreshold.map(buildRow).join('');
  }

  if (below.length) {
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
                          color:#94a3b8;margin:12px 0 6px">Below threshold — ${below.length}</div>`;
    html += below.map(buildRow).join('');
  }

  resultsEl.style.cssText = 'display:block;margin-top:4px';
  resultsEl.innerHTML = html;

  loadResumes();
}

async function viewPDF(url, name) {
  document.getElementById('pdfModalTitle').textContent = `Resume – ${name}`;
  document.getElementById('pdfFrame').src = '';
  openOverlay('pdfOverlay');

  const token = localStorage.getItem('access');
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) { toast('Unauthorized or file not found', 'err'); return; }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  document.getElementById('pdfFrame').src = blobUrl;
  document.getElementById('pdfDownloadLink').href = blobUrl;
  document.getElementById('pdfDownloadLink').download = `${name}.pdf`;
}

async function viewScreening(id) {
  const r = await apiFetch('GET', `/resumes/${id}/`);
  if (!r?.ok) { toast('Could not load details', 'err'); return; }
  const resume = await r.json();
  const result = resume.screening_result;
  if (!result) { toast('No screening result available', 'err'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'overlay open';

  if (result.extraction_failed) {
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">Screening Result – ${resume.candidate_name}</div>
        <div style="background:#fef3c7;border:1px solid #fde68a;color:#92400e;
                    padding:14px 16px;border-radius:8px;font-size:13.5px;line-height:1.7;margin-bottom:16px">
          ⚠ <strong>PDF could not be read.</strong><br>${result.summary}
        </div>
        <div style="font-size:12.5px;color:var(--muted);line-height:1.6">
          Please ask the candidate to provide a text-based (non-scanned) PDF,
          then use the <strong>Retry</strong> button on the resume list to re-screen.
        </div>
        <div class="modal-actions">
          <button class="btn-ghost">Close</button>
          ${resume.resume_url ? `<a href="${resume.resume_url}" target="_blank" class="btn btn-primary" style="text-decoration:none">📄 View PDF</a>` : ''}
        </div>
      </div>`;
    overlay.querySelector('.btn-ghost').onclick = () => document.body.removeChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
    return;
  }

  const scoreVal = result.score ?? 0;
  const scorecls = scoreVal >= 70 ? 'score-high' : scoreVal >= 40 ? 'score-mid' : 'score-low';
  const rec = result.hiring_recommendation || '—';

  const skills = result.skills || {};
  const matchedSkills = result.matched?.length ? result.matched : [
    ...(skills.matched_exact || []),
    ...(skills.matched_partial || []),
    ...(skills.matched_demonstrated || []),
  ];
  const missingSkills = result.missing?.length ? result.missing : [
    ...(skills.missing_critical || []),
    ...(skills.missing_minor || []),
  ];
  const bonusSkills = skills.bonus_skills || [];

  const matchedHtml = matchedSkills.map(s => `<span class="chip chip-green">✓ ${s}</span>`).join('');
  const missingHtml = missingSkills.map(s => `<span class="chip chip-red">✗ ${s}</span>`).join('');
  const bonusHtml = bonusSkills.map(s => `<span class="chip chip-blue">＋ ${s}</span>`).join('');

  const expVerdict = result.experience_verdict;
  const expHtml = expVerdict ? `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:120px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">Required Exp.</div>
        <div style="font-size:14px;font-weight:600">${expVerdict.required || '—'}</div>
      </div>
      <div style="flex:1;min-width:120px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">Actual Exp.</div>
        <div style="font-size:14px;font-weight:600">${expVerdict.actual || '—'}</div>
      </div>
      <div style="flex:1;min-width:120px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">Meets Req.</div>
        <div style="font-size:14px;font-weight:600">${expVerdict.meets_requirement ? '✅ Yes' : '❌ No'}</div>
      </div>
    </div>` : '';

  const depth = result.depth_assessment;
  const depthHtml = depth ? `
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:16px;font-size:13px;line-height:1.8">
      <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px">Depth Assessment</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px">
        <div><span style="color:var(--muted)">Seniority:</span> <strong>${depth.seniority_level_inferred || '—'}</strong></div>
        <div><span style="color:var(--muted)">Achievements:</span> <strong>${depth.achievement_quality || '—'}</strong></div>
        <div><span style="color:var(--muted)">Complexity:</span> <strong>${depth.project_complexity || '—'}</strong></div>
      </div>
      ${depth.ownership_signals ? `<div style="margin-top:8px;color:var(--sub);font-size:12.5px">${depth.ownership_signals}</div>` : ''}
    </div>` : '';

  const align = result.role_alignment;
  const alignHtml = align ? `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:100px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">Title Match</div>
        <div style="font-size:13px;font-weight:600">${align.title_match || '—'}</div>
      </div>
      <div style="flex:1;min-width:100px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">Industry</div>
        <div style="font-size:13px;font-weight:600">${align.industry_relevance || '—'}</div>
      </div>
      <div style="flex:1;min-width:100px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">Trajectory</div>
        <div style="font-size:13px;font-weight:600">${align.career_trajectory || '—'}</div>
      </div>
    </div>` : '';

  const redFlags = result.red_flags || [];
  const posSigs = result.positive_signals || [];
  const flagsHtml = redFlags.length
    ? `<div style="margin-bottom:14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px">Red Flags</div>
        ${redFlags.map(f => `<div style="font-size:13px;color:#b91c1c;padding:2px 0">⚑ ${f}</div>`).join('')}
       </div>` : '';
  const posHtml = posSigs.length
    ? `<div style="margin-bottom:14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px">Positive Signals</div>
        ${posSigs.map(s => `<div style="font-size:13px;color:#166534;padding:2px 0">★ ${s}</div>`).join('')}
       </div>` : '';

  overlay.innerHTML = `
    <div class="modal" style="max-height:90vh;overflow-y:auto">
      <div class="modal-title">Screening Result – ${resume.candidate_name}</div>
      <div style="display:flex;align-items:center;gap:20px;margin-bottom:20px">
        <div style="text-align:center">
          <div class="score-ring ${scorecls}" style="width:72px;height:72px;font-size:20px;margin:0 auto 6px">${scoreVal}%</div>
          <div style="font-size:12px;color:var(--sub)">Match Score</div>
        </div>
        <div style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 16px">
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">Hiring Recommendation</div>
          <div style="font-size:17px;font-weight:700;color:${rec.startsWith('Strong Yes') ? '#166534' :
      rec === 'Yes' ? '#15803d' :
        rec === 'Maybe' ? '#92400e' : '#991b1b'
    }">${rec}</div>
        </div>
      </div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px 18px;margin-bottom:16px;font-size:13.5px;color:var(--sub);line-height:1.7">
        ${result.summary || 'No summary available.'}
      </div>
      ${expHtml}
      ${matchedHtml ? `<div style="margin-bottom:14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px">Matched Skills</div>
        ${matchedHtml}
      </div>` : ''}
      ${missingHtml ? `<div style="margin-bottom:14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px">Missing Skills</div>
        ${missingHtml}
      </div>` : ''}
      ${bonusHtml ? `<div style="margin-bottom:14px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px">Bonus Skills</div>
        ${bonusHtml}
      </div>` : ''}
      ${depthHtml}
      ${alignHtml}
      ${flagsHtml}
      ${posHtml}
      <div class="modal-actions">
        <button class="btn-ghost">Close</button>
        ${resume.resume_url ? `<a href="${resume.resume_url}" target="_blank" class="btn btn-primary" style="text-decoration:none">📄 View PDF</a>` : ''}
      </div>
    </div>`;

  overlay.querySelector('.btn-ghost').onclick = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
  document.body.appendChild(overlay);
}

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

function openSharePointModal() {
  const statusEl = document.getElementById('spStatus');
  const modeSelect = document.getElementById('spMode');
  const fileInput = document.getElementById('spFileName');
  const fileRow = document.getElementById('spFileNameRow');
  const btn = document.getElementById('spScreenBtn');
  const closeBtn = document.getElementById('spCloseBtn');
  const spReq = document.getElementById('spReq');

  if (statusEl) { statusEl.style.display = 'none'; statusEl.className = ''; statusEl.innerHTML = ''; }
  if (modeSelect) { modeSelect.value = 'all'; }
  if (fileInput) { fileInput.value = ''; }
  if (fileRow) { fileRow.style.display = 'none'; }
  if (btn) { btn.disabled = false; btn.textContent = 'Screen Resumes'; }
  if (closeBtn) { closeBtn.textContent = 'Cancel'; }
  if (spReq) { spReq.value = ''; }

  openOverlay('spOverlay');
}

async function screenSharePoint() {
  const mode = document.getElementById('spMode').value;
  const fileInput = document.getElementById('spFileName').value.trim();
  const reqId = document.getElementById('spReq').value;
  const statusEl = document.getElementById('spStatus');
  const btn = document.getElementById('spScreenBtn');
  const closeBtn = document.getElementById('spCloseBtn');

  if (!reqId) { toast('Please select a requirement', 'err'); return; }
  if (mode === 'single' && !fileInput) { toast('Please enter a filename.', 'err'); return; }

  const fileName = mode === 'all' ? 'all' : fileInput;

  btn.disabled = true;
  btn.textContent = 'Screening…';
  statusEl.style.display = 'block';
  statusEl.className = 'sp-status sp-status--loading';
  statusEl.innerHTML = `<span class="sp-spinner"></span> Contacting SharePoint and screening resumes…`;

  try {
    const res = await apiFetch(
      'POST',
      `/screen-sharepoint-resumes/?fileName=${encodeURIComponent(fileName)}&requirement=${reqId}`
    );

    if (!res) {
      statusEl.className = 'sp-status sp-status--error';
      statusEl.innerHTML = `<strong>Error:</strong> No response — session may have expired.`;
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      statusEl.className = 'sp-status sp-status--error';
      statusEl.innerHTML = `<strong>Error ${res.status}:</strong> ${data.error || 'Unknown error'}`;
      toast(`Screening failed (${res.status})`, 'err');

    } else if (fileName === 'all') {
      const { total_files, already_screened, screened_now, failed } = data;
      statusEl.className = failed > 0 ? 'sp-status sp-status--warn' : 'sp-status sp-status--success';
      statusEl.innerHTML = `
        <strong>SharePoint Screening Complete</strong>
        <div class="sp-stat-grid">
          <div class="sp-stat"><div class="sp-stat-label">Total files</div><div class="sp-stat-value">${total_files}</div></div>
          <div class="sp-stat"><div class="sp-stat-label">Screened now</div><div class="sp-stat-value">${screened_now}</div></div>
          <div class="sp-stat"><div class="sp-stat-label">Already screened</div><div class="sp-stat-value">${already_screened}</div></div>
          <div class="sp-stat"><div class="sp-stat-label">Failed</div><div class="sp-stat-value">${failed}</div></div>
        </div>`;
      toast(`Screened ${screened_now} resume(s). ${failed} failed.`, failed > 0 ? 'err' : 'ok');
      if (typeof loadResumes === 'function') loadResumes();

    } else {
      const { file_name, screening_result } = data;
      const score = screening_result?.score ?? '—';
      const rec = screening_result?.hiring_recommendation ?? '—';
      const summ = screening_result?.summary ?? '';
      statusEl.className = 'sp-status sp-status--success';
      statusEl.innerHTML = `
        <strong>${file_name}</strong> screened successfully.<br>
        Score: <strong>${score}/100</strong> &nbsp;|&nbsp; Recommendation: <strong>${rec}</strong>
        ${summ ? `<br><br><em style="opacity:.8">${summ}</em>` : ''}`;
      toast(`${file_name} — Score: ${score}/100`, 'ok');
      if (typeof loadResumes === 'function') loadResumes();
    }

  } catch (err) {
    statusEl.className = 'sp-status sp-status--error';
    statusEl.innerHTML = `<strong>Network error:</strong> ${err.message}`;
    toast(`Network error: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Screen Resumes';
    if (closeBtn) closeBtn.textContent = 'Close';
  }
}

function onSpModeChange() {
  const mode = document.getElementById('spMode').value;
  const fileRow = document.getElementById('spFileNameRow');
  if (fileRow) fileRow.style.display = mode === 'single' ? 'block' : 'none';
}

// ── SharePoint Upload Modal ───────────────────────────────────────────────
let selectedSpuFile = null;

function openSharePointUploadModal() {
  selectedSpuFile = null;
  document.getElementById('spuCandName').value = '';
  document.getElementById('spuFileInput').value = '';
  document.getElementById('spuFileChosen').style.display = 'none';
  document.getElementById('spuDropZone').classList.remove('drag-over');
  document.getElementById('spuUploadBtn').disabled = false;
  document.getElementById('spuUploadBtn').textContent = 'Upload to SharePoint';
  document.getElementById('spuCancelBtn').textContent = 'Cancel';
  setSpuStatus('', '');
  openOverlay('spUploadOverlay');
}

function handleSpuDragOver(e) { e.preventDefault(); document.getElementById('spuDropZone').classList.add('drag-over'); }
function handleSpuDragLeave() { document.getElementById('spuDropZone').classList.remove('drag-over'); }
function handleSpuDrop(e) { e.preventDefault(); handleSpuDragLeave(); const f = e.dataTransfer.files[0]; if (f) setSpuFile(f); }
function handleSpuFileSelect(e) { const f = e.target.files[0]; if (f) setSpuFile(f); }

function setSpuFile(f) {
  if (f.type !== 'application/pdf') { toast('Only PDF files are allowed', 'err'); return; }
  if (f.size > 10 * 1024 * 1024) { toast('File too large (max 10 MB)', 'err'); return; }
  selectedSpuFile = f;
  const el = document.getElementById('spuFileChosen');
  el.textContent = `✓ ${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
  el.style.display = 'block';
  setSpuStatus('', '');
}

function setSpuStatus(html, type) {
  const el = document.getElementById('spuStatus');
  if (!html) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const colours = {
    info: 'background:var(--indigo-light);border:1px solid var(--indigo-border);color:var(--indigo-dark)',
    success: 'background:#f0fdf4;border:1px solid #bbf7d0;color:#166534',
    error: 'background:#fef2f2;border:1px solid #fecaca;color:#991b1b',
  };
  el.style.cssText = (colours[type] || colours.info) + ';padding:12px 14px;border-radius:var(--radius-md);font-size:13px;line-height:1.7;margin-top:12px';
  el.style.display = 'block';
  el.innerHTML = html;
}

async function uploadToSharePoint() {
  const name = document.getElementById('spuCandName').value.trim();
  if (!name) { toast('Candidate name is required', 'err'); return; }
  if (!selectedSpuFile) { toast('Please select a PDF file', 'err'); return; }

  const btn = document.getElementById('spuUploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Uploading…';
  setSpuStatus('⏳ Uploading PDF and extracting skills — this may take a moment…', 'info');

  const fd = new FormData();
  fd.append('candidate_name', name);
  fd.append('resume_file', selectedSpuFile);

  try {
    const r = await apiFetch('POST', '/upload-sharepoint-resume/', fd, true);
    btn.disabled = false;
    btn.textContent = 'Upload to SharePoint';

    if (!r) { setSpuStatus('No response from server.', 'error'); return; }

    const data = await r.json().catch(() => ({}));

    if (r.ok) {
      const skillChips = data.skillset
        ? data.skillset.split(',').map(s => `<span class="chip chip-green">${s.trim()}</span>`).join(' ')
        : '<em style="opacity:.6">None detected</em>';

      setSpuStatus(
        `<strong>✓ Uploaded successfully.</strong><br>
         <span style="color:var(--sub)">File:</span> <strong>${data.file_name}</strong><br>
         <div style="margin-top:8px">
           <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">Skills detected</span><br>
           <div style="margin-top:4px">${skillChips}</div>
         </div>`,
        'success'
      );
      document.getElementById('spuCancelBtn').textContent = 'Close';
      toast('Resume uploaded to SharePoint!');
    } else {
      const msg = data.error || data.detail || `Upload failed (${r.status})`;
      setSpuStatus(`<strong>Error:</strong> ${msg}`, 'error');
      toast(msg, 'err');
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Upload to SharePoint';
    setSpuStatus(`<strong>Network error:</strong> ${err.message}`, 'error');
    toast(`Network error: ${err.message}`, 'err');
  }
}

async function deleteResume(id) {
  if (!confirm('Remove this resume?')) return;
  const r = await apiFetch('DELETE', `/resumes/${id}/`);
  if (r?.ok) { toast('Resume removed'); loadResumes(); }
  else toast('Failed to remove', 'err');
}
async function handleLogout() {
  await apiFetch('POST', '/auth/logout/', { refresh: localStorage.getItem('refresh') });
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = '/api/login-page/?signedout=1';
}

if (typeof getCookie === 'undefined') {
  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? v.pop() : '';
  }
}

if (typeof showToast === 'undefined') {
  function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `toast toast--${type} toast--visible`;
    setTimeout(() => t.classList.remove('toast--visible'), 4000);
  }
}