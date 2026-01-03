/* =========================
   LabCore Tech - Evaluación (Repo A)
   Conecta con ProTrack (Repo B) vía endpoints públicos /api/gh/public/*
   ========================= */

// ================= CONFIG =================
const PROTRACK_BASE = "https://protrack-49um.onrender.com"; // backend real (Render)
const PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98"; // Si en Render configuraste PUBLIC_EVAL_API_KEY, ponlo aquí (NO ES SECRETO si lo pones en GitHub Pages)

const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`;
const ENDPOINT_EVAL = `${PROTRACK_BASE}/api/gh/public/eval`;          // ?position_id=...
const ENDPOINT_SUBMIT = `${PROTRACK_BASE}/api/gh/public/submit`;      // POST

const MAX_CV_MB = 8;
const LOCK_KEY = "labcore_eval_lock_v2";

// Anti-trampa (se guarda en meta)
const VIOLATION_LIMIT = 50;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function apiHeaders() {
  const h = { "Content-Type": "application/json" };
  if (PUBLIC_EVAL_API_KEY && PUBLIC_EVAL_API_KEY.trim()) {
    h["X-API-Key"] = PUBLIC_EVAL_API_KEY.trim();
  }
  return h;
}

function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Permite + y números
  return s.replace(/[^\d+]/g, "");
}

function isValidEmail(email) {
  const s = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isValidGithub(url) {
  const s = String(url || "").trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.hostname.toLowerCase().includes("github.com");
  } catch {
    return false;
  }
}

function isDigitsOnly(v) {
  return /^\d+$/.test(String(v || "").trim());
}

function bytesToMB(b) {
  return b / (1024 * 1024);
}

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
  document.body.classList.add("modal-open");
}

function closeModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function safeSetLock(payload) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(payload));
}

function safeGetLock() {
  try {
    return JSON.parse(localStorage.getItem(LOCK_KEY) || "null");
  } catch {
    return null;
  }
}

function clearLock() {
  localStorage.removeItem(LOCK_KEY);
}

// ================= POSITIONS =================
async function loadPositions() {
  const sel = $("role");
  if (!sel) return;

  sel.innerHTML = `<option value="">Cargando...</option>`;

  try {
    const r = await fetch(ENDPOINT_POSITIONS, {
      method: "GET",
      headers: PUBLIC_EVAL_API_KEY ? { "X-API-Key": PUBLIC_EVAL_API_KEY.trim() } : undefined,
    });

    const data = await r.json().catch(() => null);

    if (!r.ok || !data || data.ok !== true) {
      sel.innerHTML = `<option value="">No se pudo cargar</option>`;
      console.error("Positions error:", r.status, data);
      return;
    }

    const rows = data.positions || [];
    sel.innerHTML = `<option value="">Selecciona...</option>`;

    for (const it of rows) {
      const opt = document.createElement("option");
      opt.value = it.position_id || "";
      opt.textContent = it.position_name || opt.value;
      opt.dataset.area = it.area_code || "";
      sel.appendChild(opt);
    }
  } catch (e) {
    sel.innerHTML = `<option value="">No se pudo cargar</option>`;
    console.error(e);
  }
}

// ================= EVAL BUILD =================
// Backend devuelve lista plana: [{id,prompt,moduleId,moduleName}, ...]
// Aquí escogemos 1 aleatoria por módulo
function pickOnePerModuleFromFlat(flatQuestions) {
  const groups = new Map();
  for (const q of flatQuestions || []) {
    const mid = String(q.moduleId || "M1");
    if (!groups.has(mid)) groups.set(mid, []);
    groups.get(mid).push(q);
  }

  const chosen = [];
  for (const [mid, arr] of groups.entries()) {
    if (!arr.length) continue;
    const q = arr[Math.floor(Math.random() * arr.length)];
    chosen.push({
      id: String(q.id || ""),
      prompt: String(q.prompt || ""),
      moduleId: String(q.moduleId || mid),
      moduleName: String(q.moduleName || ""),
    });
  }

  // Orden estable por moduleId para UI (opcional)
  chosen.sort((a, b) => (a.moduleId > b.moduleId ? 1 : -1));
  return chosen;
}

async function fetchEvalForPosition(positionId) {
  const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;

  const r = await fetch(url, {
    method: "GET",
    headers: PUBLIC_EVAL_API_KEY ? { "X-API-Key": PUBLIC_EVAL_API_KEY.trim() } : undefined,
  });

  const data = await r.json().catch(() => null);

  if (!r.ok || !data || data.ok !== true) {
    const msg = (data && (data.msg || data.error)) || `Error cargando evaluación (${r.status})`;
    throw new Error(msg);
  }

  const flat = data.questions || [];
  const chosen = pickOnePerModuleFromFlat(flat);

  if (!chosen.length) {
    throw new Error("La evaluación no tiene preguntas configuradas.");
  }

  return {
    position: data.position || null,
    qb: data.qb || null,
    questionsChosen: chosen,
  };
}

// ================= CV (PDF base64) =================
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

// ================= VALIDATION =================
function validateForm() {
  const required = [];
  const firstName = ($("firstName")?.value || "").trim();
  const lastName = ($("lastName")?.value || "").trim();
  const cedula = ($("cedula")?.value || "").trim();
  const email = ($("email")?.value || "").trim();
  const phone = normalizePhone(($("phone")?.value || "").trim());
  const github = ($("github")?.value || "").trim();
  const positionId = ($("role")?.value || "").trim();
  const university = ($("university")?.value || "").trim();
  const career = ($("career")?.value || "").trim();
  const semester = ($("semester")?.value || "").trim();
  const acceptPolicy = $("acceptPolicy")?.checked === true;

  const cvInput = $("cvFile");
  const cvFile = cvInput && cvInput.files && cvInput.files[0] ? cvInput.files[0] : null;

  if (!firstName) required.push("Nombre");
  if (!lastName) required.push("Apellido");
  if (!cedula) required.push("Cédula");
  if (!positionId) required.push("Cargo a concursar");
  if (!email) required.push("Correo");
  if (!phone) required.push("Celular");
  if (!github) required.push("GitHub");
  if (!university) required.push("Universidad");
  if (!career) required.push("Carrera");
  if (!semester) required.push("Semestre");
  if (!cvFile) required.push("Hoja de vida (PDF)");

  if (required.length) {
    return `Debe ingresar los datos obligatorios: ${required.join(", ")}.`;
  }

  if (!isDigitsOnly(cedula)) return "La cédula debe contener solo números.";
  if (!isValidEmail(email)) return "El correo no es válido.";
  if (!isValidGithub(github)) return "El GitHub debe ser un enlace válido (github.com).";
  if (!acceptPolicy) return "Debe aceptar la Política de tratamiento de datos.";

  if (cvFile) {
    const mb = bytesToMB(cvFile.size);
    if (mb > MAX_CV_MB) return `El PDF supera el máximo permitido (${MAX_CV_MB} MB).`;
    if (cvFile.type !== "application/pdf" && !String(cvFile.name || "").toLowerCase().endsWith(".pdf")) {
      return "El CV debe ser únicamente PDF.";
    }
  }

  return "";
}

// ================= ANTI-TRAMPA =================
const violations = [];
let currentQuestionId = null;

function addViolation(type, detail) {
  const v = {
    at: new Date().toISOString(),
    type,
    detail: detail || "",
    questionId: currentQuestionId || null,
  };
  violations.push(v);

  // hard limit (solo log, no bloquea aún)
  if (violations.length > VIOLATION_LIMIT) {
    console.warn("Demasiadas violaciones registradas:", violations.length);
  }
}

function attachAntiCheat() {
  document.addEventListener("copy", () => addViolation("copy", ""));
  document.addEventListener("paste", () => addViolation("paste", ""));
  document.addEventListener("cut", () => addViolation("cut", ""));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) addViolation("tab_hidden", "visibilitychange");
  });

  window.addEventListener("blur", () => addViolation("window_blur", "blur"));

  // PrintScreen no es 100% detectable en todos los navegadores
  document.addEventListener("keydown", (e) => {
    const k = String(e.key || "").toLowerCase();
    if (k === "printscreen") addViolation("printscreen", "");
    // Ctrl+Shift+I / F12 -> devtools (no bloqueamos, solo registramos)
    if (k === "f12") addViolation("devtools_key", "F12");
    if (e.ctrlKey && e.shiftKey && (k === "i" || k === "j" || k === "c")) addViolation("devtools_key", "ctrl+shift+" + k);
  });
}

// ================= UI: RENDER EXAM =================
function renderExam(questions) {
  const wrap = $("examWrap");
  const list = $("examQuestions");
  const timerEl = $("timer");
  const btnSend = $("btnSend");
  const btnCancel = $("btnCancel");

  if (!wrap || !list) return;

  wrap.classList.remove("hidden");
  list.innerHTML = "";

  questions.forEach((q, idx) => {
    const card = document.createElement("div");
    card.className = "qcard";

    const title = document.createElement("div");
    title.className = "qtitle";
    title.textContent = `${idx + 1}. ${q.moduleName || "Módulo"} — Pregunta`;
    card.appendChild(title);

    const prompt = document.createElement("div");
    prompt.className = "qprompt";
    prompt.textContent = q.prompt || "";
    card.appendChild(prompt);

    const ta = document.createElement("textarea");
    ta.className = "qanswer";
    ta.rows = 4;
    ta.placeholder = "Escribe tu respuesta...";
    ta.dataset.qid = q.id;
    ta.addEventListener("focus", () => {
      currentQuestionId = q.id;
    });
    card.appendChild(ta);

    list.appendChild(card);
  });

  // Timer básico (10 min fijo, si quieres tomarlo del backend luego lo hacemos)
  let seconds = 10 * 60;
  const tick = () => {
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    if (timerEl) timerEl.textContent = `${mm}:${ss}`;
    seconds--;
    if (seconds < 0) {
      clearInterval(intv);
      // auto-send
      btnSend?.click();
    }
  };
  tick();
  const intv = setInterval(tick, 1000);

  btnCancel?.addEventListener("click", () => {
    clearInterval(intv);
    closeExam();
  }, { once: true });

  btnSend?.addEventListener("click", async () => {
    btnSend.disabled = true;
    showExamError("");

    try {
      const answers = [];
      const textareas = list.querySelectorAll("textarea.qanswer");
      textareas.forEach((ta) => {
        const qid = ta.dataset.qid || "";
        const q = questions.find(x => String(x.id) === String(qid));
        answers.push({
          id: qid,
          moduleId: q?.moduleId || "",
          moduleName: q?.moduleName || "",
          prompt: q?.prompt || "",
          answer: (ta.value || "").trim(),
        });
      });

      await submitAll(answers);
      clearInterval(intv);
    } catch (e) {
      btnSend.disabled = false;
      showExamError(e?.message || "No se pudo enviar la evaluación.");
      console.error(e);
    }
  }, { once: true });
}

function closeExam() {
  const wrap = $("examWrap");
  if (wrap) wrap.classList.add("hidden");
  const list = $("examQuestions");
  if (list) list.innerHTML = "";
  showExamError("");
  clearLock();
}

// ================= SUBMIT =================
async function submitAll(answers) {
  // candidate form values
  const firstName = ($("firstName")?.value || "").trim();
  const lastName = ($("lastName")?.value || "").trim();
  const cedula = ($("cedula")?.value || "").trim();
  const email = ($("email")?.value || "").trim();
  const phone = normalizePhone(($("phone")?.value || "").trim());
  const github = ($("github")?.value || "").trim();
  const linkedin = ($("linkedin")?.value || "").trim();
  const university = ($("university")?.value || "").trim();
  const career = ($("career")?.value || "").trim();
  const semester = ($("semester")?.value || "").trim();
  const positionId = ($("role")?.value || "").trim();

  const cvInput = $("cvFile");
  const cvFile = cvInput && cvInput.files && cvInput.files[0] ? cvInput.files[0] : null;
  if (!cvFile) throw new Error("Debe adjuntar el PDF.");

  const cvBase64 = await fileToBase64(cvFile);

  const candidate = {
    positionId,
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
  };

  const meta = {
    submittedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    violations: violations.slice(0),
  };

  const payload = {
    candidate,
    meta,
    questions: answers,
    cv: {
      filename: cvFile.name,
      name: cvFile.name,
      mime: "application/pdf",
      base64: cvBase64,
      size: cvFile.size,
    },
  };

  const r = await fetch(ENDPOINT_SUBMIT, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => null);

  if (!r.ok || !data || data.ok !== true) {
    const msg = (data && (data.msg || data.error)) || `Error enviando (${r.status})`;
    throw new Error(msg);
  }

  // OK modal
  openModal("modalOk");
}

async function startEvaluationFlow() {
  const positionId = ($("role")?.value || "").trim();
  if (!positionId) throw new Error("Debe seleccionar el cargo a concursar.");

  // Trae evaluación desde ProTrack
  const ev = await fetchEvalForPosition(positionId);

  // Guarda lock (si recarga la página)
  safeSetLock({
    startedAt: new Date().toISOString(),
    positionId,
    qb: ev.qb,
    position: ev.position,
    questionsChosen: ev.questionsChosen,
    violations: violations,
  });

  // render
  renderExam(ev.questionsChosen);
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", async () => {
  // anti-cheat listeners siempre activos (solo registran)
  attachAntiCheat();

  // carga cargos
  await loadPositions();

  // submit inicial (abre modal confirmación)
  const form = $("candidateForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const err = validateForm();
      if (err) {
        showFormError(err);
        return;
      }
      showFormError("");
      openModal("modalInfo");
    });
  }

  // modal confirmación
  $("modalInfoClose")?.addEventListener("click", () => closeModal("modalInfo"));
  $("modalInfoCancel")?.addEventListener("click", () => closeModal("modalInfo"));

  $("modalInfoContinue")?.addEventListener("click", async () => {
    closeModal("modalInfo");
    try {
      await startEvaluationFlow();
    } catch (e) {
      showFormError(e?.message || "No se pudo iniciar la evaluación.");
      console.error(e);
    }
  });

  // modal OK final
  $("modalOkClose")?.addEventListener("click", () => {
    closeModal("modalOk");
    // Limpia para permitir otra evaluación
    closeExam();
    // opcional: recargar
    // location.reload();
  });

  // Si había lock, NO reanudamos automático (para evitar “cochinadas”)
  // Solo limpiamos si existe.
  const lock = safeGetLock();
  if (lock) {
    clearLock();
  }
});
