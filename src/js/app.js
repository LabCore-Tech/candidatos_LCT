/* ==============================
   LabCore Tech - Evaluación (Repo B)
   Conecta con ProTrack (Repo A) vía endpoints públicos /api/gh/public/*
   ============================== */

// ================= CONFIG =================
const PROTRACK_BASE = "https://protrack-49um.onrender.com"; // backend real (Render)
const PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98"; // debe ser IGUAL al env del backend

const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`;
const ENDPOINT_EVAL      = `${PROTRACK_BASE}/api/gh/public/eval`;     // ?position_id=...
const ENDPOINT_SUBMIT    = `${PROTRACK_BASE}/api/gh/public/submit`;   // POST

const MAX_CV_MB = 8;
const LOCK_KEY = "labcore_eval_lock_v2";
const VIOLATION_LIMIT = 50;

// ================= STATE =================
let evalConfig = null;
let evalStarted = false;
let secondsLeft = 10 * 60;
let timerId = null;
let incidents = 0;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function apiHeaders() {
  return {
    "Content-Type": "application/json",
    "X-API-Key": PUBLIC_EVAL_API_KEY
  };
}

function showFormError(msg) {
  const box = $("formError");
  if (!box) return;
  box.textContent = msg;
  box.hidden = !msg;
}

function clearFormError() {
  showFormError("");
}

function setStartEnabled(enabled) {
  const btn = $("startBtn");
  if (!btn) return;
  btn.disabled = !enabled;
}

function setSubmitEnabled(enabled) {
  const btn = $("submitBtn");
  if (!btn) return;
  btn.disabled = !enabled;
}

function setIncidents(n) {
  incidents = n;
  const el = $("incidentCount");
  if (el) el.textContent = String(n);
}

function lockScreen() {
  localStorage.setItem(LOCK_KEY, "1");
}

function unlockScreen() {
  localStorage.removeItem(LOCK_KEY);
}

function isLocked() {
  return localStorage.getItem(LOCK_KEY) === "1";
}

function openModal() {
  const m = $("startModal");
  if (m) m.hidden = false;
}

function closeModal() {
  const m = $("startModal");
  if (m) m.hidden = true;
}

// ================= LOAD POSITIONS (FIX REAL) =================
async function loadPositions() {
  const sel = $("role");
  if (!sel) return;

  sel.disabled = true;
  sel.innerHTML = '<option value="" selected>Cargando...</option>';

  const url = ENDPOINT_POSITIONS;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: apiHeaders(),
      mode: "cors",
      cache: "no-store",
      signal: controller.signal
    });

    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

    if (!res.ok) {
      console.error("[positions] HTTP", res.status, data);

      if (res.status === 401 || (data && typeof data === "object" && data.msg === "unauthorized")) {
        showFormError("No autorizado: revisa que PUBLIC_EVAL_API_KEY en Render sea EXACTAMENTE el mismo valor que usas en app.js.");
      } else {
        showFormError("No se pudieron cargar los cargos. Revisa consola (F12) y el endpoint.");
      }

      sel.innerHTML = '<option value="" selected>No hay cargos disponibles</option>';
      sel.disabled = false;
      return;
    }

    const positions = Array.isArray(data) ? data : (data && data.positions ? data.positions : []);

    if (!positions.length) {
      sel.innerHTML = '<option value="" selected>No hay cargos disponibles</option>';
      sel.disabled = false;
      return;
    }

    sel.innerHTML = '<option value="" selected>Selecciona...</option>';
    for (const p of positions) {
      const opt = document.createElement("option");
      opt.value = String(p.id ?? p.value ?? "");
      opt.textContent = String(p.name ?? p.label ?? p.cargo ?? "");
      if (opt.value && opt.textContent) sel.appendChild(opt);
    }

    sel.disabled = false;

  } catch (err) {
    console.error("[positions] error", err);
    showFormError("Error de red al cargar cargos (CORS / endpoint / Render dormido). Revisa Network en F12.");
    sel.innerHTML = '<option value="" selected>No hay cargos disponibles</option>';
    sel.disabled = false;
  } finally {
    clearTimeout(t);
  }
}

// ================= LOAD EVAL =================
async function loadEvalForPosition(positionId) {
  const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: apiHeaders(),
      mode: "cors",
      cache: "no-store",
      signal: controller.signal
    });

    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

    if (!res.ok) {
      console.error("[eval] HTTP", res.status, data);

      if (res.status === 401 || (data && typeof data === "object" && data.msg === "unauthorized")) {
        throw new Error("No autorizado (llave pública inválida).");
      }
      throw new Error("No se pudo cargar la evaluación.");
    }

    // Esperado: { ok:true, eval:{...} } o {eval:{...}} o directo {...}
    const cfg = data?.eval ?? data;
    if (!cfg) throw new Error("Config de evaluación vacía.");

    evalConfig = cfg;
    return cfg;

  } finally {
    clearTimeout(t);
  }
}

// ================= RENDER EXAM =================
function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Esperado: cfg.modules = [{ id, name, questions:[{id,text,options:[...]}] }, ...]
 * - Orden de módulos aleatorio
 * - 1 pregunta aleatoria por módulo
 */
function buildExam(cfg) {
  const examBody = $("examBody");
  if (!examBody) return;

  examBody.innerHTML = "";

  const modules = Array.isArray(cfg.modules) ? cfg.modules : [];
  if (!modules.length) {
    examBody.innerHTML = `<div class="form-error" style="display:block">No hay módulos configurados para este cargo.</div>`;
    return;
  }

  const randomizedModules = shuffle(modules);

  for (const mod of randomizedModules) {
    const qlist = Array.isArray(mod.questions) ? mod.questions : [];
    if (!qlist.length) continue;

    const q = qlist[Math.floor(Math.random() * qlist.length)];

    const wrap = document.createElement("div");
    wrap.className = "qcard";
    wrap.style.border = "1px solid var(--line)";
    wrap.style.borderRadius = "18px";
    wrap.style.padding = "16px";
    wrap.style.background = "rgba(255,255,255,.72)";
    wrap.style.boxShadow = "var(--inset)";

    const title = document.createElement("div");
    title.style.fontWeight = "900";
    title.style.marginBottom = "10px";
    title.textContent = `${mod.name ?? "Módulo"} — ${q.text ?? ""}`;

    const opts = document.createElement("div");
    opts.style.display = "grid";
    opts.style.gap = "10px";

    const options = Array.isArray(q.options) ? q.options : [];
    const name = `q_${mod.id ?? mod.name}_${q.id ?? q.text}`.replace(/\s+/g, "_");

    for (const opt of options) {
      const label = document.createElement("label");
      label.style.display = "flex";
      label.style.gap = "10px";
      label.style.alignItems = "flex-start";
      label.style.fontWeight = "750";
      label.style.cursor = "pointer";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = String(opt.value ?? opt);
      input.style.marginTop = "3px";

      const span = document.createElement("span");
      span.textContent = String(opt.label ?? opt);

      label.appendChild(input);
      label.appendChild(span);
      opts.appendChild(label);
    }

    wrap.appendChild(title);
    wrap.appendChild(opts);
    examBody.appendChild(wrap);
  }
}

// ================= TIMER / INCIDENTS =================
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function startTimer() {
  const label = $("timerLabel");
  if (label) label.textContent = formatTime(secondsLeft);

  timerId = setInterval(() => {
    secondsLeft -= 1;
    if (label) label.textContent = formatTime(Math.max(0, secondsLeft));

    if (secondsLeft <= 0) {
      clearInterval(timerId);
      timerId = null;
      setSubmitEnabled(true);
      $("submitBtn")?.click();
    }
  }, 1000);
}

function addIncident() {
  setIncidents(incidents + 1);
  if (incidents >= VIOLATION_LIMIT) {
    setSubmitEnabled(true);
    $("submitBtn")?.click();
  }
}

// ================= SUBMIT =================
async function submitExam() {
  if (!evalConfig) throw new Error("No hay evaluación cargada.");

  // Recoge respuestas (simple)
  const answers = {};
  const radios = document.querySelectorAll('input[type="radio"]:checked');
  for (const r of radios) {
    answers[r.name] = r.value;
  }

  const cvInput = $("cvFile");
  const cvFile = cvInput?.files?.[0] || null;
  if (!cvFile) throw new Error("Debes adjuntar tu hoja de vida (PDF).");

  const cvBase64 = await fileToBase64(cvFile);

  const payload = {
    candidate: {
      firstName: $("firstName")?.value?.trim() || "",
      lastName: $("lastName")?.value?.trim() || "",
      idNumber: $("idNumber")?.value?.trim() || "",
      email: $("email")?.value?.trim() || "",
      phone: $("phone")?.value?.trim() || "",
      github: $("github")?.value?.trim() || "",
      linkedin: $("linkedin")?.value?.trim() || "",
      university: $("university")?.value?.trim() || "",
      career: $("career")?.value?.trim() || "",
      semester: $("semester")?.value?.trim() || "",
      positionId: $("role")?.value || ""
    },
    meta: {
      incidents,
      startedAt: new Date().toISOString()
    },
    answers,
    cv: {
      filename: cvFile.name,
      content_base64: cvBase64
    }
  };

  const res = await fetch(ENDPOINT_SUBMIT, {
    method: "POST",
    headers: apiHeaders(),
    mode: "cors",
    cache: "no-store",
    body: JSON.stringify(payload)
  });

  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

  if (!res.ok) {
    console.error("[submit] HTTP", res.status, data);
    throw new Error("No se pudo enviar la evaluación.");
  }

  return data;
}

// ================= VALIDATION (FORM) =================
function validateForm() {
  clearFormError();

  const requiredIds = ["firstName", "lastName", "idNumber", "email", "phone", "github", "university", "career", "semester", "role"];
  for (const id of requiredIds) {
    const el = $(id);
    const v = el?.value?.trim?.() ?? "";
    if (!v) return false;
  }

  const policy = $("acceptPolicy");
  if (!policy?.checked) return false;

  const cv = $("cvFile");
  if (!cv?.files?.[0]) return false;

  return true;
}

// ================= BOOT =================
document.addEventListener("DOMContentLoaded", async () => {
  // Lock (si recargan en medio)
  if (isLocked()) {
    // Si quieres, aquí puedes mostrar un mensaje y bloquear UI.
    // Por ahora, solo dejamos que siga y el backend/submit controlen.
  }

  // Carga cargos
  await loadPositions();

  // CV picker (sin botón "Seleccionar archivo")
  const cvPicker = $("cvPicker");
  const cvInput = $("cvFile");
  const cvText = $("cvPickerText");
  if (cvPicker && cvInput) {
    const openPicker = () => cvInput.click();

    cvPicker.addEventListener("click", openPicker);
    cvPicker.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPicker();
      }
    });

    cvInput.addEventListener("change", () => {
      const f = cvInput.files && cvInput.files[0] ? cvInput.files[0] : null;
      if (!f) {
        cvPicker.classList.remove("has-file");
        if (cvText) cvText.textContent = "Haz clic para adjuntar tu PDF";
        setStartEnabled(validateForm());
        return;
      }

      const isPdf = (f.type === "application/pdf") || String(f.name).toLowerCase().endsWith(".pdf");
      const maxBytes = MAX_CV_MB * 1024 * 1024;

      if (!isPdf) {
        cvInput.value = "";
        cvPicker.classList.remove("has-file");
        if (cvText) cvText.textContent = "Haz clic para adjuntar tu PDF";
        showFormError("La hoja de vida debe ser un PDF.");
        setStartEnabled(false);
        return;
      }

      if (f.size > maxBytes) {
        cvInput.value = "";
        cvPicker.classList.remove("has-file");
        if (cvText) cvText.textContent = "Haz clic para adjuntar tu PDF";
        showFormError(`El PDF supera el máximo permitido (${MAX_CV_MB} MB).`);
        setStartEnabled(false);
        return;
      }

      cvPicker.classList.add("has-file");
      if (cvText) cvText.textContent = f.name;

      setStartEnabled(validateForm());
    });
  }

  // Inputs -> valida
  const form = $("candidateForm");
  form?.addEventListener("input", () => setStartEnabled(validateForm()));
  form?.addEventListener("change", () => setStartEnabled(validateForm()));

  // Modal close (X)
  $("startModalClose")?.addEventListener("click", () => closeModal());

  // Start
  $("startBtn")?.addEventListener("click", async () => {
    if (!validateForm()) {
      showFormError("Debe completar los datos obligatorios.");
      return;
    }
    openModal();
  });

  // Continue
  $("btnContinueStart")?.addEventListener("click", async () => {
    try {
      closeModal();
      clearFormError();

      const positionId = $("role")?.value;
      if (!positionId) {
        showFormError("Debes seleccionar un cargo.");
        return;
      }

      // Carga evaluación del backend
      const cfg = await loadEvalForPosition(positionId);

      // UI
      $("examCard").hidden = false;
      $("startBtn").disabled = true;
      evalStarted = true;
      lockScreen();

      // Construye preguntas
      buildExam(cfg);

      // Habilita submit
      setSubmitEnabled(true);

      // Timer
      secondsLeft = 10 * 60;
      startTimer();

      // Anti-trampa: cerrar pestaña / perder foco
      window.addEventListener("blur", () => addIncident());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") addIncident();
      });

    } catch (e) {
      console.error(e);
      showFormError(e.message || "No se pudo iniciar la evaluación.");
    }
  });

  // Submit
  $("submitBtn")?.addEventListener("click", async () => {
    try {
      if (!evalStarted) return;

      setSubmitEnabled(false);

      const resp = await submitExam();
      console.log("[submit] ok", resp);

      unlockScreen();
      alert("Evaluación enviada correctamente. Gracias.");

      // Opcional: recargar
      location.reload();

    } catch (e) {
      console.error(e);
      showFormError(e.message || "Error al enviar evaluación.");
      setSubmitEnabled(true);
    }
  });
});

// ================= FILE HELPERS =================
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
