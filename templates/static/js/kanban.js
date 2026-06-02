/* ================================================================
   kanban.js  —  Swimlane Kanban pipeline for Synergy dashboard
   Stages stack VERTICALLY | Candidate cards flow HORIZONTALLY
   ================================================================ */

const STAGES = [
    { key: "applied",             label: "Applied",             icon: "📥" },
    { key: "screening",           label: "Screening",           icon: "🔍" },
    { key: "shortlisted",         label: "Shortlisted",         icon: "⭐" },
    { key: "interview_scheduled", label: "Interview Scheduled", icon: "📅" },
    { key: "selected",            label: "Selected",            icon: "✅" },
    { key: "rejected",            label: "Rejected",            icon: "❌" },
];

let _kbCandidates   = [];
let _kbDragging     = null;
let _kbDetailId     = null;
let _kbCanEdit      = false;
let _kbRequirements = [];
let _kbPendingDragId    = null;   // resume id waiting for schedule confirmation
let _kbPendingPrevStage = null;   // original stage to revert to on cancel

function _kbIsEditor() {
    const role = (ME?.role_name || "").toLowerCase();
    return role === "admin" || role === "hr";
}

document.addEventListener("DOMContentLoaded", () => {
    if (typeof viewMeta !== "undefined") {
        viewMeta.kanban = {
            title: "Kanban Pipeline",
            sub:   "Drag candidates through hiring stages"
        };
    }
    const _origShowView = window.showView;
    window.showView = function (name) {
        _origShowView(name);
        if (name === "kanban") loadKanban();
    };
});

/* ── Load ───────────────────────────────────────────────────────── */
async function loadKanban() {
    _kbCanEdit = _kbIsEditor();

    const badge = document.getElementById("kbRoleBadge");
    if (badge) {
        badge.textContent      = _kbCanEdit ? "🖱 Drag & Drop Enabled" : "👁 View Only";
        badge.style.background = _kbCanEdit ? "#ede9fe" : "var(--surface, #f1f5f9)";
        badge.style.color      = _kbCanEdit ? "#4f46e5" : "var(--muted, #94a3b8)";
    }

    await _kbLoadRequirementFilter();

    const reqId = document.getElementById("kbReqFilter")?.value || "";
    const url   = reqId ? `/requirements/${reqId}/resumes/` : "/resumes/";
    const r     = await req("GET", url);
    if (!r?.ok) {
        document.getElementById("kanbanBoard").innerHTML =
            '<div style="padding:32px;text-align:center;color:var(--muted,#94a3b8)">Could not load candidates.</div>';
        return;
    }
    _kbCandidates = listOf(await r.json());
    renderKanban();
}

async function _kbLoadRequirementFilter() {
    const sel = document.getElementById("kbReqFilter");
    if (!sel || sel.options.length > 1) return;
    const r = await req("GET", "/requirements/");
    if (!r?.ok) return;
    const list = listOf(await r.json());
    _kbRequirements = list;
    list.forEach(rq => {
        const o = document.createElement("option");
        o.value       = rq.id;
        o.textContent = rq.requirement_title;
        sel.appendChild(o);
    });
}

/* ── Render board ───────────────────────────────────────────────── */
function renderKanban() {
    const board = document.getElementById("kanbanBoard");
    if (!board) return;

    const query = (document.getElementById("kbSearch")?.value || "").toLowerCase().trim();
    const cards = query
        ? _kbCandidates.filter(c =>
            c.candidate_name?.toLowerCase().includes(query) ||
            c.candidate_email?.toLowerCase().includes(query) ||
            (c.requirement_title || "").toLowerCase().includes(query)
          )
        : _kbCandidates;

    const byStage = {};
    STAGES.forEach(s => { byStage[s.key] = []; });
    cards.forEach(c => {
        const stage = c.stage || "applied";
        if (byStage[stage]) byStage[stage].push(c);
        else byStage["applied"].push(c);
    });

    board.innerHTML = "";
    STAGES.forEach(s => board.appendChild(_buildLane(s, byStage[s.key])));
    _attachDragListeners();
}

/* ── Build a swimlane row ───────────────────────────────────────── */
function _buildLane(stageDef, candidates) {
    const lane = document.createElement("div");
    lane.className     = "kb-col";
    lane.dataset.stage = stageDef.key;

    const head = document.createElement("div");
    head.className = "kb-col-head";
    head.innerHTML = `
        <div class="kb-col-title">
            <span>${stageDef.icon}</span>
            <span>${stageDef.label}</span>
        </div>
        <span class="kb-count">${candidates.length}</span>
    `;
    lane.appendChild(head);

    const list = document.createElement("div");
    list.className = "kb-list";
    list.id        = `kbList-${stageDef.key}`;

    if (!candidates.length) {
        list.innerHTML = `<div class="kb-empty">No candidates</div>`;
    } else {
        candidates.forEach(c => list.appendChild(_buildCard(c)));
    }
    lane.appendChild(list);
    return lane;
}

/* ── Build a candidate card ─────────────────────────────────────── */
function _buildCard(candidate) {
    const card = document.createElement("div");
    card.className  = "kb-card" + (_kbCanEdit ? "" : " readonly");
    card.dataset.id = candidate.id;
    if (_kbCanEdit) card.draggable = true;

    const score = candidate.screening_result?.score ?? candidate.screening_score ?? null;
    let scoreClass = "none", scoreLabel = "No score";
    if (score !== null) {
        scoreClass = score >= 70 ? "high" : score >= 40 ? "mid" : "low";
        scoreLabel = `${score}%`;
    }

    let emailChip = "";
    if (candidate.email_sent !== undefined) {
        emailChip = candidate.email_sent
            ? `<span class="kb-email-chip sent">✉ Sent</span>`
            : `<span class="kb-email-chip pending">✉ Pending</span>`;
    }

    const initials = (candidate.candidate_name || "?")
        .split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

    card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <div style="width:30px;height:30px;border-radius:50%;
                        background:linear-gradient(135deg,#6366f1,#4f46e5);
                        color:#fff;display:flex;align-items:center;justify-content:center;
                        font-size:11px;font-weight:700;flex-shrink:0">
                ${initials}
            </div>
            <div style="min-width:0">
                <div class="kb-card-name">${candidate.candidate_name || "—"}</div>
            </div>
        </div>
        <div class="kb-card-req">${candidate.requirement_title || "No requirement"}</div>
        <div class="kb-card-footer">
            <span class="kb-score ${scoreClass}">${scoreLabel}</span>
            ${emailChip}
        </div>
    `;

    card.addEventListener("click", () => openKbDetail(candidate.id));
    return card;
}

/* ── Drag & Drop ────────────────────────────────────────────────── */
function _attachDragListeners() {
    if (!_kbCanEdit) return;

    document.querySelectorAll(".kb-card[draggable]").forEach(card => {
        card.addEventListener("dragstart", e => {
            _kbDragging = parseInt(card.dataset.id, 10);
            card.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
        });
        card.addEventListener("dragend", () => {
            card.classList.remove("dragging");
            _kbDragging = null;
        });
    });

    document.querySelectorAll(".kb-col, .kb-list").forEach(zone => {
        zone.addEventListener("dragover", e => {
            e.preventDefault();
            zone.closest(".kb-col")?.classList.add("drag-over");
            e.dataTransfer.dropEffect = "move";
        });
        zone.addEventListener("dragleave", e => {
            const col = zone.closest(".kb-col");
            if (col && !col.contains(e.relatedTarget)) col.classList.remove("drag-over");
        });
        zone.addEventListener("drop", async e => {
            e.preventDefault();
            const col = zone.closest(".kb-col");
            col?.classList.remove("drag-over");

            const newStage = col?.dataset.stage;
            if (_kbDragging === null || !newStage) return;

            const candidate = _kbCandidates.find(c => c.id === _kbDragging);
            if (!candidate || candidate.stage === newStage) return;

            const draggedId  = _kbDragging;
            const prevStage  = candidate.stage;   // capture before optimistic update

            // Optimistic UI update
            candidate.stage = newStage;
            renderKanban();

            // 1. Persist stage change
            const r = await req("PATCH", `/resumes/${draggedId}/stage/`, { stage: newStage });
            if (!r?.ok) {
                toast("Failed to update stage", "err");
                await loadKanban();
                return;
            }

            toast(`Moved to ${STAGES.find(s => s.key === newStage)?.label}`);

            // 2. Auto-trigger AI screening when dropped into Screening lane
            if (newStage === "screening" && !candidate.screening_done) {
                toast("🔍 Running AI screening…");

                // Show spinner on the card while screening runs
                const cardEl = document.querySelector(`.kb-card[data-id="${draggedId}"]`);
                if (cardEl) {
                    const footer = cardEl.querySelector(".kb-card-footer");
                    if (footer) footer.innerHTML = `<span style="font-size:11px;color:#6366f1;font-weight:600">⏳ Screening…</span>`;
                }

                const sr = await req("POST", `/resumes/${draggedId}/screen/`);
                if (sr?.ok) {
                    const result = await sr.json();
                    candidate.screening_result = result;
                    candidate.screening_done   = true;
                    const score = result?.score ?? null;
                    const label = score !== null ? `${score}%` : "No score";
                    toast(`✅ Screened — Score: ${label}`);
                    renderKanban();
                } else {
                    toast("Screening failed — check resume/JD", "err");
                }
            }

            // 3. Auto-screen when dropped into Shortlisted (silent, if not done)
            if (newStage === "shortlisted" && !candidate.screening_done) {
                const sr = await req("POST", `/resumes/${draggedId}/screen/`);
                if (sr?.ok) {
                    const result = await sr.json();
                    candidate.screening_result = result;
                    candidate.screening_done   = true;
                    renderKanban();
                }
            }

            // 4. Open schedule modal when dropped into Interview Scheduled
            if (newStage === "interview_scheduled") {
                // Ensure screening is done first (silent)
                if (!candidate.screening_done) {
                    const sr = await req("POST", `/resumes/${draggedId}/screen/`);
                    if (sr?.ok) {
                        const result = await sr.json();
                        candidate.screening_result = result;
                        candidate.screening_done   = true;
                    }
                }

                // Check if interview already exists
                const existing = await req("GET", `/interviews/`);
                let alreadyScheduled = false;
                if (existing?.ok) {
                    const list = listOf(await existing.json());
                    alreadyScheduled = list.some(i => i.resume === draggedId);
                }

                if (alreadyScheduled) {
                    toast("📅 Interview already scheduled for this candidate");
                } else {
                    // Open the schedule modal — actual API call happens in kbSaveInterview()
                    candidate._prevStage = prevStage;
                    openKbScheduleModal(draggedId, candidate);
                }
            }

            // 5. Selected — auto-screen if not done, show celebration toast
            if (newStage === "selected") {
                if (!candidate.screening_done) {
                    const sr = await req("POST", `/resumes/${draggedId}/screen/`);
                    if (sr?.ok) {
                        const result = await sr.json();
                        candidate.screening_result = result;
                        candidate.screening_done   = true;
                        renderKanban();
                    }
                }
                const score = candidate.screening_result?.score ?? null;
                const scoreStr = score !== null ? ` (Score: ${score}%)` : "";
                toast(`🎉 ${candidate.candidate_name} selected${scoreStr}!`);
            }

            // 6. Rejected — auto-screen if not done, show rejection toast
            if (newStage === "rejected") {
                if (!candidate.screening_done) {
                    const sr = await req("POST", `/resumes/${draggedId}/screen/`);
                    if (sr?.ok) {
                        const result = await sr.json();
                        candidate.screening_result = result;
                        candidate.screening_done   = true;
                        renderKanban();
                    }
                }
                toast(`❌ ${candidate.candidate_name} marked as rejected`);
            }
        });
    });
}

/* ── Card detail modal ──────────────────────────────────────────── */
async function openKbDetail(id) {
    _kbDetailId = id;
    document.getElementById("kbDetailContent").innerHTML = '<div class="loading">Loading…</div>';
    document.getElementById("kbSaveStageBtn").style.display = _kbCanEdit ? "inline-flex" : "none";
    openOverlay("kbDetailOverlay");

    const r = await req("GET", `/resumes/${id}/`);
    if (!r?.ok) {
        document.getElementById("kbDetailContent").innerHTML = '<div class="empty">Could not load candidate.</div>';
        return;
    }
    _renderKbDetail(await r.json());
}

function _renderKbDetail(c) {
    const initials = (c.candidate_name || "?")
        .split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

    const score   = c.screening_result?.score ?? null;
    const sClass  = score === null ? "none" : score >= 70 ? "high" : score >= 40 ? "mid" : "low";
    const summary = c.screening_result?.summary || "No screening summary available.";

    let stageControl = "";
    if (_kbCanEdit) {
        const opts = STAGES.map(s =>
            `<option value="${s.key}" ${c.stage === s.key ? "selected" : ""}>${s.icon} ${s.label}</option>`
        ).join("");
        stageControl = `
            <div class="kb-stage-select-wrap">
                <label>Pipeline Stage</label>
                <select class="kb-stage-select" id="kbDetailStage">${opts}</select>
            </div>`;
    } else {
        const stageDef = STAGES.find(s => s.key === (c.stage || "applied")) || STAGES[0];
        stageControl = `
            <div class="kb-stage-select-wrap" style="justify-content:center">
                <span style="font-weight:600;font-size:13px">${stageDef.icon} ${stageDef.label}</span>
            </div>`;
    }

    document.getElementById("kbDetailContent").innerHTML = `
        <div class="kb-detail-hero">
            <div style="display:flex;align-items:center;gap:16px">
                <div class="kb-detail-avatar">${initials}</div>
                <div>
                    <div class="kb-detail-name">${c.candidate_name}</div>
                    <div class="kb-detail-sub">${c.candidate_email || "—"}</div>
                    <div class="kb-detail-sub" style="margin-top:3px">${c.candidate_phone || ""}</div>
                </div>
            </div>
        </div>
        ${stageControl}
        <div class="kb-screening-box">
            <div class="kb-screening-score-row">
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;
                             letter-spacing:.6px;color:var(--muted,#94a3b8)">AI Screening Score</span>
                <span class="kb-score-big ${sClass}">${score !== null ? score + "%" : "N/A"}</span>
            </div>
            ${score !== null ? `
            <div class="kb-score-bar-bg">
                <div class="kb-score-bar-fill ${sClass}" style="width:${score}%"></div>
            </div>` : ""}
            <div class="kb-screening-summary">${summary}</div>
        </div>
        <div class="kb-detail-fields">
            <div class="kb-detail-field">
                <div class="kdf-label">Requirement</div>
                <div class="kdf-value">${c.requirement_title || "—"}</div>
            </div>
            <div class="kb-detail-field">
                <div class="kdf-label">Uploaded By</div>
                <div class="kdf-value">${c.uploaded_by_name || "—"}</div>
            </div>
            <div class="kb-detail-field full">
                <div class="kdf-label">Notes</div>
                <div class="kdf-value">${c.notes || "—"}</div>
            </div>
        </div>
    `;
}

async function saveCardStage() {
    if (!_kbDetailId || !_kbCanEdit) return;
    const sel = document.getElementById("kbDetailStage");
    if (!sel) return;
    const newStage = sel.value;

    const candidate = _kbCandidates.find(c => c.id === _kbDetailId);
    if (candidate?.stage === newStage) {
        toast("No change");
        closeOverlay("kbDetailOverlay");
        return;
    }

    const r = await req("PATCH", `/resumes/${_kbDetailId}/stage/`, { stage: newStage });
    if (r?.ok) {
        if (candidate) candidate.stage = newStage;
        toast(`Stage updated to ${STAGES.find(s => s.key === newStage)?.label}`);
        closeOverlay("kbDetailOverlay");
        renderKanban();
    } else {
        toast("Failed to save stage", "err");
    }
}

/* ── JD Edit ────────────────────────────────────────────────────── */
function openJdEdit(reqId, currentJD, title) {
    document.getElementById("jdEditReqId").value       = reqId;
    document.getElementById("jdEditText").value        = currentJD || "";
    document.getElementById("jdEditTitle").textContent =
        `Edit Job Description — ${title || "Requirement #" + reqId}`;
    openOverlay("jdEditOverlay");
}

async function saveJD() {
    const reqId = document.getElementById("jdEditReqId").value;
    const jd    = document.getElementById("jdEditText").value.trim();
    if (!reqId) return;

    const r = await req("PATCH", `/requirements/${reqId}/update-jd/`, { job_description: jd });
    if (r?.ok) {
        toast("Job description saved!");
        closeOverlay("jdEditOverlay");
        if (document.getElementById("view-requirements")?.classList.contains("active")) {
            loadReqs();
        }
    } else {
        const e = await r?.json();
        toast(Object.values(e || {}).flat()[0] || "Failed to save JD", "err");
    }
}

/* ── Schedule Interview Modal (called from drag-drop step 4) ────── */

/**
 * Opens the kbScheduleOverlay and pre-fills it for the given candidate.
 * Saves the drag context so we can revert if the user cancels.
 */
function openKbScheduleModal(resumeId, candidate) {
    _kbPendingDragId    = resumeId;
    _kbPendingPrevStage = candidate._prevStage ?? null;   // set below before calling

    // Default date/time: 3 days from now at 10:00
    const dt = new Date();
    dt.setDate(dt.getDate() + 3);
    dt.setHours(10, 0, 0, 0);
    // datetime-local value format: "YYYY-MM-DDTHH:MM"
    const pad  = n => String(n).padStart(2, "0");
    const dtLocal = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

    document.getElementById("kbSResumeId").value    = resumeId;
    document.getElementById("kbSCandName").value    = candidate.candidate_name  || "";
    document.getElementById("kbSReqTitle").value    = candidate.requirement_title || "";
    document.getElementById("kbSDateTime").value    = dtLocal;
    document.getElementById("kbSVenue").value       = "";
    document.getElementById("kbSNotes").value       = "";
    document.getElementById("kbSSendEmail").checked = true;

    // Reset button state
    const btn = document.getElementById("kbSaveInterviewBtn");
    if (btn) { btn.disabled = false; btn.textContent = "Schedule Interview"; }

    openOverlay("kbScheduleOverlay");
}

/**
 * Called when the user clicks "Schedule Interview" inside kbScheduleOverlay.
 * Creates the interview record; on success closes the modal and re-renders.
 * On cancel the caller should call _kbRevertDrag() to push the card back.
 */
async function kbSaveInterview() {
    const resumeId   = parseInt(document.getElementById("kbSResumeId").value, 10);
    const dateTimeVal = document.getElementById("kbSDateTime").value;
    const venue      = document.getElementById("kbSVenue").value.trim() || "To be confirmed";
    const notes      = document.getElementById("kbSNotes").value.trim();
    const sendEmail  = document.getElementById("kbSSendEmail").checked;

    if (!dateTimeVal) {
        toast("Please pick a date and time", "err");
        return;
    }

    // Convert local datetime-local value to ISO string
    const scheduledAt = new Date(dateTimeVal).toISOString();

    const btn = document.getElementById("kbSaveInterviewBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Scheduling…"; }

    const payload = {
        resume:       resumeId,
        scheduled_at: scheduledAt,
        venue,
        status:       "scheduled",
    };
    if (notes)     payload.notes      = notes;
    if (sendEmail) payload.send_email = true;

    const ir = await req("POST", `/interviews/`, payload);

    if (ir?.ok) {
        closeOverlay("kbScheduleOverlay");
        _kbPendingDragId    = null;
        _kbPendingPrevStage = null;
        toast("📅 Interview scheduled — invite email queued");
        renderKanban();
    } else {
        const err = await ir?.json().catch(() => ({}));
        const msg = Object.values(err || {}).flat()[0] || "Unknown error";

        // Handle duplicate-interview edge case gracefully
        if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("unique")) {
            closeOverlay("kbScheduleOverlay");
            _kbPendingDragId    = null;
            _kbPendingPrevStage = null;
            toast("📅 Interview already exists for this candidate");
            renderKanban();
        } else {
            if (btn) { btn.disabled = false; btn.textContent = "Schedule Interview"; }
            toast(`Interview creation failed: ${msg}`, "err");
        }
    }
}

/**
 * Reverts the optimistically-moved card back to its previous stage.
 * Called by the Cancel button in kbScheduleOverlay.
 */
function _kbRevertDrag() {
    if (_kbPendingDragId === null) return;

    const candidate = _kbCandidates.find(c => c.id === _kbPendingDragId);
    if (candidate && _kbPendingPrevStage) {
        candidate.stage = _kbPendingPrevStage;

        // Also revert on the server (fire-and-forget)
        req("PATCH", `/resumes/${_kbPendingDragId}/stage/`, { stage: _kbPendingPrevStage })
            .catch(() => {});
    }

    _kbPendingDragId    = null;
    _kbPendingPrevStage = null;
    renderKanban();
}