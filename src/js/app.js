/* ===========================
   LabCore Tech - Evaluación (Repo B)
   Conecta con ProTrack (Repo A) vía endpoints públicos /api/gh/public/*
   =========================== */

// ================= CONFIG =================
const PROTRACK_BASE = "https://protrack-49um.onrender.com"; // backend real (Render)
const PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98"; // MISMO que en Render

const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`;
const ENDPOINT_EVAL = `${PROTRACK_BASE}/api/gh/public/eval`;       // ?position_id=...
const ENDPOINT_SUBMIT = `${PROTRACK_BASE}/api/gh/public/submit`;   // POST

const MAX_CV_MB = 8;
const LOCK_KEY = "labcore_eval_lock_v2";
const VIOLATION_LIMIT = 50;

// =============== Helpers UI ===============
function $(id) { return document.getElementById(id); }

function initCvPicker() {
  const input = $("cvFile");     // <-- ESTE ID debe coincidir con tu input real
  const text  = $("cvText");     // <-- ESTE es el span donde se muestra el nombre

  if (!input || !text) return;

  const paint = () => {
    const f = input.files && input.files[0];
    text.textContent = f ? f.name : "Haz clic para adjuntar tu PDF";
  };

  input.addEventListener("change", paint);
  paint();
}

function setText(id, txt) {
  const el = $(id);
  if (el) el.textContent = txt;
}

function showTopError(msg) {
  const el = $("formError");
  if (!el) return;
  el.style.display = msg ? "block" : "none";
  el.textContent = msg || "";
}

function showExamError(msg) {
  const el = $("examError");
  if (!el) return;
  el.style.display = msg ? "block" : "none";
  el.textContent = msg || "";
}

function openModal(id) {
  const m = $(id);
  if (m) m.classList.add("open");
}

function closeModal(id) {
  const m = $(id);
  if (m) m.classList.remove("open");
}

// =============== Network helper (SIEMPRE manda API KEY) ===============
async function fetchJSON(url, options = {}) {
  const headers = Object.assign(
    { "Content-Type": "application/json", "X-API-Key": PUBLIC_EVAL_API_KEY },
    options.headers || {}
  );

  const res = await fetch(url, {
    mode: "cors",
    credentials: "omit",
    ...options,
    headers
  });

  const txt = await res.text();
  let data = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }

  if (!res.ok) {
    const msg = (data && (data.msg || data.error)) ? (data.msg || data.error) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// =============== Base64 ===============
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const res = fr.result || "";
      const parts = String(res).split(",");
      resolve(parts.length > 1 ? parts[1] : "");
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// =============== Exam state ===============
const exam = {
  startedAt: null,
  endsAt: null,
  questions: [],
  idx: 0,
  answers: [],
  candidate: null,
  cv: null,
  violations: 0
};

// =============== Random helpers ===============
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// =============== Load positions (dropdown) ===============
async function loadPositions() {
  const sel = $("positionSelect");
  if (!sel) return;

  sel.innerHTML = `<option value="">Cargando...</option>`;

  try {
    const resp = await fetchJSON(ENDPOINT_POSITIONS, { method: "GET" });
    const rows = resp.positions || resp.items || resp.data || [];

    if (!rows.length) {
      sel.innerHTML = `<option value="">No hay cargos activos</option>`;
      return;
    }

    sel.innerHTML = `<option value="">Selecciona un cargo</option>`;
    rows.forEach(p => {
      const id = p.position_id || p.id || p.positionId || "";
      const name = p.position_name || p.name || p.positionName || "Cargo";
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      sel.appendChild(opt);
    });

  } catch (e) {
    sel.innerHTML = `<option value="">No se pudo cargar</option>`;
    showTopError(`No se pudo cargar cargos: ${e.message}`);
  }
}

// =============== Load evaluation by position ===============
async function loadEval(positionId) {
  const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;
  const resp = await fetchJSON(url, { method: "GET" });

  // Tu backend devuelve:
  // { ok:true, position:{...}, qb:{...}, questions:[...] }
  const questions = resp.questions || [];
  if (!questions.length) throw new Error("No hay preguntas en el banco activo.");

  // Aleatorizar: orden aleatorio de módulos + 1 pregunta aleatoria por módulo
  const byModule = {};
  questions.forEach(q => {
    const m = q.moduleId || q.module_id || "M1";
    if (!byModule[m]) byModule[m] = [];
    byModule[m].push(q);
  });

  const moduleIds = shuffle(Object.keys(byModule));
  const picked = [];

  moduleIds.forEach(mid => {
    const qs = byModule[mid] || [];
    const rnd = qs[Math.floor(Math.random() * qs.length)];
    picked.push(rnd);
  });

  return picked;
}

// =============== Lock ===============
function setLock() {
  localStorage.setItem(LOCK_KEY, JSON.stringify({
    startedAt: exam.startedAt,
    endsAt: exam.endsAt,
    candidate: exam.candidate ? { ...exam.candidate, cv: null } : null
  }));
}

function clearLock() {
  localStorage.removeItem(LOCK_KEY);
}

// =============== Timer UI (simple) ===============
let timerHandle = null;

function disableTimerUI() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
  setText("timer", "");
}

function startTimer() {
  if (!exam.endsAt) return;
  disableTimerUI();

  timerHandle = setInterval(() => {
    const now = Date.now();
    const left = exam.endsAt - now;
    if (left <= 0) {
      disableTimerUI();
      finishExam(true);
      return;
    }
    const sec = Math.floor(left / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    setText("timer", `${mm}:${ss}`);
  }, 500);
}

// =============== Render question ===============
function renderQuestion() {
  const q = exam.questions[exam.idx];
  if (!q) return;

  setText("qModule", q.moduleName || "");
  setText("qNum", `${exam.idx + 1} / ${exam.questions.length}`);
  setText("qText", q.prompt || "");

  const ans = $("answerInput");
  if (ans) ans.value = exam.answers[exam.idx] || "";
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const res = fr.result || "";
      const parts = String(res).split(",");
      resolve(parts.length > 1 ? parts[1] : "");
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// =============== Start exam ===============
async function startExam() {
  showTopError("");

  const name = ($("name")?.value || "").trim();
  const lastname = ($("lastname")?.value || "").trim();
  const doc = ($("doc")?.value || "").trim();
  const email = ($("email")?.value || "").trim();
  const phone = ($("phone")?.value || "").trim();
  const github = ($("github")?.value || "").trim();
  const linkedin = ($("linkedin")?.value || "").trim();
  const university = ($("university")?.value || "").trim();
  const career = ($("career")?.value || "").trim();
  const semester = ($("semester")?.value || "").trim();
  const positionId = ($("positionSelect")?.value || "").trim();
  const policyOk = $("policy")?.checked;

  const cvFile = $("cv")?.files?.[0];

  if (!positionId) return showTopError("Debe ingresar los datos obligatorios: Cargo a concursar.");
  if (!name || !lastname || !doc || !email || !phone || !github || !university || !career || !semester)
    return showTopError("Debe completar todos los campos obligatorios (*).");
  if (!cvFile) return showTopError("Debe adjuntar la hoja de vida (PDF).");
  if (!policyOk) return showTopError("Debe aceptar la Política de tratamiento de datos.");

  if (cvFile.size > MAX_CV_MB * 1024 * 1024)
    return showTopError(`El PDF supera ${MAX_CV_MB} MB.`);

  const cvBase64 = await fileToBase64(cvFile);

  // candidate payload (ajusta llaves si tu backend espera otras)
  exam.candidate = {
    name,
    lastname,
    doc,
    email,
    phone,
    github,
    linkedin,
    university,
    career,
    semester,
    positionId
  };

  exam.cv = {
    name: cvFile.name,
    mime: "application/pdf",
    base64: cvBase64
  };

  // Traer evaluación desde ProTrack
  try {
    exam.questions = await loadEval(positionId);
  } catch (e) {
    return showTopError(`No se pudo cargar evaluación: ${e.message}`);
  }

  // Inicializar estado
  exam.idx = 0;
  exam.answers = new Array(exam.questions.length).fill("");
  exam.violations = 0;

  // Tiempo (ejemplo: 20 min)
  exam.startedAt = Date.now();
  exam.endsAt = exam.startedAt + (20 * 60 * 1000);

  setLock();
  startTimer();

  // Mostrar modal/section de examen
  openModal("modalExam");
  renderQuestion();
}

// =============== Navigation ===============
function saveAnswer() {
  const ans = $("answerInput");
  if (!ans) return;
  exam.answers[exam.idx] = (ans.value || "").trim();
}

function nextQ() {
  saveAnswer();
  if (exam.idx < exam.questions.length - 1) {
    exam.idx++;
    renderQuestion();
  }
}

function prevQ() {
  saveAnswer();
  if (exam.idx > 0) {
    exam.idx--;
    renderQuestion();
  }
}

// =============== Submit exam ===============
async function finishExam(timedOut = false) {
  try {
    saveAnswer();
    showExamError("");

    // Validación básica: no permitir vacíos
    for (let i = 0; i < exam.questions.length; i++) {
      if (!String(exam.answers[i] || "").trim()) {
        if (!timedOut) {
          exam.idx = i;
          renderQuestion();
          return showExamError("Faltan respuestas. Completa todas antes de enviar.");
        }
      }
    }

    const payload = {
      candidate: exam.candidate,
      meta: {
        startedAt: exam.startedAt,
        endsAt: exam.endsAt,
        submittedAt: Date.now(),
        timedOut,
        violations: exam.violations,
        userAgent: navigator.userAgent || ""
      },
      questions: exam.questions.map((q, i) => ({
        id: q.id,
        moduleId: q.moduleId,
        moduleName: q.moduleName,
        prompt: q.prompt,
        answer: exam.answers[i] || ""
      })),
      cv: exam.cv
    };

    const resp = await fetchJSON(ENDPOINT_SUBMIT, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (!resp.ok) throw new Error(resp.msg || resp.error || "No se pudo enviar.");

    closeModal("modalExam");
    openModal("modalDone");

  } catch (e) {
    showExamError(`No se pudo enviar: ${e.message}`);
  } finally {
    // Reset state
    exam.startedAt = null;
    exam.endsAt = null;
    exam.questions = [];
    exam.idx = 0;
    exam.answers = [];
    exam.candidate = null;
    exam.cv = null;

    clearLock();
    disableTimerUI();
  }
}

// =============== Wire events ===============
document.addEventListener("DOMContentLoaded", () => {
  loadPositions();
  initCvPicker();

  
  $("btnStart")?.addEventListener("click", (e) => {
    e.preventDefault();
    startExam();
  });

  $("btnNext")?.addEventListener("click", (e) => { e.preventDefault(); nextQ(); });
  $("btnPrev")?.addEventListener("click", (e) => { e.preventDefault(); prevQ(); });

  $("btnSubmit")?.addEventListener("click", (e) => {
    e.preventDefault();
    finishExam(false);
  });

  $("btnCloseDone")?.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal("modalDone");
  });
});
