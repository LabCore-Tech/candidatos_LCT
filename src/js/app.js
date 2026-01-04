/* =========================
   LabCore Tech - Evaluación (Repo GH Pages)
   Conecta con ProTrack (Render) vía endpoints públicos /api/gh/public/*
   ========================= */

// ================= CONFIG =================
const PROTRACK_BASE = "https://protrack-49um.onrender.com";

// TU KEY (la que me mostraste en la captura)
const PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`; // GET
const ENDPOINT_EVAL      = `${PROTRACK_BASE}/api/gh/public/eval`;      // GET ?position_id=...
const ENDPOINT_SUBMIT    = `${PROTRACK_BASE}/api/gh/public/submit`;    // POST

const MAX_CV_MB = 8;
const LOCK_KEY = "labcore_eval_lock_v2";

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
  perQuestion: {}
};

function antiInc(type) {
  anti.eventsGlobal[type] = (anti.eventsGlobal[type] || 0) + 1;
  const idx = exam.idx;
  anti.perQuestion[idx] = anti.perQuestion[idx] || { blur:0, visibility:0, copy:0, paste:0, printscreen:0 };
  anti.perQuestion[idx][type] = (anti.perQuestion[idx][type] || 0) + 1;
  $("incidents").textContent = String(totalIncidents());
}

function totalIncidents() {
  const g = anti.eventsGlobal;
  return (g.blur||0)+(g.visibility||0)+(g.copy||0)+(g.paste||0)+(g.printscreen||0);
}

function wireAntiFraude() {
  anti.startedAt = Date.now();

  document.addEventListener("visibilitychange", () => antiInc("visibility"));
  window.addEventListener("blur", () => antiInc("blur"));
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
  cv: null,
  positionId: null
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
    const data = await r.json().catch(() => null);

    if (!r.ok || !data || data.ok === false) {
      sel.innerHTML = `<option value="">No hay cargos disponibles</option>`;
      showFormError("No se pudieron cargar cargos (unauthorized / key / endpoint).");
      return;
    }

    const rows = data.data || data.positions || data.items || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      sel.innerHTML = `<option value="">No hay cargos disponibles</option>`;
      return;
    }

    sel.innerHTML = `<option value="">Selecciona...</option>`;

    for (const it of rows) {
      const opt = document.createElement("option");
      opt.value = it.position_id ?? it.id ?? it.value ?? "";
      opt.textContent = it.position_name ?? it.name ?? it.label ?? opt.value;
      sel.appendChild(opt);
    }
  } catch (e) {
    sel.innerHTML = `<option value="">No hay cargos disponibles</option>`;
    showFormError("No se pudieron cargar cargos. Revisa Network > positions y Console.");
    console.error("Positions error:", e);
  }
}

function pickOnePerModule(payload) {
  // Espera una estructura tipo:
  // { modules: [ { title, questions: [...] }, ...] }
  // o { data: { modules: ... } } etc.
  const root = payload?.data ?? payload?.eval ?? payload ?? {};
  const modules = root.modules ?? root.sections ?? root.blocks ?? [];
  const out = [];

  for (const m of modules) {
    const qs = m.questions ?? m.items ?? [];
    if (!Array.isArray(qs) || qs.length === 0) continue;

    const pick = qs[Math.floor(Math.random() * qs.length)];
    out.push({
      module: m.title ?? m.name ?? "Módulo",
      id: pick.id ?? pick.qid ?? `${out.length+1}`,
      text: pick.text ?? pick.question ?? "",
      options: pick.options ?? pick.choices ?? []
    });
  }
  return out;
}

async function loadEvaluation(positionId) {
  const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;
  const r = await fetch(url, { method: "GET", headers: apiHeaders() });
  const data = await r.json().catch(() => null);

  if (!r.ok || !data || data.ok === false) {
    throw new Error("eval_load_failed");
  }

  const picked = pickOnePerModule(data);
  if (!picked.length) throw new Error("no_questions");

  return picked;
}

// ===== Rendering =====
function renderQuestion() {
  const host = $("questionHost");
  host.innerHTML = "";

  const q = exam.questions[exam.idx];
  if (!q) return;

  const card = document.createElement("div");
  card.className = "qcard";

  const title = document.createElement("div");
  title.className = "qtitle";
  title.textContent = `${exam.idx + 1}. ${q.module}: ${q.text}`;
  card.appendChild(title);

  const selected = exam.answers[exam.idx] ?? null;

  (q.options || []).forEach((op, i) => {
    const row = document.createElement("label");
    row.className = "opt";

    const inp = document.createElement("input");
    inp.type = "radio";
    inp.name = "qopt";
    inp.value = String(i);
    inp.checked = selected === i;

    inp.addEventListener("change", () => {
      exam.answers[exam.idx] = i;
      showExamError("");
    });

    const txt = document.createElement("span");
    txt.textContent = String(op);

    row.appendChild(inp);
    row.appendChild(txt);
    card.appendChild(row);
  });

  host.appendChild(card);

  $("btnPrev").disabled = exam.idx === 0;
  $("btnNext").disabled = exam.idx === exam.questions.length - 1;
}

function startTimer() {
  exam.startedAt = Date.now();
  exam.endsAt = exam.startedAt + exam.durationSec * 1000;

  enableTimerUI();

  const tick = () => {
    const left = Math.max(0, Math.ceil((exam.endsAt - Date.now()) / 1000));
    $("timer").textContent = formatMMSS(left);

    if (left <= 0) {
      clearInterval(exam.timerInt);
      exam.timerInt = null;
      submitEvaluation(true).catch(() => {});
    }
  };

  tick();
  exam.timerInt = setInterval(tick, 500);
}

// ===== Submit =====
async function submitEvaluation(auto = false) {
  // validación: todas respondidas
  for (let i = 0; i < exam.questions.length; i++) {
    if (typeof exam.answers[i] !== "number") {
      showExamError(`Falta responder la pregunta ${i + 1}.`);
      exam.idx = i;
      renderQuestion();
      return;
    }
  }

  const payload = {
    ok: true,
    auto,
    position_id: exam.positionId,
    candidate: exam.candidate,
    cv: exam.cv,
    answers: exam.questions.map((q, i) => ({
      qid: q.id,
      module: q.module,
      answer_index: exam.answers[i],
      answer_text: q.options?.[exam.answers[i]] ?? ""
    })),
    incidents: {
      total: totalIncidents(),
      global: anti.eventsGlobal,
      per_question: anti.perQuestion,
      started_at: anti.startedAt,
      finished_at: Date.now()
    },
    client_meta: {
      ua: navigator.userAgent,
      lang: navigator.language
    }
  };

  const r = await fetch(ENDPOINT_SUBMIT, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await r.json().catch(() => null);

  if (!r.ok || !data || data.ok === false) {
    const msg = data?.msg || "No se pudo enviar la evaluación.";
    showExamError(msg);
    return;
  }

  // Éxito
  clearLock(); // IMPORTANTÍSIMO: evita que salga popup al recargar
  $("mrMsg").textContent = "Evaluación enviada.";
  openModal("modalResult");
}

// ===== Init / Wire =====
function syncStartButtonEnabled() {
  const role = $("role").value.trim();
  const policyOk = $("acceptPolicy").checked;
  $("btnStart").disabled = !(role && policyOk);
}

function wireFilePicker() {
  const picker = $("cvPicker");
  const input = $("cvFile");

  picker.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (!f) {
      picker.classList.remove("has-file");
      picker.innerHTML = `Haz clic para adjuntar tu PDF <span class="pill">PDF</span>`;
      return;
    }
    picker.classList.add("has-file");
    picker.innerHTML = `${f.name} <span class="pill">PDF</span>`;
  });
}

function wireModals() {
  document.querySelectorAll("[data-close='1']").forEach((el) => {
    el.addEventListener("click", () => {
      closeModal("modalInfo");
      closeModal("modalResult");
    });
  });
}

async function startFlow() {
  showFormError("");

  const err = validateForm();
  if (err) {
    showFormError(err);
    return;
  }

  // prepara candidato + cv
  const cvFile = $("cvFile").files[0];
  const cvB64 = await fileToBase64(cvFile);

  exam.positionId = $("role").value.trim();
  exam.candidate = {
    firstName: $("firstName").value.trim(),
    lastName: $("lastName").value.trim(),
    cedula: onlyDigits($("cedula").value.trim()),
    email: $("email").value.trim(),
    phone: $("phone").value.trim(),
    github: $("github").value.trim(),
    linkedin: $("linkedin").value.trim(),
    university: $("university").value.trim(),
    career: $("career").value.trim(),
    semester: $("semester").value.trim()
  };
  exam.cv = {
    filename: cvFile.name,
    mime: cvFile.type || "application/pdf",
    base64: cvB64
  };

  // abre modal “Antes de iniciar”
  openModal("modalInfo");
}

async function continueToExam() {
  closeModal("modalInfo");
  showExamError("");

  // carga evaluación
  try {
    const questions = await loadEvaluation(exam.positionId);
    exam.questions = questions;
    exam.answers = Array(questions.length).fill(null);
    exam.idx = 0;

    $("examCard").classList.remove("hidden");
    window.scrollTo({ top: $("examCard").offsetTop - 10, behavior: "smooth" });

    wireAntiFraude();
    startTimer();
    renderQuestion();

    // guarda lock SOLO cuando ya inició
    setLock({ startedAt: Date.now(), positionId: exam.positionId });
  } catch (e) {
    console.error(e);
    showFormError("No se pudo cargar la evaluación para ese cargo.");
  }
}

function init() {
  // Nunca mostrar modal al cargar
  closeModal("modalInfo");
  closeModal("modalResult");

  // Si existía lock viejo (de otra corrida), no bloquees ni muestres popups
  // (solo úsalo si más adelante quieres retomar sesión)
  // Por ahora: NO hacemos nada con lock.

  wireModals();
  wireFilePicker();

  $("acceptPolicy").addEventListener("change", syncStartButtonEnabled);
  $("role").addEventListener("change", syncStartButtonEnabled);

  $("btnStart").addEventListener("click", () => startFlow().catch((e)=>console.error(e)));
  $("btnContinue").addEventListener("click", () => continueToExam().catch((e)=>console.error(e)));

  $("btnPrev").addEventListener("click", () => {
    if (exam.idx > 0) { exam.idx--; renderQuestion(); }
  });
  $("btnNext").addEventListener("click", () => {
    if (exam.idx < exam.questions.length - 1) { exam.idx++; renderQuestion(); }
  });
  $("btnSubmit").addEventListener("click", () => submitEvaluation(false).catch((e)=>console.error(e)));

  // inputs
  $("cedula").addEventListener("input", (e) => {
    e.target.value = onlyDigits(e.target.value);
  });

  // Cargar cargos
  loadPositions().then(() => syncStartButtonEnabled()).catch(()=>{});

  // Estado inicial
  syncStartButtonEnabled();
}

document.addEventListener("DOMContentLoaded", init);
