/* ============================
   LabCore - Evaluación (Repo B)
   GitHub Pages -> Render API
   ============================ */

// ✅ CAMBIA SOLO SI TU DOMINIO CAMBIA
const PROTRACK_BASE = "https://protrack-49um.onrender.com";

// ✅ DEBE SER IGUAL al PUBLIC_EVAL_API_KEY en Render
const PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`;
const ENDPOINT_EVAL      = `${PROTRACK_BASE}/api/gh/public/eval`;
const ENDPOINT_SUBMIT    = `${PROTRACK_BASE}/api/gh/public/submit`;

const MAX_CV_MB = 8;

// ===== Helpers DOM =====
const $ = (id) => document.getElementById(id);

function showAlert(msg) {
  const box = $("alertBox");
  if (!box) return;
  box.textContent = msg;
  box.classList.remove("hidden");
}
function hideAlert() {
  const box = $("alertBox");
  if (!box) return;
  box.classList.add("hidden");
  box.textContent = "";
}

function showExamMsg(msg) {
  const box = $("examMsg");
  if (!box) return;
  box.textContent = msg;
  box.classList.remove("hidden");
}
function hideExamMsg() {
  const box = $("examMsg");
  if (!box) return;
  box.classList.add("hidden");
  box.textContent = "";
}

// ===== File helpers =====
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

function bytesToMB(bytes) {
  return bytes / 1024 / 1024;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===== Estado evaluación =====
let exam = {
  position: null,
  modules: [],
  picks: [],       // [{moduleName, question}]
  idx: 0,
  answers: [],     // [{moduleName, questionId, questionText, answerText}]
  timerSec: 600,
  timerHandle: null,
};

// ===== API fetch wrapper =====
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("X-Api-Key", PUBLIC_EVAL_API_KEY);

  const res = await fetch(url, {
    ...options,
    headers,
    mode: "cors",
    cache: "no-store",
  });

  // Si tu backend responde 401, aquí lo verás clarito
  let data = null;
  try { data = await res.json(); } catch { data = null; }

  return { ok: res.ok, status: res.status, data };
}

// ===== 1) Cargar cargos =====
async function loadPositions() {
  const sel = $("role");
  if (!sel) return;

  sel.innerHTML = `<option value="">Cargando...</option>`;

  const { ok, status, data } = await apiFetch(ENDPOINT_POSITIONS, { method: "GET" });

  if (!ok) {
    // Esto te muestra el motivo real
    const msg = data?.msg || `No se pudo cargar (HTTP ${status})`;
    sel.innerHTML = `<option value="">No hay cargos disponibles</option>`;
    showAlert(`Cargos: ${msg}`);
    return;
  }

  // Formatos aceptados:
  // A) { ok:true, positions:[{id,name}] }
  // B) { ok:true, data:[...] }
  // C) [{...}]
  const list =
    data?.positions ||
    data?.data ||
    (Array.isArray(data) ? data : []);

  if (!Array.isArray(list) || list.length === 0) {
    sel.innerHTML = `<option value="">No hay cargos disponibles</option>`;
    showAlert("No hay cargos disponibles.");
    return;
  }

  hideAlert();
  sel.innerHTML = `<option value="">Selecciona...</option>`;
  for (const p of list) {
    const id = p.id ?? p.position_id ?? p.value ?? "";
    const name = p.name ?? p.cargo ?? p.title ?? p.label ?? "";
    const opt = document.createElement("option");
    opt.value = String(id || name);
    opt.textContent = String(name || id);
    sel.appendChild(opt);
  }
}

// ===== Validación formulario =====
function validateForm() {
  hideAlert();

  const firstName = $("firstName")?.value.trim();
  const lastName  = $("lastName")?.value.trim();
  const idNumber  = $("idNumber")?.value.trim();
  const role      = $("role")?.value.trim();
  const email     = $("email")?.value.trim();
  const phone     = $("phone")?.value.trim();
  const github    = $("github")?.value.trim();
  const university= $("university")?.value.trim();
  const career    = $("career")?.value.trim();
  const semester  = $("semester")?.value.trim();
  const accept    = $("acceptPolicy")?.checked;

  const cv = $("cvFile")?.files?.[0] || null;

  const missing = [];
  if (!firstName) missing.push("Nombre");
  if (!lastName) missing.push("Apellido");
  if (!idNumber) missing.push("Cédula");
  if (!role) missing.push("Cargo a concursar");
  if (!email) missing.push("Correo");
  if (!phone) missing.push("Celular");
  if (!github) missing.push("GitHub");
  if (!university) missing.push("Universidad");
  if (!career) missing.push("Carrera");
  if (!semester) missing.push("Semestre");
  if (!cv) missing.push("Hoja de vida (PDF)");
  if (!accept) missing.push("Política de tratamiento de datos");

  if (missing.length) {
    showAlert(`Debe ingresar los datos obligatorios: ${missing.join(", ")}.`);
    return { ok:false };
  }

  if (cv.type !== "application/pdf") {
    showAlert("La hoja de vida debe ser un PDF.");
    return { ok:false };
  }

  if (bytesToMB(cv.size) > MAX_CV_MB) {
    showAlert(`El PDF excede el máximo permitido (${MAX_CV_MB} MB).`);
    return { ok:false };
  }

  return {
    ok: true,
    values: {
      firstName, lastName, idNumber, role, email, phone, github,
      linkedin: $("linkedin")?.value.trim() || "",
      university, career, semester,
      cv
    }
  };
}

// ===== 2) Modal =====
function openModal()  { $("modalInfo")?.classList.remove("hidden"); }
function closeModal() { $("modalInfo")?.classList.add("hidden"); }

// ===== 3) Evaluación (JSON) =====
function normalizeEvalPayload(data) {
  // Formatos aceptados:
  // A) { ok:true, modules:[{name, questions:[...]}] }
  // B) { ok:true, eval:{modules:[...]}}
  // C) { ok:true, data:{modules:[...]}}
  // D) { ok:true, modules:{...} } (lo convertimos a array)
  const mods =
    data?.modules ||
    data?.eval?.modules ||
    data?.data?.modules ||
    [];

  if (Array.isArray(mods)) return mods;

  if (mods && typeof mods === "object") {
    // object -> array
    return Object.keys(mods).map((k) => ({
      name: k,
      questions: mods[k]
    }));
  }

  return [];
}

function pickOneQuestionPerModule(modules) {
  const picks = [];

  const shuffledModules = shuffle(modules);

  for (const m of shuffledModules) {
    const moduleName = m.name || m.module || m.title || "Módulo";
    const qs = Array.isArray(m.questions) ? m.questions : (Array.isArray(m.qs) ? m.qs : []);

    if (!qs.length) continue;

    const q = qs[Math.floor(Math.random() * qs.length)];
    picks.push({
      moduleName,
      question: q
    });
  }

  return picks;
}

function renderCurrentQuestion() {
  hideExamMsg();

  const pick = exam.picks[exam.idx];
  if (!pick) {
    $("qText").textContent = "No hay preguntas para mostrar.";
    return;
  }

  const q = pick.question || {};
  const qText =
    q.text || q.question || q.pregunta || q.title || "Pregunta";

  const qId =
    q.id || q.question_id || q.uuid || `${exam.idx+1}`;

  $("qModule").textContent = pick.moduleName;
  $("qIndex").textContent = `Pregunta ${exam.idx + 1} / ${exam.picks.length}`;
  $("qText").textContent = qText;

  $("qAnswer").value = exam.answers[exam.idx]?.answerText || "";

  // Guardamos meta actual
  exam.currentQuestionId = String(qId);
  exam.currentQuestionText = String(qText);
}

function saveCurrentAnswer() {
  const pick = exam.picks[exam.idx];
  if (!pick) return;

  const answerText = $("qAnswer").value.trim();

  exam.answers[exam.idx] = {
    moduleName: pick.moduleName,
    questionId: exam.currentQuestionId || `${exam.idx+1}`,
    questionText: exam.currentQuestionText || "",
    answerText
  };
}

function startTimer() {
  clearInterval(exam.timerHandle);

  const timerEl = $("timer");
  const tick = () => {
    const m = String(Math.floor(exam.timerSec / 60)).padStart(2, "0");
    const s = String(exam.timerSec % 60).padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;

    if (exam.timerSec <= 0) {
      clearInterval(exam.timerHandle);
      showExamMsg("Tiempo finalizado. Enviando evaluación...");
      submitExam().catch(() => {});
      return;
    }
    exam.timerSec -= 1;
  };

  tick();
  exam.timerHandle = setInterval(tick, 1000);
}

async function loadEvaluation(positionValue, candidate) {
  // pedimos al backend el JSON de evaluación
  const url = `${ENDPOINT_EVAL}?position=${encodeURIComponent(positionValue)}`;

  const { ok, status, data } = await apiFetch(url, { method: "GET" });

  if (!ok) {
    const msg = data?.msg || `No se pudo cargar evaluación (HTTP ${status})`;
    throw new Error(msg);
  }

  const modules = normalizeEvalPayload(data);
  if (!modules.length) throw new Error("La evaluación no contiene módulos.");

  const picks = pickOneQuestionPerModule(modules);
  if (!picks.length) throw new Error("No hay preguntas disponibles en los módulos.");

  exam.position = positionValue;
  exam.modules = modules;
  exam.picks = picks;
  exam.idx = 0;
  exam.answers = new Array(picks.length).fill(null);
  exam.timerSec = 600;

  // Guardamos candidato para submit
  exam.candidate = candidate;

  // Mostrar sección examen
  $("examSection").classList.remove("hidden");

  renderCurrentQuestion();
  startTimer();
}

// ===== Submit =====
async function submitExam() {
  saveCurrentAnswer();

  const payload = {
    position: exam.position,
    candidate: exam.candidate,
    answers: exam.answers,
    incidents: Number($("incidents")?.textContent || "0")
  };

  const { ok, status, data } = await apiFetch(ENDPOINT_SUBMIT, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  if (!ok) {
    const msg = data?.msg || `No se pudo enviar (HTTP ${status})`;
    showExamMsg(msg);
    return;
  }

  showExamMsg("Evaluación enviada correctamente.");
  clearInterval(exam.timerHandle);
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", async () => {
  // 1) Hook PDF field
  const cvPicker = $("cvPicker");
  const cvFile = $("cvFile");
  const cvText = $("cvText");

  cvPicker?.addEventListener("click", () => cvFile?.click());

  cvFile?.addEventListener("change", () => {
    const f = cvFile.files?.[0];
    cvText.textContent = f ? f.name : "Haz clic para adjuntar tu PDF";
  });

  // 2) Enable start button when policy checked
  const btnStart = $("btnStart");
  $("acceptPolicy")?.addEventListener("change", () => {
    btnStart.disabled = !$("acceptPolicy").checked;
  });

  // 3) Modal actions
  $("modalInfoClose")?.addEventListener("click", closeModal);
  $("modalInfo")?.addEventListener("click", (e) => {
    if (e.target?.id === "modalInfo") closeModal();
  });

  // 4) Start flow
  btnStart?.addEventListener("click", () => {
    const v = validateForm();
    if (!v.ok) return;
    openModal();
  });

  $("modalInfoContinue")?.addEventListener("click", async () => {
    closeModal();

    const v = validateForm();
    if (!v.ok) return;

    try {
      const { values } = v;

      // Armamos candidato
      const cvBase64 = await fileToBase64(values.cv);

      const candidate = {
        firstName: values.firstName,
        lastName: values.lastName,
        idNumber: values.idNumber,
        email: values.email,
        phone: values.phone,
        github: values.github,
        linkedin: values.linkedin,
        university: values.university,
        career: values.career,
        semester: values.semester,
        cv: {
          filename: values.cv.name,
          mime: values.cv.type,
          base64: cvBase64
        }
      };

      await loadEvaluation(values.role, candidate);
    } catch (err) {
      showAlert(`Error: ${err?.message || "No se pudo iniciar la evaluación."}`);
    }
  });

  // 5) Next / Submit
  $("btnNext")?.addEventListener("click", () => {
    saveCurrentAnswer();
    if (exam.idx < exam.picks.length - 1) {
      exam.idx += 1;
      renderCurrentQuestion();
    } else {
      showExamMsg("Ya estás en la última pregunta. Puedes enviar la evaluación.");
    }
  });

  $("btnSubmit")?.addEventListener("click", () => {
    submitExam().catch((e) => showExamMsg(e?.message || "Error al enviar."));
  });

  // 6) Load cargos
  await loadPositions();
});
