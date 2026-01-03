/* =========================
   LabCore Tech - Evaluación (Repo B - Static)
   Conecta a Repo A (Render/Supabase)
   ========================= */

/* ========= CONFIG (EDITA SOLO ESTO) ========= */
const PROTRACK_BASE = "https://protrack-49um.onrender.com"; // Repo A (Render)
const PUBLIC_EVAL_API_KEY = "PEGA_AQUI_TU_KEY_SI_LA_USAS";  // si backend exige X-API-Key; si no, déjala vacía

// Endpoints reales en Repo A
const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`;
const ENDPOINT_EVAL = `${PROTRACK_BASE}/api/gh/public/eval`;     // GET ?position_id=
const ENDPOINT_SUBMIT = `${PROTRACK_BASE}/api/gh/public/submit`; // POST

// 10 minutos total
const TOTAL_SEC = 10 * 60;
// max recomendado 8 MB
const MAX_CV_BYTES = 8 * 1024 * 1024;

/* ========= DOM ========= */
const $ = (id) => document.getElementById(id);

const stepForm = $("stepForm");
const stepExam = $("stepExam");

const fullName = $("fullName");
const cedula = $("cedula");
const email = $("email");
const phone = $("phone");
const github = $("github");
const linkedin = $("linkedin");
const career = $("career");
const cargo = $("cargo");
const notes = $("notes");

const policyOk = $("policyOk");

const cvFile = $("cvFile");
const cvProxy = $("cvProxy");
const cvHint = $("cvHint");

const btnStart = $("btnStart");
const btnSubmit = $("btnSubmit");

const chipStatus = $("chipStatus");
const chipTimer = $("chipTimer");
const chipIncidents = $("chipIncidents");

const examTitle = $("examTitle");
const examMeta = $("examMeta");
const questionsWrap = $("questionsWrap");

const modal = $("modal");
const modalTitle = $("modalTitle");
const modalBody = $("modalBody");
const modalOk = $("modalOk");
const modalX = $("modalX");

/* ========= STATE ========= */
let positions = [];        // [{position_id, position_name, ...}]
let currentEval = null;    // {position:{...}, qb:{...}, questions:[...]}
let pickedQuestions = [];  // las 8 (o N) preguntas finales
let timer = null;
let remaining = TOTAL_SEC;

let incidents = 0;
let started = false;

/* ========= Helpers ========= */
function headersJSON(extra = {}) {
  const h = { "Content-Type": "application/json", ...extra };
  if (PUBLIC_EVAL_API_KEY && PUBLIC_EVAL_API_KEY.trim()) {
    h["X-API-Key"] = PUBLIC_EVAL_API_KEY.trim();
  }
  return h;
}

function showModal(title, html) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}
function hideModal() {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

modalOk.addEventListener("click", hideModal);
modalX.addEventListener("click", hideModal);

/* ========= File input “como campo normal” ========= */
cvProxy.addEventListener("click", () => cvFile.click());
cvProxy.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") cvFile.click();
});

cvFile.addEventListener("change", () => {
  const f = cvFile.files && cvFile.files[0];
  if (!f) {
    cvProxy.value = "";
    return;
  }
  cvProxy.value = f.name;
});

/* ========= Validation ========= */
function setErr(id, msg) {
  const el = $("err_" + id);
  if (el) el.textContent = msg || "";
}
function clearAllErr() {
  [
    "fullName","cedula","email","phone","github","linkedin","career","cargo","cv","policy","notes"
  ].forEach(k => setErr(k, ""));
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}
function onlyDigits(v) {
  return /^[0-9]+$/.test(String(v || "").trim());
}

function validateForm() {
  clearAllErr();
  let ok = true;

  if (!String(fullName.value || "").trim()) { setErr("fullName", "Obligatorio."); ok=false; }
  if (!String(cedula.value || "").trim()) { setErr("cedula", "Obligatorio."); ok=false; }
  else if (!onlyDigits(cedula.value)) { setErr("cedula", "Debe ser numérico."); ok=false; }

  if (!String(email.value || "").trim()) { setErr("email", "Obligatorio."); ok=false; }
  else if (!isEmail(email.value)) { setErr("email", "Correo inválido."); ok=false; }

  if (!String(phone.value || "").trim()) { setErr("phone", "Obligatorio."); ok=false; }
  else if (!onlyDigits(phone.value)) { setErr("phone", "Debe ser numérico."); ok=false; }

  if (!String(github.value || "").trim()) { setErr("github", "Obligatorio."); ok=false; }

  if (!String(career.value || "").trim()) { setErr("career", "Obligatorio."); ok=false; }

  if (!String(cargo.value || "").trim()) { setErr("cargo", "Obligatorio."); ok=false; }

  const f = cvFile.files && cvFile.files[0];
  if (!f) { setErr("cv", "Obligatorio."); ok=false; }
  else {
    if ((f.type || "").toLowerCase() !== "application/pdf") { setErr("cv", "Debe ser PDF."); ok=false; }
    if (f.size > MAX_CV_BYTES) { setErr("cv", "El PDF supera 8MB."); ok=false; }
  }

  if (!policyOk.checked) { setErr("policy", "Debes aceptar la política."); ok=false; }

  // Si falta algo, modal general
  if (!ok) {
    showModal("Faltan datos", "Debes ingresar los <b>datos obligatorios</b> (campos con <b>*</b>) antes de continuar.");
  }

  return ok;
}

/* ========= Random helpers ========= */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Espera recibir questions como:
 * [{id, prompt, moduleId, moduleName}, ...]
 * Agrupa por moduleId y elige 1 al azar por módulo.
 * Luego baraja los módulos para el orden final.
 */
function pickOnePerModule(questions) {
  const map = new Map();
  for (const q of questions) {
    const m = String(q.moduleId || "M1");
    if (!map.has(m)) map.set(m, []);
    map.get(m).push(q);
  }

  // Elegimos 1 por módulo
  const modules = Array.from(map.keys());
  const shuffledModules = shuffle(modules);

  const picked = [];
  for (const m of shuffledModules) {
    const qs = map.get(m) || [];
    const one = qs[Math.floor(Math.random() * qs.length)];
    picked.push(one);
  }
  return picked;
}

/* ========= Timer ========= */
function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}
function startTimer() {
  stopTimer();
  remaining = TOTAL_SEC;
  chipTimer.textContent = fmtTime(remaining);
  timer = setInterval(() => {
    remaining--;
    chipTimer.textContent = fmtTime(Math.max(0, remaining));
    if (remaining <= 0) {
      stopTimer();
      showModal("Tiempo finalizado", "El tiempo de la evaluación terminó. Se enviará lo que esté diligenciado.");
      doSubmit(true);
    }
  }, 1000);
}

/* ========= Anti-trampas (incidentes) ========= */
function addIncident(reason) {
  incidents++;
  chipIncidents.textContent = `Incidentes: ${incidents}`;
  // Guardamos también en memoria (para enviar al backend)
  window.__INCIDENTS__ = window.__INCIDENTS__ || [];
  window.__INCIDENTS__.push({ at: new Date().toISOString(), reason });
}

// Señales típicas
document.addEventListener("visibilitychange", () => {
  if (!started) return;
  if (document.hidden) addIncident("Salió de la pestaña / minimizó pantalla");
});

window.addEventListener("blur", () => {
  if (!started) return;
  addIncident("Perdió foco (cambió de ventana)");
});

document.addEventListener("keydown", (e) => {
  if (!started) return;

  const key = (e.key || "").toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;

  // copiar/pegar/cortar
  if (ctrl && (key === "c" || key === "v" || key === "x")) {
    addIncident(`Tecla ${ctrl ? "Ctrl/Meta+" : ""}${e.key.toUpperCase()}`);
  }

  // PrintScreen (no siempre detectable, pero intentamos)
  if (key === "printscreen") {
    addIncident("Intento de captura (PrintScreen)");
  }

  // Ctrl+P (imprimir)
  if (ctrl && key === "p") {
    addIncident("Intento de impresión (Ctrl+P)");
  }
});

/* ========= API calls ========= */
async function apiGet(url) {
  const res = await fetch(url, { method: "GET", headers: headersJSON() });
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { ok:false, raw: txt }; }
  return { res, data };
}

async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: headersJSON(),
    body: JSON.stringify(payload),
  });
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { ok:false, raw: txt }; }
  return { res, data };
}

/* ========= Load positions ========= */
async function loadPositions() {
  cargo.innerHTML = `<option value="">Cargando cargos...</option>`;
  try {
    chipStatus.textContent = "Conectando...";
    const { res, data } = await apiGet(ENDPOINT_POSITIONS);

    if (!res.ok || !data.ok) {
      console.error("Positions error:", res.status, data);
      cargo.innerHTML = `<option value="">No fue posible cargar cargos</option>`;
      chipStatus.textContent = "Sin conexión";
      showModal("No conecta", `
        No fue posible cargar cargos desde el backend.<br><br>
        <b>Revisa:</b>
        <ul>
          <li>ENDPOINT_POSITIONS en app.js</li>
          <li>Que el backend esté arriba en Render</li>
          <li>CORS / API KEY si aplica</li>
        </ul>
      `);
      return;
    }

    // Esperamos: {ok:true, positions:[{position_id, position_name}]}
    positions = data.positions || [];

    cargo.innerHTML = `<option value="">*</option>` + positions
      .map(p => `<option value="${p.position_id}">${p.position_name}</option>`)
      .join("");

    chipStatus.textContent = "Listo";
  } catch (e) {
    console.error("Positions exception:", e);
    cargo.innerHTML = `<option value="">No fue posible cargar cargos</option>`;
    chipStatus.textContent = "Sin conexión";
    showModal("Error", `Error cargando cargos. Mira Console (F12).<br><br>${String(e)}`);
  }
}

/* ========= Load evaluation by position ========= */
async function loadEval(positionId) {
  try {
    chipStatus.textContent = "Cargando evaluación...";
    const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;
    const { res, data } = await apiGet(url);

    if (!res.ok || !data.ok) {
      console.error("Eval error:", res.status, data);
      chipStatus.textContent = "Sin iniciar";
      showModal("No hay evaluación", `
        No se pudo cargar evaluación para el cargo seleccionado.<br><br>
        <b>Detalle:</b> ${data.msg ? data.msg : "Sin mensaje"}<br>
        <small>Revisa Console (F12) y Network.</small>
      `);
      return null;
    }

    currentEval = data;
    chipStatus.textContent = "Evaluación cargada";
    return currentEval;
  } catch (e) {
    console.error("Eval exception:", e);
    chipStatus.textContent = "Sin iniciar";
    showModal("Error", `Error cargando evaluación. Mira Console (F12).<br><br>${String(e)}`);
    return null;
  }
}

/* ========= Render exam ========= */
function renderExam() {
  const pos = currentEval.position || {};
  const qb = currentEval.qb || {};

  examTitle.textContent = `Evaluación | ${pos.position_name || "Cargo"}`;
  examMeta.textContent = `Área: ${pos.area_code || qb.area || "-"}  ·  Versión: ${qb.version ?? "-"}`;

  const baseQuestions = currentEval.questions || [];
  pickedQuestions = pickOnePerModule(baseQuestions);

  questionsWrap.innerHTML = pickedQuestions.map((q, idx) => `
    <div class="q" data-qid="${q.id}">
      <div class="q-top">
        <div class="q-mod">${q.moduleName || "Módulo"}</div>
        <div class="q-id">${q.id || ""}</div>
      </div>
      <p class="q-prompt">${escapeHTML(q.prompt || "")}</p>
      <textarea class="q-area" placeholder="Escribe tu respuesta aquí..." data-idx="${idx}"></textarea>
    </div>
  `).join("");
}

function escapeHTML(s) {
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ========= Convert PDF to base64 ========= */
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

/* ========= Start flow ========= */
btnStart.addEventListener("click", async () => {
  if (!validateForm()) return;

  btnStart.disabled = true;
  btnStart.textContent = "Cargando...";
  try {
    const positionId = String(cargo.value || "").trim();
    const ev = await loadEval(positionId);
    if (!ev) {
      btnStart.disabled = false;
      btnStart.textContent = "Iniciar evaluación";
      return;
    }

    // Pasamos a examen
    stepForm.classList.add("hidden");
    stepForm.setAttribute("aria-hidden","true");
    stepExam.classList.remove("hidden");
    stepExam.setAttribute("aria-hidden","false");

    incidents = 0;
    chipIncidents.textContent = "Incidentes: 0";
    started = true;

    renderExam();
    startTimer();
  } finally {
    btnStart.disabled = false;
    btnStart.textContent = "Iniciar evaluación";
  }
});

/* ========= Submit ========= */
btnSubmit.addEventListener("click", () => doSubmit(false));

async function doSubmit(isAuto) {
  if (!currentEval) return;

  // validamos que todas tengan texto (mínimo)
  const areas = Array.from(document.querySelectorAll(".q-area"));
  const answers = areas.map((ta, i) => ({
    ...pickedQuestions[i],
    answer: String(ta.value || "").trim()
  }));

  const empty = answers.filter(a => !a.answer);
  if (!isAuto && empty.length > 0) {
    showModal("Respuestas incompletas", "Debes responder todas las preguntas antes de enviar.");
    return;
  }

  btnSubmit.disabled = true;
  btnSubmit.textContent = "Enviando...";

  try {
    const f = cvFile.files && cvFile.files[0];
    const b64 = await fileToBase64(f);

    const payload = {
      candidate: {
        full_name: String(fullName.value || "").trim(),
        cedula: String(cedula.value || "").trim(),
        email: String(email.value || "").trim(),
        phone: String(phone.value || "").trim(),
        github: String(github.value || "").trim(),
        linkedin: String(linkedin.value || "").trim(),
        career: String(career.value || "").trim(),
        notes: String(notes.value || "").trim(),
        positionId: String(cargo.value || "").trim(),
      },
      meta: {
        started_at: new Date(Date.now() - (TOTAL_SEC - remaining) * 1000).toISOString(),
        submitted_at: new Date().toISOString(),
        duration_sec: TOTAL_SEC - remaining,
        incidents: window.__INCIDENTS__ || [],
        incidents_count: incidents,
        user_agent: navigator.userAgent,
      },
      questions: answers.map(a => ({
        id: a.id,
        moduleId: a.moduleId,
        moduleName: a.moduleName,
        prompt: a.prompt,
        answer: a.answer
      })),
      cv: {
        name: (f && f.name) ? f.name : "cv.pdf",
        mime: "application/pdf",
        base64: b64
      }
    };

    const { res, data } = await apiPost(ENDPOINT_SUBMIT, payload);

    if (!res.ok || !data.ok) {
      console.error("Submit error:", res.status, data);
      showModal("No se pudo enviar", `
        Ocurrió un error enviando la evaluación.<br><br>
        <b>Detalle:</b> ${data.msg ? data.msg : "Sin mensaje"}<br>
        <small>Revisa Console (F12) y Network.</small>
      `);
      return;
    }

    stopTimer();
    started = false;

    showModal("Enviado", `
      Tu evaluación fue enviada correctamente.<br><br>
      <b>ID:</b> ${data.candidate_id || "(sin id)"}<br>
      Gracias.
    `);

    // opcional: reset UI después
    setTimeout(() => {
      location.reload();
    }, 1800);

  } catch (e) {
    console.error("Submit exception:", e);
    showModal("Error", `Error enviando. Mira Console (F12).<br><br>${String(e)}`);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = "Enviar evaluación";
  }
}

/* ========= Init ========= */
(async function init() {
  chipTimer.textContent = fmtTime(TOTAL_SEC);
  await loadPositions();
})();
