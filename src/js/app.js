/* ===============================
   LabCore Tech - Evaluación (Repo B)
   Conecta con ProTrack (Repo A) vía endpoints públicos /api/gh/public/*
   =============================== */

/* ===============================
   CONFIG
   =============================== */
const PROTRACK_BASE = "https://protrack-49um.onrender.com"; // Backend real (Render)
const PUBLIC_EVAL_API_KEY =
  "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98"; // Debe coincidir con Render ENV

const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`; // GET
const ENDPOINT_EVAL = `${PROTRACK_BASE}/api/gh/public/eval`; // GET ?position_id=...
const ENDPOINT_SUBMIT = `${PROTRACK_BASE}/api/gh/public/submit`; // POST

const MAX_CV_MB = 8;
const LOCK_KEY = "labcore_eval_lock_v2";
const EVAL_DURATION_SEC = 10 * 60; // 10 minutos

/* ===============================
   HELPERS
   =============================== */
const $ = (id) => document.getElementById(id);

function setText(id, txt) {
  const el = $(id);
  if (el) el.textContent = txt;
}

function show(el) {
  if (el) el.hidden = false;
}
function hide(el) {
  if (el) el.hidden = true;
}

function showFormError(msg) {
  const box = $("formError");
  if (!box) return;
  box.textContent = msg;
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearFormError() {
  const box = $("formError");
  if (!box) return;
  box.textContent = "";
  box.hidden = true;
}

function isPdf(file) {
  if (!file) return false;
  const typeOk = (file.type || "").toLowerCase() === "application/pdf";
  const nameOk = (file.name || "").toLowerCase().endsWith(".pdf");
  return typeOk || nameOk;
}

function bytesToMB(bytes) {
  return bytes / (1024 * 1024);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function safeJson(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await res.json();
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { ok: false, msg: txt || "Respuesta no JSON" };
  }
}

async function apiFetch(url, { method = "GET", json = null } = {}) {
  const headers = {
    Accept: "application/json",
    "X-API-Key": PUBLIC_EVAL_API_KEY,
  };
  if (json) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    mode: "cors",
    body: json ? JSON.stringify(json) : undefined,
  });

  const data = await safeJson(res);
  if (!res.ok || data?.ok === false) {
    const msg = data?.msg || data?.error || `Error HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
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

/* ===============================
   MODAL (modalInfo)
   =============================== */
function openModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.add("open");
  m.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.remove("open");
  m.setAttribute("aria-hidden", "true");
}

function setStartModalContent({ title = null, msg = null, acceptLabel = null, mode = null } = {}) {
  const modal = document.getElementById("modalInfo");
  if (!modal) return;
  if (mode) modal.dataset.mode = mode;

  const titleEl = document.getElementById("modalInfoTitle");
  if (titleEl && title !== null) titleEl.textContent = title;

  const msgEl = modal.querySelector(".modal-text");
  if (msgEl && msg !== null) msgEl.textContent = msg;

  const btn = document.getElementById("btnAcceptStart");
  if (btn && acceptLabel !== null) btn.textContent = acceptLabel;
}

/* ===============================
   CV PICKER (sin botón nativo)
   =============================== */
function setupCvPicker() {
  const picker = $("cvPicker");
  const input = $("cvFile");
  const nameEl = $("cvName");
  const phEl = $("cvPlaceholder");

  if (!picker || !input) return;

  const openPicker = () => input.click();

  picker.addEventListener("click", openPicker);
  picker.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });

  input.addEventListener("change", () => {
    const file = input.files && input.files[0] ? input.files[0] : null;

    if (!file) {
      if (nameEl) {
        nameEl.hidden = true;
        nameEl.textContent = "";
      }
      if (phEl) phEl.hidden = false;
      return;
    }

    if (nameEl) {
      nameEl.textContent = file.name;
      nameEl.hidden = false;
    }
    if (phEl) phEl.hidden = true;
  });
}

/* ===============================
   POSITIONS (Cargos)
   =============================== */
async function loadPositions() {
  const sel = $("role");
  if (!sel) return;

  sel.disabled = true;
  sel.innerHTML = `<option value="">Cargando...</option>`;

  try {
    const data = await apiFetch(ENDPOINT_POSITIONS);

    const list = Array.isArray(data)
      ? data
      : Array.isArray(data.positions)
      ? data.positions
      : Array.isArray(data.data)
      ? data.data
      : [];

    const normalized = list
      .map((p) => ({
        id: String(p.id ?? p.position_id ?? p.value ?? "").trim(),
        label: String(p.name ?? p.title ?? p.cargo ?? p.label ?? p.descripcion ?? "").trim(),
      }))
      .filter((p) => p.id && p.label);

    sel.innerHTML =
      `<option value="">Selecciona...</option>` +
      normalized.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join("");

    sel.disabled = false;

    if (!normalized.length) {
      sel.innerHTML = `<option value="">No hay cargos disponibles</option>`;
      sel.disabled = true;
    }
  } catch (err) {
    sel.innerHTML = `<option value="">No se pudo cargar</option>`;
    sel.disabled = true;
    console.error("loadPositions:", err);
  }
}

/* ===============================
   FORM VALIDATION
   =============================== */
function validateForm() {
  clearFormError();

  const firstName = $("firstName")?.value?.trim();
  const lastName = $("lastName")?.value?.trim();
  const cedula = $("cedula")?.value?.trim();
  const role = $("role")?.value?.trim();
  const email = $("email")?.value?.trim();
  const phone = $("phone")?.value?.trim();
  const github = $("github")?.value?.trim();
  const university = $("university")?.value?.trim();
  const career = $("career")?.value?.trim();
  const semester = $("semester")?.value?.trim();
  const okPolicy = $("acceptPolicy")?.checked;

  const cvInput = $("cvFile");
  const cvFile = cvInput?.files?.[0] || null;

  if (!firstName || !lastName || !cedula || !role || !email || !phone || !github || !university || !career || !semester) {
    showFormError("Debe ingresar los datos obligatorios.");
    return false;
  }

  if (!okPolicy) {
    showFormError("Debe aceptar la Política de tratamiento de datos.");
    return false;
  }

  if (!cvFile) {
    showFormError("Debe adjuntar la hoja de vida (PDF).");
    return false;
  }

  if (!isPdf(cvFile)) {
    showFormError("La hoja de vida debe ser un archivo PDF.");
    return false;
  }

  if (bytesToMB(cvFile.size) > MAX_CV_MB) {
    showFormError(`El PDF supera el máximo permitido (${MAX_CV_MB} MB).`);
    return false;
  }

  return true;
}

function collectFormData() {
  const cvInput = $("cvFile");
  const cvFile = cvInput?.files?.[0] || null;

  return {
    first_name: $("firstName")?.value?.trim() || "",
    last_name: $("lastName")?.value?.trim() || "",
    document: $("cedula")?.value?.trim() || "",
    position_id: $("role")?.value?.trim() || "",
    email: $("email")?.value?.trim() || "",
    phone: $("phone")?.value?.trim() || "",
    github: $("github")?.value?.trim() || "",
    linkedin: $("linkedin")?.value?.trim() || "",
    university: $("university")?.value?.trim() || "",
    career: $("career")?.value?.trim() || "",
    semester: $("semester")?.value?.trim() || "",
    cv_file: cvFile,
  };
}

/* ===============================
   EVALUATION FLOW
   =============================== */
let evalState = {
  candidate: null,
  position_id: null,
  questions: [], // [{module, q, answer}]
  idx: 0,
  timer: null,
  remaining: EVAL_DURATION_SEC,
};

function renderExamShell() {
  const card = $("examCard");
  const formCard = $("indexCard");
  if (formCard) hide(formCard);
  if (card) show(card);

  if (card) {
    card.innerHTML = `
      <div class="exam-top">
        <div class="exam-title">Evaluación</div>
        <div id="timerBox" class="timerBox" aria-live="polite">
          <span class="timerLabel">Tiempo</span>
          <span id="timer" class="timer">10:00</span>
        </div>
      </div>

      <div class="exam-body">
        <div class="exam-progress">
          <span id="qCounter">1 / 8</span>
          <span class="exam-module" id="qModule"></span>
        </div>

        <div class="question">
          <div class="qText" id="qText"></div>
          <div class="qHelp" id="qHelp" hidden></div>
        </div>

        <div class="options" id="optionsBox"></div>
      </div>

      <div class="exam-actions">
        <button class="btn secondary" id="btnNext">Siguiente</button>
        <button class="btn primary" id="btnFinishExam">Finalizar</button>
      </div>
    `;
  }
}

function renderQuestion() {
  const total = evalState.questions.length;
  const i = evalState.idx;

  setText("qCounter", `${i + 1} / ${total}`);

  const item = evalState.questions[i];
  setText("qModule", item.module || "");

  setText("qText", item.q?.text || item.q?.question || "Pregunta");
  const help = item.q?.help || item.q?.hint || "";
  const helpEl = $("qHelp");
  if (helpEl) {
    if (help) {
      helpEl.textContent = help;
      helpEl.hidden = false;
    } else {
      helpEl.textContent = "";
      helpEl.hidden = true;
    }
  }

  const box = $("optionsBox");
  if (!box) return;

  const optsRaw = Array.isArray(item.q?.options)
    ? item.q.options
    : Array.isArray(item.q?.answers)
    ? item.q.answers
    : [];

  const opts = optsRaw
    .map((o, idx) => {
      if (typeof o === "string") return { value: String(idx), label: o };
      return {
        value: String(o.id ?? o.value ?? idx),
        label: String(o.label ?? o.text ?? o.name ?? o.option ?? ""),
      };
    })
    .filter((o) => o.label);

  box.innerHTML = opts
    .map((o) => {
      const checked = item.answer === o.value ? "checked" : "";
      return `
        <label class="opt">
          <input type="radio" name="qOpt" value="${escapeHtml(o.value)}" ${checked}>
          <span>${escapeHtml(o.label)}</span>
        </label>
      `;
    })
    .join("");

  if (!opts.length) {
    const val = item.answer_text || "";
    box.innerHTML = `
      <textarea id="qOpen" class="openAnswer" rows="4" placeholder="Escribe tu respuesta...">${escapeHtml(val)}</textarea>
    `;
  }

  const btnNext = $("btnNext");
  if (btnNext) btnNext.textContent = i === total - 1 ? "Terminar" : "Siguiente";
}

function captureAnswer() {
  const item = evalState.questions[evalState.idx];
  const open = $("qOpen");
  if (open) {
    item.answer_text = open.value.trim();
    item.answer = null;
    return;
  }
  const checked = document.querySelector('input[name="qOpt"]:checked');
  item.answer = checked ? checked.value : null;
}

function buildRandomizedQuestions(evaluation) {
  const modules = Array.isArray(evaluation.modules)
    ? evaluation.modules
    : Array.isArray(evaluation.data?.modules)
    ? evaluation.data.modules
    : Array.isArray(evaluation.eval?.modules)
    ? evaluation.eval.modules
    : [];

  const cleaned = modules
    .map((m) => ({
      name: String(m.name ?? m.title ?? m.module ?? "Módulo").trim(),
      questions: Array.isArray(m.questions) ? m.questions : Array.isArray(m.items) ? m.items : [],
    }))
    .filter((m) => m.questions.length);

  const orderModules = shuffle(cleaned);

  return orderModules.map((m) => ({
    module: m.name,
    q: pickRandom(m.questions),
    answer: null,
    answer_text: "",
  }));
}

function startTimer() {
  evalState.remaining = EVAL_DURATION_SEC;

  const tick = () => {
    const mm = Math.floor(evalState.remaining / 60);
    const ss = evalState.remaining % 60;
    setText("timer", `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`);

    if (evalState.remaining <= 0) {
      clearInterval(evalState.timer);
      evalState.timer = null;
      finishExam(true);
      return;
    }
    evalState.remaining -= 1;
  };

  tick();
  evalState.timer = setInterval(tick, 1000);
}

async function startEvaluationFlow() {
  const lock = localStorage.getItem(LOCK_KEY);
  if (lock) {
    setStartModalContent({
      mode: "locked",
      title: "Evaluación en curso",
      msg: "Ya existe una evaluación en curso en este navegador.",
      acceptLabel: "Entendido",
    });
    openModal("modalInfo");
    return;
  }

  if (!validateForm()) return;

  const btn = $("btnStart");
  if (btn) btn.disabled = true;

  try {
    const form = collectFormData();
    const cv_b64 = await fileToBase64(form.cv_file);

    const submitPayload = {
      ...form,
      cv_b64,
      cv_name: form.cv_file?.name || "",
      cv_mime: form.cv_file?.type || "application/pdf",
    };
    delete submitPayload.cv_file;

    const submitRes = await apiFetch(ENDPOINT_SUBMIT, { method: "POST", json: submitPayload });

    evalState.candidate = submitRes.candidate || submitRes.data?.candidate || submitRes.data || null;
    evalState.position_id = form.position_id;

    const evalUrl = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(form.position_id)}`;
    const evaluation = await apiFetch(evalUrl);

    const questions = buildRandomizedQuestions(evaluation);
    if (!questions.length) throw new Error("No hay preguntas configuradas para este cargo.");

    evalState.questions = questions;
    evalState.idx = 0;

    localStorage.setItem(LOCK_KEY, JSON.stringify({ started_at: Date.now(), position_id: form.position_id }));

    closeModal("modalInfo");
    renderExamShell();
    renderQuestion();
    startTimer();

    $("btnNext")?.addEventListener("click", () => {
      captureAnswer();
      if (evalState.idx >= evalState.questions.length - 1) {
        finishExam(false);
        return;
      }
      evalState.idx += 1;
      renderQuestion();
    });

    $("btnFinishExam")?.addEventListener("click", () => finishExam(false));
  } catch (err) {
    console.error("startEvaluationFlow:", err);
    showFormError(err.message || "Error inesperado al iniciar la evaluación.");
    closeModal("modalInfo");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function finishExam(auto = false) {
  captureAnswer();

  if (evalState.timer) {
    clearInterval(evalState.timer);
    evalState.timer = null;
  }

  const answers = evalState.questions.map((it, idx) => ({
    order: idx + 1,
    module: it.module,
    question_id: it.q?.id ?? it.q?.question_id ?? null,
    question_text: it.q?.text ?? it.q?.question ?? "",
    answer: it.answer,
    answer_text: it.answer_text || "",
  }));

  const payload = {
    candidate: evalState.candidate,
    position_id: evalState.position_id,
    auto,
    duration_sec: EVAL_DURATION_SEC - Math.max(evalState.remaining, 0),
    answers,
  };

  try {
    await apiFetch(`${PROTRACK_BASE}/api/gh/public/finish`, { method: "POST", json: payload });
  } catch (err) {
    console.warn("finish endpoint no disponible o falló:", err.message);
  } finally {
    localStorage.removeItem(LOCK_KEY);
    openModal("modalDone");
  }
}

/* ===============================
   INIT
   =============================== */
document.addEventListener("DOMContentLoaded", () => {
  setupCvPicker();
  loadPositions();

  $("btnStart")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setStartModalContent({
      mode: "start",
      title: "Antes de iniciar",
      msg: "La evaluación dura 10 minutos. Una vez inicie, no cierres la pestaña. Gracias. Tu información quedará registrada.",
      acceptLabel: "Continuar",
    });
    openModal("modalInfo");
  });

  $("modalInfoClose")?.addEventListener("click", () => closeModal("modalInfo"));

  $("btnAcceptStart")?.addEventListener("click", (e) => {
    e.preventDefault();
    const modal = document.getElementById("modalInfo");
    const mode = modal?.dataset?.mode || "start";

    if (mode === "locked") {
      closeModal("modalInfo");
      if (modal) modal.dataset.mode = "start";
      return;
    }

    startEvaluationFlow();
  });

  $("btnDoneOk")?.addEventListener("click", () => {
    closeModal("modalDone");
    location.reload();
  });
});
