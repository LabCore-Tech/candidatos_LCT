/* ============================================================
   LabCore - Evaluación (GitHub Pages)
   Conecta con ProTrack (Render) vía endpoints públicos:
   - GET  /api/gh/public/positions
   - GET  /api/gh/public/eval?position_id=...
   - POST /api/gh/public/submit
   Header requerido: X-API-Key
============================================================ */

const PROTRACK_BASE = "https://protrack-49um.onrender.com";
const PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`;
const ENDPOINT_EVAL      = `${PROTRACK_BASE}/api/gh/public/eval`;
const ENDPOINT_SUBMIT    = `${PROTRACK_BASE}/api/gh/public/submit`;

const MAX_CV_MB = 8;
const EVAL_MINUTES = 10;

const el = (id) => document.getElementById(id);

function showAlert(msg){
  const a = el("alert");
  a.textContent = msg;
  a.classList.remove("hidden");
}
function hideAlert(){
  el("alert").classList.add("hidden");
  el("alert").textContent = "";
}

async function fetchJSON(url, opts = {}, timeoutMs = 15000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": PUBLIC_EVAL_API_KEY,
    ...(opts.headers || {})
  };

  try{
    const res = await fetch(url, {
      ...opts,
      headers,
      signal: ctrl.signal,
      mode: "cors",
      cache: "no-store"
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    // Log útil para F12
    console.log("[API]", url, "->", res.status, data);

    if(!res.ok){
      const msg = (data && (data.msg || data.error)) ? (data.msg || data.error) : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
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

/* ===========================
   UI: PDF picker
=========================== */
function setupPdfPicker(){
  const input = el("cvFile");
  const btn = el("cvPick");
  const text = el("cvPickText");

  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const f = input.files && input.files[0] ? input.files[0] : null;
    if(!f){
      text.textContent = "Haz clic para adjuntar tu PDF";
      return;
    }
    text.textContent = f.name;
  });
}

/* ===========================
   Validación básica formulario
=========================== */
function isFormValid(){
  const requiredIds = ["firstName","lastName","idNumber","email","phone","github","university","career","semester"];
  for(const id of requiredIds){
    const v = (el(id).value || "").trim();
    if(!v) return false;
  }
  if(!el("positionSelect").value) return false;

  const f = el("cvFile").files && el("cvFile").files[0] ? el("cvFile").files[0] : null;
  if(!f) return false;
  if(f.type !== "application/pdf") return false;
  if(f.size > (MAX_CV_MB * 1024 * 1024)) return false;

  if(!el("acceptPolicy").checked) return false;
  return true;
}

function bindFormValidation(){
  const ids = ["firstName","lastName","idNumber","email","phone","github","linkedin","university","career","semester","positionSelect","acceptPolicy","cvFile"];
  const refresh = () => el("btnStart").disabled = !isFormValid();

  ids.forEach((id) => {
    const node = el(id);
    if(!node) return;
    const ev = (node.type === "checkbox" || node.type === "file" || node.tagName === "SELECT") ? "change" : "input";
    node.addEventListener(ev, refresh);
  });

  refresh();
}

/* ===========================
   Cargar cargos (positions)
=========================== */
async function loadPositions(){
  const select = el("positionSelect");
  const hint = el("posHint");

  select.innerHTML = `<option value="" selected>Cargando...</option>`;
  hint.textContent = "";

  try{
    const data = await fetchJSON(ENDPOINT_POSITIONS, { method: "GET" });

    // Acepta varios formatos
    const items = Array.isArray(data) ? data
                : Array.isArray(data.positions) ? data.positions
                : Array.isArray(data.data) ? data.data
                : [];

    if(!items.length){
      select.innerHTML = `<option value="" selected>No hay cargos disponibles</option>`;
      hint.textContent = "El API respondió vacío. Revisa si hay cargos creados en la tabla.";
      return;
    }

    select.innerHTML = `<option value="" selected>Selecciona...</option>`;
    items.forEach((it) => {
      const id = it.id ?? it.position_id ?? it.value ?? "";
      const name = it.name ?? it.cargo ?? it.title ?? it.label ?? "Cargo";
      const opt = document.createElement("option");
      opt.value = String(id);
      opt.textContent = String(name);
      select.appendChild(opt);
    });

  } catch(err){
    select.innerHTML = `<option value="" selected>No hay cargos disponibles</option>`;
    hint.textContent = `Error cargando cargos: ${err.message}`;

    // este mensaje sí lo ves y NO te rompe UI
    showAlert(`No se pudo cargar "Cargo a concursar". Motivo: ${err.message}`);
  }
}

/* ===========================
   Modal (solo X y Continuar)
=========================== */
function openModal(){
  el("modalBackdrop").classList.remove("hidden");
}
function closeModal(){
  el("modalBackdrop").classList.add("hidden");
}

/* ===========================
   Evaluación: render genérico
   (Si me pasas tu HTML viejo, lo dejamos 1:1)
=========================== */
let evalPayload = null;
let timerHandle = null;
let endAt = null;
let incidents = 0;

function setIncidents(n){
  incidents = n;
  el("incidents").textContent = String(n);
}

function startTimer(){
  endAt = Date.now() + (EVAL_MINUTES * 60 * 1000);

  const tick = () => {
    const ms = Math.max(0, endAt - Date.now());
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    el("timeLeft").textContent = `${mm}:${ss}`;

    if(ms <= 0){
      clearInterval(timerHandle);
      timerHandle = null;
      showAlert("Tiempo finalizado. Envía la evaluación.");
    }
  };

  tick();
  timerHandle = setInterval(tick, 250);
}

function renderEvaluation(payload){
  // payload esperado: { modules:[ { name, questions:[{id,text, options:[]}] } ] }
  const container = el("evalContainer");
  container.innerHTML = "";

  const modules = payload.modules || payload.modulos || [];
  modules.forEach((m, mi) => {
    const modName = m.name || m.nombre || `Módulo ${mi+1}`;
    const questions = m.questions || m.preguntas || [];

    questions.forEach((q, qi) => {
      const qId = q.id ?? `${mi}_${qi}`;
      const qText = q.text || q.pregunta || `Pregunta ${qi+1}`;
      const opts = q.options || q.opciones || ["A","B","C","D"];

      const card = document.createElement("div");
      card.className = "q-card";

      const title = document.createElement("div");
      title.className = "q-title";
      title.textContent = `${modName} • ${qText}`;
      card.appendChild(title);

      const list = document.createElement("div");
      list.className = "q-options";

      opts.forEach((optText, oi) => {
        const row = document.createElement("label");
        row.className = "opt";

        const input = document.createElement("input");
        input.type = "radio";
        input.name = `q_${qId}`;
        input.value = String(oi);

        const span = document.createElement("div");
        span.textContent = String(optText);

        row.appendChild(input);
        row.appendChild(span);
        list.appendChild(row);
      });

      card.appendChild(list);
      container.appendChild(card);
    });
  });
}

function collectAnswers(){
  const answers = {};
  const radios = el("evalContainer").querySelectorAll("input[type='radio']");
  radios.forEach((r) => {
    if(r.checked){
      answers[r.name] = r.value;
    }
  });
  return answers;
}

/* ===========================
   Flujo: iniciar evaluación
=========================== */
async function beginEvaluation(){
  hideAlert();

  // Datos candidato
  const positionId = el("positionSelect").value;

  try{
    // 1) Traer JSON evaluación (por cargo)
    const payload = await fetchJSON(`${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`, { method: "GET" });

    evalPayload = payload;

    // 2) Mostrar sección evaluación y render
    el("evalSection").classList.remove("hidden");
    renderEvaluation(payload);

    // 3) Timer
    setIncidents(0);
    startTimer();

    // (Anti-trampa mínimo)
    document.addEventListener("visibilitychange", () => {
      if(document.hidden){
        setIncidents(incidents + 1);
      }
    });

  } catch(err){
    showAlert(`No se pudo cargar la evaluación: ${err.message}`);
  }
}

/* ===========================
   Submit
=========================== */
async function submitEvaluation(){
  hideAlert();

  if(!evalPayload){
    showAlert("Primero inicia la evaluación.");
    return;
  }

  const cv = el("cvFile").files && el("cvFile").files[0] ? el("cvFile").files[0] : null;
  if(!cv){
    showAlert("Adjunta tu hoja de vida (PDF).");
    return;
  }

  const answers = collectAnswers();

  const body = {
    candidate: {
      firstName: el("firstName").value.trim(),
      lastName: el("lastName").value.trim(),
      idNumber: el("idNumber").value.trim(),
      email: el("email").value.trim(),
      phone: el("phone").value.trim(),
      github: el("github").value.trim(),
      linkedin: el("linkedin").value.trim(),
      university: el("university").value.trim(),
      career: el("career").value.trim(),
      semester: el("semester").value.trim(),
      positionId: el("positionSelect").value
    },
    meta: {
      incidents,
      startedAt: endAt ? new Date(endAt - (EVAL_MINUTES*60*1000)).toISOString() : null,
      submittedAt: new Date().toISOString()
    },
    answers,
    cv: {
      filename: cv.name,
      contentType: cv.type,
      base64: await fileToBase64(cv)
    }
  };

  try{
    const res = await fetchJSON(ENDPOINT_SUBMIT, {
      method: "POST",
      body: JSON.stringify(body)
    });

    showAlert("✅ Evaluación enviada correctamente.");
    console.log("SUBMIT OK:", res);

  } catch(err){
    showAlert(`No se pudo enviar: ${err.message}`);
  }
}

/* ===========================
   Init
=========================== */
document.addEventListener("DOMContentLoaded", async () => {
  setupPdfPicker();
  bindFormValidation();

  el("policyLink").addEventListener("click", (e) => {
    e.preventDefault();
    alert("Aquí va tu política (puedes enlazar a una página real).");
  });

  // Modal events
  el("btnStart").addEventListener("click", () => openModal());
  el("modalClose").addEventListener("click", () => closeModal());
  el("modalBackdrop").addEventListener("click", (e) => {
    if(e.target === el("modalBackdrop")) closeModal();
  });

  el("modalContinue").addEventListener("click", async () => {
    closeModal();
    await beginEvaluation();
  });

  el("btnSubmit").addEventListener("click", submitEvaluation);

  // Cargar cargos
  await loadPositions();
});
