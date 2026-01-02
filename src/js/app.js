/* ============================================================
   app.js (Repo A - GitHub Pages)
   Evaluación de ingreso (Frontend estático) conectado a ProTrack (Repo B)
   - Carga cargos desde Supabase via backend ProTrack
   - Trae evaluación (preguntas) según cargo/área
   - Guarda resultados + antifraude + CV PDF (base64) en Supabase via backend
   ============================================================ */

/* ================= CONFIG ================= */
const PROTRACK_BASE = "https://protrack-49um.onrender.com"; // backend real (Render)
// Si algún día habilitas API KEY, ponla aquí y se enviará en X-API-Key
const PUBLIC_EVAL_API_KEY = "";

// Endpoints públicos del backend (Repo B)
const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/public/positions`;
const ENDPOINT_EVAL_BASE = `${PROTRACK_BASE}/api/public/eval`; // + ?position_id=
const ENDPOINT_SUBMIT = `${PROTRACK_BASE}/api/public/submit`;  // POST

const MAX_CV_BYTES = 8 * 1024 * 1024;
const LOCK_KEY = "LCT_EVAL_LOCK_v2";

/* ================= Helpers ================= */
const $ = (id) => document.getElementById(id);

function safeOn(el, event, handler) {
  if (el && el.addEventListener) el.addEventListener(event, handler);
}

function apiHeaders(isJson = true) {
  const h = {};
  if (isJson) h["Content-Type"] = "application/json";
  if (PUBLIC_EVAL_API_KEY) h["X-API-Key"] = PUBLIC_EVAL_API_KEY;
  return h;
}

function showFormError(msg) {
  const el = $("formError");
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function showExamError(msg) {
  const el = $("examError");
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function uiMsg(text, type = "ok") {
  const el = $("uiMsg");
  if (!el) return;
  el.classList.remove("hidden");
  el.dataset.type = type;
  el.textContent = text;
  setTimeout(() => el.classList.add("hidden"), 3500);
}

function sanitize(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || "").trim());
}

function isValidPhone(phone) {
  // permite +57..., espacios, guiones
  const p = (phone || "").trim();
  return /^[+]?[\d\s-]{7,20}$/.test(p);
}

function isValidUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

function setLock(obj) {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(obj));
  } catch (_) {}
}
function getLock() {
  try {
    return JSON.parse(localStorage.getItem(LOCK_KEY) || "null");
  } catch {
    return null;
  }
}
function clearLock() {
  try {
    localStorage.removeItem(LOCK_KEY);
  } catch (_) {}
}

/* ================= Modal helpers ================= */
function openModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.remove("hidden");
  m.setAttribute("aria-hidden", "false");
}
function closeModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.add("hidden");
  m.setAttribute("aria-hidden", "true");
}

/* ================= Exam State ================= */
const exam = {
  startedAt: null,
  finishedAt: null,
  durationSeconds: 600,
  timerId: null,

  questions: [],
  answers: [],
  currentIndex: 0,

  // antifraude
  tabChanges: 0,
  copyCount: 0,
  pasteCount: 0,
  blurStartTime: null,
  totalBlurTime: 0,
  screenshotCount: 0,
  exitAttemptCount: 0,
};

let candidateFormCache = null;
let evalInfoCache = null;
let trackingReady = false;

/* ================= Load positions ================= */
async function loadPositions() {
  const sel = $("role");
  if (!sel) return;

  sel.innerHTML = `<option value="" selected disabled>Cargando...</option>`;

  try {
    const res = await fetch(ENDPOINT_POSITIONS, { method: "GET", headers: apiHeaders(false) });
    const raw = await res.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { data = { ok: false, error: raw }; }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || data.msg || `HTTP ${res.status}`);
    }

    const rows = data.data || data.items || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      sel.innerHTML = `<option value="" selected disabled>No hay cargos activos</option>`;
      return;
    }

    sel.innerHTML = `<option value="" selected disabled>Selecciona...</option>`;
    for (const r of rows) {
      const opt = document.createElement("option");
      opt.value = r.position_id || r.id || "";
      opt.textContent = r.position_name || r.name || "Cargo";
      sel.appendChild(opt);
    }
  } catch (e) {
    sel.innerHTML = `<option value="" selected disabled>No se pudo cargar</option>`;
    showFormError(`No se pudieron cargar cargos. Verifica backend (/api/public/positions), CORS y Supabase.`);
    console.error("Positions error:", e);
  }
}

/* ================= CV to base64 ================= */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const idx = s.indexOf("base64,");
      resolve(idx >= 0 ? s.slice(idx + 7) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ================= Form validation ================= */
function validateForm() {
  // IDs esperados (según tu UI actual)
  const firstName = sanitize($("firstName")?.value);
  const lastName = sanitize($("lastName")?.value);
  const cedula = ($("cedula")?.value || "").trim();

  const email = ($("email")?.value || "").trim();
  const phone = ($("phone")?.value || "").trim();
  const github = ($("github")?.value || "").trim();
  const linkedin = ($("linkedin")?.value || "").trim();

  const university = sanitize($("university")?.value);
  const career = ($("career")?.value || "").trim();
  const semester = ($("semester")?.value || "").trim();
  const position_id = ($("role")?.value || "").trim();

  const acceptPolicy = !!$("acceptPolicy")?.checked;
  const file = $("cvFile")?.files && $("cvFile").files[0];

  // Obligatorios
  if (!firstName) return "Debe ingresar Nombre *";
  if (!lastName) return "Debe ingresar Apellido *";
  if (!cedula) return "Debe ingresar Cédula *";
  if (!/^\d+$/.test(cedula)) return "Cédula: solo números";

  if (!email) return "Debe ingresar Correo *";
  if (!isValidEmail(email)) return "Correo inválido";

  if (!phone) return "Debe ingresar Celular *";
  if (!isValidPhone(phone)) return "Celular inválido";

  if (!github) return "Debe ingresar GitHub *";
  if (!isValidUrl(github)) return "GitHub debe ser una URL válida";

  if (linkedin && !isValidUrl(linkedin)) return "LinkedIn debe ser una URL válida";

  if (!university) return "Debe ingresar Universidad *";
  if (!career) return "Debe ingresar Carrera *";
  if (!semester) return "Debe ingresar Semestre *";
  if (!position_id) return "Debe seleccionar Cargo a concursar *";

  if (!file) return "Debe adjuntar Hoja de vida (PDF) *";
  if (file.size > MAX_CV_BYTES) return "Hoja de vida supera 8 MB";
  const isPdf = (file.type || "").toLowerCase() === "application/pdf" || (file.name || "").toLowerCase().endsWith(".pdf");
  if (!isPdf) return "Hoja de vida: solo PDF";

  if (!acceptPolicy) return "Debe aceptar la Política de tratamiento de datos";

  return {
    firstName,
    lastName,
    cedula,
    email,
    phone,
    github,
    linkedin,
    university,
    career,
    semester,
    position_id,
  };
}

/* ================= Anti-fraude tracking ================= */
function setupActivityTracking() {
  if (trackingReady) return;
  trackingReady = true;

  document.addEventListener("visibilitychange", () => {
    if (!exam.startedAt) return;
    if (document.hidden) {
      exam.blurStartTime = Date.now();
      exam.tabChanges++;
    } else {
      if (exam.blurStartTime) {
        exam.totalBlurTime += Date.now() - exam.blurStartTime;
        exam.blurStartTime = null;
      }
    }
  });

  document.addEventListener("copy", (e) => {
    if (!exam.startedAt) return;
    e.preventDefault();
    exam.copyCount++;
    uiMsg("⚠️ Copiar detectado", "warn");
  });

  document.addEventListener("paste", (e) => {
    if (!exam.startedAt) return;
    e.preventDefault();
    exam.pasteCount++;
    uiMsg("⚠️ Pegar detectado", "warn");
  });

  window.addEventListener("keydown", (e) => {
    if (!exam.startedAt) return;

    // PrintScreen
    if (e.key === "PrintScreen") {
      exam.screenshotCount++;
      uiMsg("⚠️ Captura detectada", "warn");
      e.preventDefault();
    }

    // F5 / Ctrl+R
    if (e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "R"))) {
      exam.exitAttemptCount++;
      uiMsg("⚠️ No recargues durante la evaluación", "warn");
      e.preventDefault();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (!exam.startedAt) return;
    exam.exitAttemptCount++;
    e.preventDefault();
    e.returnValue = "";
  });
}

/* ================= Backend calls ================= */
async function fetchEvalForPosition(positionId) {
  const url = `${ENDPOINT_EVAL_BASE}?position_id=${encodeURIComponent(positionId)}`;
  const res = await fetch(url, { method: "GET", headers: apiHeaders(false) });
  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch { data = { ok: false, error: raw }; }

  if (!res.ok || !data.ok) {
    throw new Error(data.error || data.msg || `HTTP ${res.status}`);
  }
  // Espera { ok:true, data:{ position, qb, eval:{title,duration_minutes,questions[]} } }
  return data.data;
}

/* ================= Exam UI flow ================= */
function startTimer() {
  const timerEl = $("timer");
  const start = Date.now();
  const durMs = exam.durationSeconds * 1000;

  function tick() {
    const elapsed = Date.now() - start;
    const left = Math.max(0, durMs - elapsed);
    const mm = String(Math.floor(left / 60000)).padStart(2, "0");
    const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
    if (timerEl) timerEl.textContent = `${mm}:${ss}`;

    if (left <= 0) {
      clearInterval(exam.timerId);
      finishExam(true).catch(console.error);
    }
  }

  tick();
  exam.timerId = setInterval(tick, 500);
}

function showQuestion() {
  const q = exam.questions[exam.currentIndex];
  const qText = $("qText");
  const qAnswer = $("qAnswer");

  if (qText) qText.textContent = q?.prompt || "";
  if (qAnswer) {
    qAnswer.value = "";
    qAnswer.focus();
  }
  showExamError("");
}

function beginExam() {
  const formCard = $("formCard");
  const examCard = $("examCard");
  if (formCard) formCard.classList.add("hidden");
  if (examCard) examCard.classList.remove("hidden");

  setupActivityTracking();

  exam.startedAt = Date.now();
  startTimer();

  exam.currentIndex = 0;
  exam.answers = [];
  showQuestion();
}

function nextQuestion() {
  const qAnswer = $("qAnswer");
  const ans = (qAnswer?.value || "").trim();
  if (!ans) {
    showExamError("Debes responder antes de continuar.");
    return;
  }

  const q = exam.questions[exam.currentIndex];
  exam.answers.push({
    moduleId: q.moduleId,
    moduleName: q.moduleName,
    id: q.id,
    prompt: q.prompt,
    answer: ans,
  });

  exam.currentIndex++;
  if (exam.currentIndex >= exam.questions.length) {
    finishExam(false).catch(console.error);
    return;
  }

  showQuestion();
}

async function finishExam(timedOut) {
  try { clearInterval(exam.timerId); } catch (_) {}

  exam.finishedAt = Date.now();

  const file = $("cvFile")?.files && $("cvFile").files[0];
  const cvBase64 = await fileToBase64(file);

  const antifraude = {
    timed_out: !!timedOut,
    tab_changes: exam.tabChanges,
    copy_count: exam.copyCount,
    paste_count: exam.pasteCount,
    blur_ms: exam.totalBlurTime,
    screenshot_count: exam.screenshotCount,
    exit_attempts: exam.exitAttemptCount,
  };

  const payload = {
    position_id: candidateFormCache.position_id,
    candidate: {
      first_name: candidateFormCache.firstName,
      last_name: candidateFormCache.lastName,
      cedula: candidateFormCache.cedula,
      document_number: candidateFormCache.cedula,

      email: candidateFormCache.email,
      phone: candidateFormCache.phone,
      github_url: candidateFormCache.github,
      linkedin_url: candidateFormCache.linkedin,

      university: candidateFormCache.university,
      career: candidateFormCache.career,
      semester: candidateFormCache.semester,

      role_applied: (evalInfoCache?.position?.name) || "",
    },
    answers: exam.answers,
    meta: {
      started_at: new Date(exam.startedAt).toISOString(),
      finished_at: new Date(exam.finishedAt).toISOString(),
      duration_seconds: Math.floor((exam.finishedAt - exam.startedAt) / 1000),
      antifraude,
      qb: evalInfoCache?.qb || {},
      position: evalInfoCache?.position || {},
    },
    cv: {
      filename: file?.name || "cv.pdf",
      base64: cvBase64,
    },
  };

  try {
    const res = await fetch(ENDPOINT_SUBMIT, {
      method: "POST",
      headers: apiHeaders(true),
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { data = { ok: false, error: raw }; }

    if (!res.ok || !data.ok) throw new Error(data.error || data.msg || `HTTP ${res.status}`);

    setLock({
      done: true,
      candidate_id: data.candidate_id,
      at: new Date().toISOString(),
    });

    const examCard = $("examCard");
    if (examCard) examCard.classList.add("hidden");
    openModal("modalDone");
  } catch (e) {
    console.error("Submit error:", e);
    uiMsg("No se pudo guardar en BD. Revisa endpoint/DB.", "warn");
    openModal("modalDone");
  }
}

/* ================= Boot ================= */
document.addEventListener("DOMContentLoaded", async () => {
  // Lock info
  const lock = getLock();
  if (lock?.done) {
    uiMsg("Ya se registró una evaluación desde este dispositivo.", "warn");
  }

  // Cargar cargos
  await loadPositions();

  // Modal handlers (si existen)
  safeOn($("modalInfoClose"), "click", () => closeModal("modalInfo"));
  safeOn($("btnCancelStart"), "click", () => closeModal("modalInfo"));

  safeOn($("btnAcceptStart"), "click", async () => {
    closeModal("modalInfo");

    try {
      evalInfoCache = await fetchEvalForPosition(candidateFormCache.position_id);

      const evalObj = evalInfoCache?.eval || {};
      const qs = evalObj.questions || [];
      const durMin = Number(evalObj.duration_minutes || 10);

      if (!Array.isArray(qs) || qs.length === 0) {
        showFormError("No hay preguntas activas para este cargo/área.");
        const formCard = $("formCard");
        if (formCard) formCard.classList.remove("hidden");
        return;
      }

      exam.questions = qs;
      exam.durationSeconds = Math.max(1, durMin) * 60;
      beginExam();
    } catch (e) {
      console.error("Eval load error:", e);
      showFormError("No se pudo cargar la evaluación (banco no activo / endpoint).");
      const formCard = $("formCard");
      if (formCard) formCard.classList.remove("hidden");
    }
  });

  safeOn($("modalDoneClose"), "click", () => closeModal("modalDone"));
  safeOn($("btnDoneOk"), "click", () => {
    closeModal("modalDone");
    uiMsg("Evaluación enviada.", "ok");
  });

  // Start button
  safeOn($("btnStart"), "click", () => {
    showFormError("");
    const valid = validateForm();
    if (typeof valid === "string") {
      showFormError(valid);
      return;
    }
    candidateFormCache = valid;
    openModal("modalInfo");
  });

  // Next question
  safeOn($("btnNext"), "click", () => nextQuestion());

  // Enter = siguiente (opcional)
  safeOn($("qAnswer"), "keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      nextQuestion();
    }
  });
});
