/* =========================
   LabCore Tech - Evaluación
   ========================= */

// ================= CONFIG =================
const PROTRACK_BASE = "https://protrack-49um.onrender.com"; // tu backend real
const PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98"; // si backend lo exige

const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`;
const ENDPOINT_EVAL = `${PROTRACK_BASE}/api/gh/public/eval`;          // ?position_id=...
const ENDPOINT_SUBMIT = `${PROTRACK_BASE}/api/gh/public/submit`;      // POST

const MAX_CV_MB = 8;
const LOCK_KEY = "labcore_eval_lock_v1";

const $ = (id) => document.getElementById(id);

// ===== UI helpers =====
function showFormError(text) {
  const el = $("formError");
  if (!el) return;
  if (!text) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

function showExamError(text) {
  const el = $("examError");
  if (!el) return;
  if (!text) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

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

// ===== Validation =====
function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function onlyDigits(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function isPhone(v) {
  const d = onlyDigits(v);
  return d.length >= 7 && d.length <= 15;
}

function isUrl(v) {
  try {
    const u = new URL(String(v || "").trim());
    return !!u.protocol && !!u.host;
  } catch (_) {
    return false;
  }
}

function validateForm() {
  const firstName = $("firstName").value.trim();
  const lastName  = $("lastName").value.trim();
  const cedula    = onlyDigits($("cedula").value.trim());
  const email     = $("email").value.trim();
  const phone     = $("phone").value.trim();
  const github    = $("github").value.trim();
  const linkedin  = $("linkedin").value.trim();
  const university= $("university").value.trim();
  const career    = $("career").value.trim();
  const semester  = $("semester").value.trim();
  const role      = $("role").value.trim();
  const cvFile    = $("cvFile").files && $("cvFile").files[0];
  const policyOk  = $("acceptPolicy").checked;

  const missing = [];

  if (!firstName) missing.push("Nombre");
  if (!lastName) missing.push("Apellido");
  if (!cedula || cedula.length < 6) missing.push("Cédula");
  if (!email || !isEmail(email)) missing.push("Correo");
  if (!phone || !isPhone(phone)) missing.push("Celular");
  if (!github || !isUrl(github)) missing.push("GitHub");
  if (!university) missing.push("Universidad");
  if (!career) missing.push("Carrera");
  if (!semester) missing.push("Semestre");
  if (!role) missing.push("Cargo a concursar");

  if (!cvFile) missing.push("Hoja de vida (PDF)");
  if (!policyOk) missing.push("Aceptar política");

  if (missing.length) {
    return `Debe ingresar los datos obligatorios: ${missing.join(", ")}.`;
  }

  if (linkedin && !isUrl(linkedin)) return "LinkedIn debe ser una URL válida o quedar vacío.";

  const isPdf = (cvFile.type === "application/pdf") || /\.pdf$/i.test(cvFile.name);
  if (!isPdf) return "La hoja de vida debe ser PDF.";
  const sizeMb = cvFile.size / (1024 * 1024);
  if (sizeMb > MAX_CV_MB) return `El PDF excede ${MAX_CV_MB} MB.`;

  return "";
}

// ===== file -> base64 =====
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_error"));
    reader.onload = () => {
      const res = reader.result || "";
      const base64 = String(res).split(",")[1] || "";
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

// ===== Lock =====
function setLock(obj) {
  try { localStorage.setItem(LOCK_KEY, JSON.stringify(obj)); } catch (_) {}
}
function clearLock() {
  try { localStorage.removeItem(LOCK_KEY); } catch (_) {}
}
function getLock() {
  try {
    const s = localStorage.getItem(LOCK_KEY);
    return s ? JSON.parse(s) : null;
  } catch (_) {
    return null;
  }
}

// ===== Anti-fraude =====
const anti = {
  startedAt: null,
  eventsGlobal: { blur:0, visibility:0, copy:0, paste:0, printscreen:0 },
  perQuestion: {} // idx -> { blur, visibility, copy, paste, printscreen }
};

function antiInc(type) {
  anti.eventsGlobal[type] = (anti.eventsGlobal[type] || 0) + 1;

  const idx = exam.idx;
  anti.perQuestion[idx] = anti.perQuestion[idx] || { blur:0, visibility:0, copy:0, paste:0, printscreen:0 };
  anti.perQuestion[idx][type] = (anti.perQuestion[idx][type] || 0) + 1;
}

function wireAntiFraude() {
  anti.startedAt = Date.now();

  document.addEventListener("visibilitychange", () => {
    antiInc("visibility");
  });

  window.addEventListener("blur", () => {
    antiInc("blur");
  });

  document.addEventListener("copy", () => antiInc("copy"));
  document.addEventListener("paste", () => antiInc("paste"));

  document.addEventListener("keydown", (e) => {
    if (e.key === "PrintScreen") antiInc("printscreen");
  });
}

// ===== Exam state =====
const exam = {
  durationSec: 600,
  startedAt: null,
  endsAt: null,
  timerInt: null,
  questions: [],
  idx: 0,
  answers: [],
  candidate: null,
  cv: null
};

function formatMMSS(sec) {
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(Math.floor(sec % 60)).padStart(2, "0");
  return `${mm}:${ss}`;
}

function enableTimerUI() {
  const timerBox = $("timerBox");
  if (timerBox) timerBox.classList.remove("hidden");
}

function disableTimerUI() {
  const timerBox = $("timerBox");
  if (timerBox) timerBox.classList.add("hidden");
}

// ===== API headers =====
function apiHeaders() {
  const h = { "Content-Type": "application/json" };
  if (PUBLIC_EVAL_API_KEY) h["X-API-Key"] = PUBLIC_EVAL_API_KEY;
  return h;
}

// ===== API =====
async function loadPositions() {
  const sel = $("role");
  if (!sel) return;

  sel.innerHTML = `<option value="">Cargando...</option>`;

  try {
    const r = await fetch(ENDPOINT_POSITIONS, { method: "GET", headers: apiHeaders() });
    const data = await r.json();

    if (!data || data.ok === false) {
      sel.innerHTML = `<option value="">No se pudo cargar</option>`;
      return;
    }

    const rows = data.data || data.positions || [];
    sel.innerHTML = `<option value="">Selecciona...</option>`;

    for (const it of rows) {
      const opt = document.createElement("option");
      opt.value = it.position_id || it.id || "";
      opt.textContent = it.position_name || it.name || opt.value;
      sel.appendChild(opt);
    }
  } catch (e) {
    sel.innerHTML = `<option value="">No se pudo cargar</option>`;
    console.error(e);
  }
}

function pickOnePerModule(payload) {
  const out = [];
  const modules = (payload && payload.modules) || [];
  for (const m of modules) {
    const qs = (m.questions || []);
    if (!qs.length) continue;
    const q = qs[Math.floor(Math.random() * qs.length)];
    out.push({
      id: q.id,
      prompt: q.prompt,
      moduleId: m.id,
      moduleName: m.name
    });
  }
  return out;
}

async function loadEvaluationForPosition(positionId) {
  const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;

  const r = await fetch(url, { method: "GET", headers: apiHeaders() });
  const data = await r.json();

  if (!data || data.ok === false) {
    throw new Error((data && (data.error || data.msg)) || "No hay evaluación activa.");
  }

  const ev = data.eval || data.data || data;
  const durationMin = Number(ev.duration_minutes || ev.duration || 10);
  exam.durationSec = Math.max(60, durationMin * 60);

  if (ev.payload && ev.payload.modules) return pickOnePerModule(ev.payload);
  if (ev.modules) return pickOnePerModule({ modules: ev.modules });
  if (Array.isArray(ev.questions) && ev.questions.length) {
    return ev.questions.map(q => ({
      id: q.id,
      prompt: q.prompt,
      moduleId: q.moduleId || q.module_id || "",
      moduleName: q.moduleName || q.module_name || ""
    }));
  }
  if (ev.questions_json && ev.questions_json.modules) return pickOnePerModule(ev.questions_json);

  throw new Error("Formato de evaluación no soportado.");
}

// ===== Render question =====
function renderQuestion() {
  const q = exam.questions[exam.idx];
  if (!q) return;

  $("qText").textContent = `(${exam.idx + 1}/${exam.questions.length}) [${q.moduleName}] ${q.prompt}`;
  $("qAnswer").value = exam.answers[exam.idx] || "";
  $("qAnswer").focus();
}

function startTimer() {
  enableTimerUI();
  const ends = Date.now() + exam.durationSec * 1000;
  exam.startedAt = Date.now();
  exam.endsAt = ends;

  $("timer").textContent = formatMMSS(exam.durationSec);

  exam.timerInt = setInterval(() => {
    const left = Math.max(0, Math.floor((ends - Date.now()) / 1000));
    $("timer").textContent = formatMMSS(left);
    if (left <= 0) {
      clearInterval(exam.timerInt);
      exam.timerInt = null;
      finishExam(true);
    }
  }, 500);
}

// ===== Persist / Restore =====
function persistLock() {
  const lock = {
    startedAt: exam.startedAt,
    endsAt: exam.endsAt,
    durationSec: exam.durationSec,
    idx: exam.idx,
    answers: exam.answers,
    questions: exam.questions,
    candidate: exam.candidate,
    anti
  };
  setLock(lock);
}

function restoreLockIfAny() {
  const lock = getLock();
  if (!lock || !lock.endsAt || Date.now() > lock.endsAt) {
    clearLock();
    return;
  }

  exam.startedAt = lock.startedAt;
  exam.endsAt = lock.endsAt;
  exam.durationSec = lock.durationSec || 600;
  exam.idx = lock.idx || 0;
  exam.answers = lock.answers || [];
  exam.questions = lock.questions || [];
  exam.candidate = lock.candidate || null;

  if (lock.anti) {
    anti.startedAt = lock.anti.startedAt || anti.startedAt;
    anti.eventsGlobal = lock.anti.eventsGlobal || anti.eventsGlobal;
    anti.perQuestion = lock.anti.perQuestion || anti.perQuestion;
  }

  $("indexCard").classList.add("hidden");
  $("examCard").classList.remove("hidden");

  enableTimerUI();
  if (exam.timerInt) clearInterval(exam.timerInt);

  exam.timerInt = setInterval(() => {
    const left = Math.max(0, Math.floor((exam.endsAt - Date.now()) / 1000));
    $("timer").textContent = formatMMSS(left);
    if (left <= 0) {
      clearInterval(exam.timerInt);
      exam.timerInt = null;
      finishExam(true);
    }
  }, 500);

  renderQuestion();
}

// ===== Finish =====
async function finishExam(timedOut = false) {
  if (!timedOut) {
    for (let i = 0; i < exam.questions.length; i++) {
      if (!exam.answers[i] || !String(exam.answers[i]).trim()) {
        showExamError("Faltan respuestas. Completa todas antes de enviar.");
        return;
      }
    }
  }

  showExamError("");

  const payload = {
    candidate: exam.candidate,
    position_id: exam.candidate.position_id || "",
    meta: {
      startedAt: exam.startedAt,
      endsAt: exam.endsAt,
      submittedAt: Date.now(),
      timedOut,
      userAgent: navigator.userAgent || "",
      anti
    },
    questions: exam.questions.map((q, i) => ({
      id: q.id,
      prompt: q.prompt,
      moduleId: q.moduleId,
      moduleName: q.moduleName,
      answer: exam.answers[i] || ""
    })),
    cv: exam.cv
  };

  try {
    const r = await fetch(ENDPOINT_SUBMIT, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) {
      throw new Error((data && (data.error || data.msg)) || "No se pudo guardar la evaluación.");
    }

    clearLock();
    if (exam.timerInt) {
      clearInterval(exam.timerInt);
      exam.timerInt = null;
    }

    disableTimerUI();
    openModal("modalDone");
  } catch (e) {
    console.error(e);
    showExamError("No se pudo enviar. Verifica conexión y reintenta (no cierres la pestaña).");
  }
}

function resetToIndex() {
  $("examCard").classList.add("hidden");
  $("indexCard").classList.remove("hidden");

  $("candidateForm").reset();
  showFormError("");
  showExamError("");

  exam.startedAt = null;
  exam.endsAt = null;
  exam.questions = [];
  exam.idx = 0;
  exam.answers = [];
  exam.candidate = null;
  exam.cv = null;

  clearLock();
  disableTimerUI();
  closeModal("modalInfo");
  closeModal("modalDone");
}

// ===== Events =====
document.addEventListener("DOMContentLoaded", async () => {
  await loadPositions();
  restoreLockIfAny();

  $("candidateForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const err = validateForm();
    if (err) {
      showFormError(err);
      return;
    }
    showFormError("");
    openModal("modalInfo");
  });

  $("modalInfoClose").addEventListener("click", () => closeModal("modalInfo"));
  $("btnCancelStart").addEventListener("click", () => closeModal("modalInfo"));

  $("btnAcceptStart").addEventListener("click", async () => {
    closeModal("modalInfo");

    try {
      wireAntiFraude();

      const cvFile = $("cvFile").files[0];
      const cvBase64 = await fileToBase64(cvFile);

      const positionId = $("role").value.trim();

      exam.candidate = {
        first_name: $("firstName").value.trim(),
        last_name: $("lastName").value.trim(),
        cedula: onlyDigits($("cedula").value.trim()),
        email: $("email").value.trim(),
        phone: $("phone").value.trim(),
        github: $("github").value.trim(),
        linkedin: $("linkedin").value.trim(),
        university: $("university").value.trim(),
        career: $("career").value.trim(),
        semester: $("semester").value.trim(),
        position_id: positionId
      };

      exam.cv = {
        filename: cvFile.name || "cv.pdf",
        mime: "application/pdf",
        base64: cvBase64
      };

      exam.questions = await loadEvaluationForPosition(positionId);
      exam.answers = new Array(exam.questions.length).fill("");
      exam.idx = 0;

      $("indexCard").classList.add("hidden");
      $("examCard").classList.remove("hidden");

      startTimer();
      renderQuestion();
      persistLock();
    } catch (err) {
      console.error(err);
      showFormError("No se pudo iniciar la evaluación. Verifica conexión y que exista un banco activo para ese cargo.");
      resetToIndex();
    }
  });

  $("btnNext").addEventListener("click", async () => {
    const ans = $("qAnswer").value || "";
    exam.answers[exam.idx] = ans;
    persistLock();

    if (exam.idx < exam.questions.length - 1) {
      exam.idx++;
      renderQuestion();
      return;
    }

    await finishExam(false);
  });

  $("modalDoneClose").addEventListener("click", resetToIndex);
  $("btnDoneOk").addEventListener("click", resetToIndex);
});
