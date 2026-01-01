/* =========================
   LabCore Tech - Evaluación
   ========================= */

// ================= CONFIG =================
/**
 * ProTrack Backend (Render)
 * - PUBLIC_EVAL_CORS en backend debe permitir tu dominio (o "*")
 * - Si configuras PUBLIC_EVAL_API_KEY en backend, pon aquí el mismo valor.
 */
const PROTRACK_API_BASE = "https://protrack-49um.onrender.com";//"https://protrack-backend.onrender.com"; // <-- cambia si tu URL es otra
const PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98"; // opcional

// 10 minutos total
const TOTAL_SEC = 10 * 60;

// max recomendado 8 MB
const MAX_CV_BYTES = 8 * 1024 * 1024;

// lock local
const LOCK_KEY = "lct_exam_lock_v1";

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function show(el, flag) {
  if (!el) return;
  el.classList.toggle("hidden", !flag);
}

function openModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.add("modal--open");
}

function closeModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.remove("modal--open");
}

function showFormError(msg) {
  $("formError").textContent = msg || "";
}

function showExamError(msg) {
  $("examError").textContent = msg || "";
}

function sanitizeName(v) {
  return (v || "").trim().replace(/\s+/g, " ");
}

function hasLock() {
  try {
    return JSON.parse(localStorage.getItem(LOCK_KEY) || "null");
  } catch {
    return null;
  }
}

function setLock() {
  const v = { active: true, ts: Date.now() };
  localStorage.setItem(LOCK_KEY, JSON.stringify(v));
}

function clearLock() {
  localStorage.removeItem(LOCK_KEY);
}

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const result = reader.result || "";
      const base64 = String(result).split(",")[1] || "";
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

// ================= STATE =================
let exam = {
  startedAt: null,
  endsAt: null,
  timerInt: null,
  questions: [],
  idx: 0,
  answers: [],
  candidate: null,
  cv: null,
  timedOut: false,
  tabChanges: 0,
  pasteCount: 0,
  copyCount: 0,
  screenshotAttempts: 0,
  totalBlurTime: 0,
  blurStart: null,
  metaBase: {}
};

// ================= CARGOS DINÁMICOS =================
async function loadPositions() {
  try {
    const resp = await fetch(`${PROTRACK_API_BASE}/api/gh/public/positions`, {
      headers: {
        ...(PUBLIC_EVAL_API_KEY ? { "X-API-Key": PUBLIC_EVAL_API_KEY } : {})
      }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok || !Array.isArray(data.positions)) return;

    const sel = $("role");
    const current = sel.value;

    // limpiar excepto placeholder
    sel.querySelectorAll("option").forEach((opt, idx) => {
      if (idx === 0) return;
      opt.remove();
    });

    data.positions.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.position_id;
      opt.textContent = p.position_name;
      opt.dataset.area = p.area_code || "";
      sel.appendChild(opt);
    });

    if (current) sel.value = current;
  } catch (e) {
    console.warn("No se pudo cargar cargos desde ProTrack:", e);
  }
}

// ================= VALIDATION =================
function validateForm() {
  const firstName = sanitizeName($("firstName").value);
  const lastName = sanitizeName($("lastName").value);
  const cedula = $("cedula").value.trim();
  const email = ($("email").value || "").trim();
  const phone = ($("phone").value || "").trim();
  const github = ($("github").value || "").trim();
  const linkedin = ($("linkedin").value || "").trim();

  const university = sanitizeName($("university").value);
  const career = $("career").value;
  const semester = $("semester").value;
  const role = $("role").value; // ahora es position_id
  const acceptPolicy = $("acceptPolicy").checked;
  const file = $("cvFile").files && $("cvFile").files[0];

  if (!firstName) return "Nombre es obligatorio";
  if (!lastName) return "Apellido es obligatorio";
  if (!cedula) return "Cédula es obligatoria";
  if (!/^\d+$/.test(cedula)) return "Cédula debe contener solo números";

  if (!email) return "Correo es obligatorio";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Correo no es válido";

  if (!phone) return "Celular es obligatorio";
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 10) return "Celular no es válido";

  if (!github) return "GitHub es obligatorio";
  if (!/^https?:\/\/(www\.)?github\.com\/.+/i.test(github)) return "GitHub debe ser un link válido";

  if (!university) return "Universidad es obligatoria";
  if (!career) return "Carrera es obligatoria";
  if (!semester) return "Semestre es obligatorio";
  if (!role) return "Cargo a ocupar es obligatorio";
  if (!file) return "Debes cargar tu hoja de vida (PDF)";

  if (file.size > MAX_CV_BYTES) return "Archivo demasiado grande (máx. 8 MB)";
  const mime = (file.type || "").toLowerCase();
  if (mime !== "application/pdf") return "El CV debe ser PDF";

  if (!acceptPolicy) return "Debes aceptar la Política de datos";

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    cedula,
    email,
    phone: phoneDigits,
    github,
    linkedin,
    university,
    career,
    semester,
    role
  };
}

// ================= UI FLOW =================
function showExamUI() {
  show($("examSection"), true);
  $("candidateForm").classList.add("hidden");
}

function renderQuestion() {
  const q = exam.questions[exam.idx];
  $("qModule").textContent = q.moduleName ? `${q.moduleName}` : "";
  $("qText").textContent = `${exam.idx + 1}. ${q.prompt}`;
  $("qAnswer").value = exam.answers[exam.idx] || "";
  $("qAnswer").focus();

  if (exam.idx === exam.questions.length - 1) {
    $("btnNext").textContent = "Enviar";
  } else {
    $("btnNext").textContent = "Siguiente";
  }
}

function startTimer() {
  $("timer").textContent = formatTime(TOTAL_SEC);
  exam.startedAt = Date.now();
  exam.endsAt = exam.startedAt + TOTAL_SEC * 1000;

  exam.timerInt = setInterval(() => {
    const remain = Math.max(0, Math.floor((exam.endsAt - Date.now()) / 1000));
    $("timer").textContent = formatTime(remain);

    if (remain <= 0) {
      exam.timedOut = true;
      clearInterval(exam.timerInt);
      exam.timerInt = null;
      submitExam();
    }
  }, 250);
}

// ================= ANTI-FRAUD (lo que ya tenías, respetado) =================
function enableLeaveGuard() {
  window.onbeforeunload = () => "Hay una evaluación en curso.";
}

function disableLeaveGuard() {
  window.onbeforeunload = null;
}

// ================= EXAM =================
async function beginExam() {
  const lock = hasLock();
  if (lock && lock.active) {
    showFormError("Ya hay una evaluación en progreso.");
    return;
  }

  const validation = validateForm();
  if (typeof validation === "string") {
    showFormError(validation);
    return;
  }

  const candidate = validation;
  const file = $("cvFile").files[0];

  try {
    setLock();
    enableLeaveGuard();

    const base64 = await fileToBase64(file);

    exam.cv = {
      name: file.name,
      mime: file.type || "application/pdf",
      base64
    };

    // Obtener preguntas desde ProTrack según cargo
    try {
      const positionId = $("role").value;
      const url = `${PROTRACK_API_BASE}/api/gh/public/eval?position_id=${encodeURIComponent(positionId)}`;
      const response = await fetch(url, {
        headers: {
          ...(PUBLIC_EVAL_API_KEY ? { "X-API-Key": PUBLIC_EVAL_API_KEY } : {})
        }
      });
      const result = await response.json();

      if (!result.ok || !result.questions) {
        showFormError("Error al cargar preguntas.");
        return;
      }

      exam.questions = result.questions;
      exam.answers = new Array(exam.questions.length).fill("");
      exam.idx = 0;

      exam.candidate = candidate;
      exam.metaBase = {
        area: result.position.area_code,
        positionId: result.position.position_id,
        positionName: result.position.position_name,
        qb: result.qb
      };

      closeModal("modalInfo");
      showExamUI();
      renderQuestion();
      startTimer();
    } catch (err) {
      console.error("Error al obtener preguntas:", err);
      showFormError("Error de conexión.");
    }
  } catch (fileError) {
    console.error("Error procesando archivo:", fileError);
    showFormError("Error al procesar la hoja de vida.");
  }
}

async function submitExam() {
  $("btnNext").disabled = true;
  showExamError("");

  for (let i = 0; i < exam.answers.length; i++) {
    if (!exam.answers[i] || exam.answers[i].trim() === "") {
      showExamError("Debes responder todas las preguntas antes de enviar.");
      exam.idx = i;
      renderQuestion();
      $("btnNext").disabled = false;
      return;
    }
  }

  const actualDuration = Math.floor((Date.now() - exam.startedAt) / 1000);

  const payload = {
    candidate: {
      ...exam.candidate,
      positionId: $("role").value
    },
    meta: {
      ...exam.metaBase,
      startedAt: new Date(exam.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      actualDurationSeconds: actualDuration,
      timedOut: !!exam.timedOut,
      tabChanges: exam.tabChanges,
      pasteCount: exam.pasteCount,
      copyCount: exam.copyCount,
      screenshotAttempts: exam.screenshotAttempts,
      totalBlurTime: exam.totalBlurTime,
      userAgent: navigator.userAgent || ""
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
    const resp = await fetch(`${PROTRACK_API_BASE}/api/gh/public/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(PUBLIC_EVAL_API_KEY ? { "X-API-Key": PUBLIC_EVAL_API_KEY } : {})
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      throw new Error((data && (data.msg || data.message)) || "submit_failed");
    }

    clearLock();
    if (exam.timerInt) {
      clearInterval(exam.timerInt);
      exam.timerInt = null;
    }
    disableLeaveGuard();
    openModal("modalDone");
  } catch (err) {
    console.error("Error enviando evaluación:", err);
    showExamError("No se pudo guardar. Reintenta.");
    $("btnNext").disabled = false;
  }
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", () => {
  loadPositions();

  $("cedula").addEventListener("input", function () {
    this.value = this.value.replace(/\D/g, "");
  });

  $("cvFile").addEventListener("change", function () {
    const file = this.files[0];
    if (file && file.size > MAX_CV_BYTES) {
      showFormError("Archivo demasiado grande (máx. 8 MB)");
      this.value = "";
    }
    if (file) {
      const mime = (file.type || "").toLowerCase();
      if (mime !== "application/pdf") {
        showFormError("El CV debe ser PDF");
        this.value = "";
      }
    }
  });

  $("btnStart").addEventListener("click", function (e) {
    e.preventDefault();
    showFormError("");
    const validation = validateForm();
    if (typeof validation === "string") {
      showFormError(validation);
      return;
    }
    openModal("modalInfo");
  });

  $("modalInfoClose").addEventListener("click", () => closeModal("modalInfo"));
  $("btnCancelStart").addEventListener("click", () => closeModal("modalInfo"));
  $("btnAcceptStart").addEventListener("click", () => beginExam());

  $("btnNext").addEventListener("click", function () {
    const currentAnswer = $("qAnswer").value.trim();
    if (!currentAnswer || currentAnswer === "") {
      showExamError("Debes escribir una respuesta.");
      return;
    }
    exam.answers[exam.idx] = currentAnswer;

    if (exam.idx === exam.questions.length - 1) {
      submitExam();
      return;
    }
    exam.idx++;
    renderQuestion();
  });

  $("btnDoneClose").addEventListener("click", () => {
    closeModal("modalDone");
    location.reload();
  });
});
