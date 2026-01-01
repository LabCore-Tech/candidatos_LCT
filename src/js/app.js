/* =========================
   LabCore Tech - Evaluación
   ========================= */

// ================= CONFIG =================
// Pega aquí el backend público (Render/dominio). Ejemplo:
const PROTRACK_API_BASE = "https://protrack-49um.onrender.com";//"https://protrack-backend.onrender.com"; // <-- cambia si tu URL es otra
const PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98"; // opcional

//const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`;
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

  if (!firstName) return "Nombre es obligatorio.";
  if (!lastName) return "Apellido es obligatorio.";
  if (!cedula || cedula.length < 6) return "Cédula inválida (solo números).";

  if (!email || !isEmail(email)) return "Correo inválido.";
  if (!phone || !isPhone(phone)) return "Celular inválido.";
  if (!github || !isUrl(github)) return "GitHub debe ser una URL válida.";

  if (linkedin && !isUrl(linkedin)) return "LinkedIn debe ser una URL válida o quedar vacío.";

  if (!university) return "Universidad es obligatoria.";
  if (!career) return "Carrera es obligatoria.";
  if (!semester) return "Semestre es obligatorio.";
  if (!role) return "Cargo a concursar es obligatorio.";

  if (!cvFile) return "Debes adjuntar la hoja de vida (PDF).";
  const isPdf = (cvFile.type === "application/pdf") || /\.pdf$/i.test(cvFile.name);
  if (!isPdf) return "La hoja de vida debe ser PDF.";
  const sizeMb = cvFile.size / (1024 * 1024);
  if (sizeMb > MAX_CV_MB) return `El PDF excede ${MAX_CV_MB} MB.`;

  if (!policyOk) return "Debes aceptar la Política de tratamiento de datos.";

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

// ===== API =====
async function loadPositions() {
  const sel = $("role");
  if (!sel) return;

  sel.innerHTML = `<option value="">Cargando...</option>`;

  try {
    const r = await fetch(ENDPOINT_POSITIONS, { method: "GET" });
    const data = await r.json();

    // Espera: { ok:true, data:[{position_id, position_name, area_code}] }
    const rows = (data && (data.data || data.positions || data)) || [];
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
  // payload: { modules:[{id,name,questions:[{id,prompt}]}] }
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
  // Endpoint actual: /api/gh/public/eval?position_id=...
  const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;

  const r = await fetch(url, { method: "GET" });
  const data = await r.json();

  // Espera: { ok:true, eval:{duration_minutes, questions|payload|...} }
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || "No hay evaluación activa.");
  }

  // Soportamos varias formas por compatibilidad
  const ev = data.eval || data.data || data;
  const durationMin = Number(ev.duration_minutes || ev.duration || 10);
  exam.durationSec = Math.max(60, durationMin * 60);

  // Si viene payload/modules:
  if (ev.payload && ev.payload.modules) {
    return pickOnePerModule(ev.payload);
  }

  // Si viene directo modules:
  if (ev.modules) {
    return pickOnePerModule({ modules: ev.modules });
  }

  // Si viene como "questions" ya preseleccionadas:
  if (Array.isArray(ev.questions) && ev.questions.length) {
    return ev.questions.map(q => ({
      id: q.id,
      prompt: q.prompt,
      moduleId: q.moduleId || q.module_id || "",
      moduleName: q.moduleName || q.module_name || ""
    }));
  }

  // Si viene payload con "modules" directo:
  if (ev.questions_json && ev.questions_json.modules) {
    return pickOnePerModule(ev.questions_json);
  }

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

// ===== Persist / Restore (simple) =====
function persistLock() {
  const lock = {
    startedAt: exam.startedAt,
    endsAt: exam.endsAt,
    durationSec: exam.durationSec,
    idx: exam.idx,
    answers: exam.answers,
    questions: exam.questions,
    candidate: exam.candidate
  };
  setLock(lock);
}

function restoreLockIfAny() {
  const lock = getLock();
  if (!lock || !lock.endsAt || Date.now() > lock.endsAt) {
    clearLock();
    return;
  }

  // Restaurar
  exam.startedAt = lock.startedAt;
  exam.endsAt = lock.endsAt;
  exam.durationSec = lock.durationSec || 600;
  exam.idx = lock.idx || 0;
  exam.answers = lock.answers || [];
  exam.questions = lock.questions || [];
  exam.candidate = lock.candidate || null;

  // UI
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
  // Validar todas respondidas si no fue timeout
  if (!timedOut) {
    for (let i = 0; i < exam.questions.length; i++) {
      if (!exam.answers[i] || !String(exam.answers[i]).trim()) {
        showExamError("Faltan respuestas. Completa todas antes de enviar.");
        return;
      }
    }
  }

  showExamError("");

  // Payload para backend ProTrack (ajusta según tu app.py actual)
  const payload = {
    candidate: exam.candidate,
    position_id: exam.candidate.position_id || "",
    meta: {
      startedAt: exam.startedAt,
      endsAt: exam.endsAt,
      submittedAt: Date.now(),
      timedOut,
      userAgent: navigator.userAgent || ""
    },
    questions: exam.questions.map((q, i) => ({
      id: q.id,
      prompt: q.prompt,
      moduleId: q.moduleId,
      moduleName: q.moduleName,
      answer: exam.answers[i] || ""
    })),
    cv: exam.cv // {filename,mime,base64}
  };

  try {
    await fetch(ENDPOINT_SUBMIT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    clearLock();
    if (exam.timerInt) {
      clearInterval(exam.timerInt);
      exam.timerInt = null;
    }

    disableTimerUI();
    openModal("modalDone");
  } catch (e) {
    console.error(e);
    // Igual muestra modal para no bloquear UX (pero deja lock por si quieres reintentar)
    openModal("modalDone");
  }
}

function resetToIndex() {
  $("examCard").classList.add("hidden");
  $("indexCard").classList.remove("hidden");

  // Reset form
  $("candidateForm").reset();
  showFormError("");
  showExamError("");

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
        mime: cvFile.type || "application/pdf",
        base64: cvBase64
      };

      // Cargar evaluación por cargo (desde ProTrack)
      exam.questions = await loadEvaluationForPosition(positionId);
      exam.answers = new Array(exam.questions.length).fill("");
      exam.idx = 0;

      // Cambiar UI a examen
      $("indexCard").classList.add("hidden");
      $("examCard").classList.remove("hidden");

      startTimer();
      renderQuestion();
      persistLock();
    } catch (err) {
      console.error(err);
      showFormError("No se pudo iniciar la evaluación. Revisa conexión y que exista un banco activo para ese cargo.");
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
    // Última pregunta => enviar
    await finishExam(false);
  });

  $("modalDoneClose").addEventListener("click", resetToIndex);
  $("btnDoneOk").addEventListener("click", resetToIndex);
});
