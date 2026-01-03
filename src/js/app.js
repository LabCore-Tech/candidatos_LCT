/* =========================================================
   LabCore - Candidatos (Repo B - GitHub Pages)
   Consume backend ProTrack (Repo A - Render)
   Endpoints:
     GET  /api/gh/public/positions
     GET  /api/gh/public/eval?position_id=...
     POST /api/gh/public/submit
   ========================================================= */

const CONFIG = {
  BASE_URL: "https://protrack-49um.onrender.com",
  API_KEY: "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98",
  MAX_CV_MB: 8,
  DURATION_SECONDS: 10 * 60
};

const ENDPOINTS = {
  POSITIONS: `${CONFIG.BASE_URL}/api/gh/public/positions`,
  EVAL:      `${CONFIG.BASE_URL}/api/gh/public/eval`,
  SUBMIT:    `${CONFIG.BASE_URL}/api/gh/public/submit`,
};

const el = (id) => document.getElementById(id);

const msgBox = el("msgBox");
function showError(message){
  msgBox.textContent = message;
  msgBox.classList.remove("hidden");
}
function clearError(){
  msgBox.textContent = "";
  msgBox.classList.add("hidden");
}

async function apiFetch(url, options = {}){
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("X-API-Key", CONFIG.API_KEY);

  const res = await fetch(url, {
    ...options,
    headers,
    mode: "cors",
    cache: "no-store",
  });

  let data = null;
  const ct = res.headers.get("content-type") || "";
  if(ct.includes("application/json")){
    try { data = await res.json(); } catch { data = null; }
  }else{
    try { data = await res.text(); } catch { data = null; }
  }

  if(!res.ok){
    const errMsg = (data && data.msg) ? data.msg : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return data;
}

/* ---------- CV (sin botón nativo) ---------- */
function setupCvPicker(){
  const input = el("resume_file");
  const picker = el("cvPicker");
  const txt = el("cvText");

  const open = () => input.click();

  picker.addEventListener("click", open);
  picker.addEventListener("keydown", (e) => {
    if(e.key === "Enter" || e.key === " "){
      e.preventDefault();
      open();
    }
  });

  input.addEventListener("change", () => {
    clearError();

    const file = input.files && input.files[0] ? input.files[0] : null;
    if(!file){
      txt.textContent = "Haz clic para adjuntar tu PDF";
      return;
    }

    const maxBytes = CONFIG.MAX_CV_MB * 1024 * 1024;
    if(file.size > maxBytes){
      input.value = "";
      txt.textContent = "Haz clic para adjuntar tu PDF";
      showError(`El PDF supera ${CONFIG.MAX_CV_MB} MB.`);
      return;
    }

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if(!isPdf){
      input.value = "";
      txt.textContent = "Haz clic para adjuntar tu PDF";
      showError("Solo se permite PDF.");
      return;
    }

    txt.textContent = file.name;
  });
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

/* ---------- Modal ---------- */
function setupModal(){
  const modal = el("modal");
  const closeBtn = el("modalClose");
  const overlay = el("modalOverlay");

  const hide = () => {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  };

  closeBtn.addEventListener("click", hide);
  overlay.addEventListener("click", hide);

  return {
    show(){
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
    },
    hide
  };
}

/* ---------- Cargar cargos ---------- */
async function loadPositions(){
  const select = el("position_id");
  select.innerHTML = `<option value="">Cargando...</option>`;

  try{
    const data = await apiFetch(ENDPOINTS.POSITIONS, { method: "GET" });

    // Esperado: { ok:true, items:[{id,name}...] } o array directo.
    const items = Array.isArray(data) ? data : (data.items || []);

    if(!items.length){
      select.innerHTML = `<option value="">No hay cargos disponibles</option>`;
      return;
    }

    select.innerHTML = `<option value="">Selecciona...</option>` +
      items.map(it => `<option value="${escapeHtml(String(it.id))}">${escapeHtml(String(it.name || it.cargo || it.title || "Cargo"))}</option>`).join("");

  }catch(err){
    console.error("Positions error:", err);
    select.innerHTML = `<option value="">No se pudo cargar</option>`;
    showError(`No se pudieron cargar los cargos: ${err.message}`);
  }
}

/* ---------- Validaciones ---------- */
function getFormData(){
  return {
    first_name: (el("first_name").value || "").trim(),
    last_name: (el("last_name").value || "").trim(),
    id_number: (el("id_number").value || "").trim(),
    position_id: (el("position_id").value || "").trim(),

    email: (el("email").value || "").trim(),
    phone: (el("phone").value || "").trim(),
    github: (el("github").value || "").trim(),
    linkedin: (el("linkedin").value || "").trim(),
    university: (el("university").value || "").trim(),
    career: (el("career").value || "").trim(),
    semester: (el("semester").value || "").trim(),

    accept_policy: !!el("accept_policy").checked,
    resume_file: (el("resume_file").files && el("resume_file").files[0]) ? el("resume_file").files[0] : null,
  };
}

function validateForm(d){
  const missing = [];
  if(!d.first_name) missing.push("Nombre");
  if(!d.last_name) missing.push("Apellido");
  if(!d.id_number) missing.push("Cédula");
  if(!d.position_id) missing.push("Cargo a concursar");

  if(!d.email) missing.push("Correo");
  if(!d.phone) missing.push("Celular");
  if(!d.github) missing.push("GitHub");
  if(!d.university) missing.push("Universidad");
  if(!d.career) missing.push("Carrera");
  if(!d.semester) missing.push("Semestre");

  if(!d.resume_file) missing.push("Hoja de vida (PDF)");
  if(!d.accept_policy) missing.push("Política de tratamiento de datos");

  if(missing.length){
    showError(`Debe ingresar los datos obligatorios: ${missing.join(", ")}.`);
    return false;
  }

  // Solo números en cédula
  if(!/^\d+$/.test(d.id_number)){
    showError("La cédula debe contener solo números.");
    return false;
  }

  return true;
}

/* ---------- Evaluación ---------- */
let timerHandle = null;
let secondsLeft = CONFIG.DURATION_SECONDS;
let evalPayload = null; // preguntas que llegan del backend
let answers = {};       // idPregunta -> respuesta

function startTimer(){
  secondsLeft = CONFIG.DURATION_SECONDS;
  updateTimerLabel();

  timerHandle = setInterval(() => {
    secondsLeft--;
    updateTimerLabel();
    if(secondsLeft <= 0){
      clearInterval(timerHandle);
      timerHandle = null;
      showError("Se agotó el tiempo. Por favor envía la evaluación.");
      // puedes forzar submit si quieres, por ahora solo aviso
    }
  }, 1000);
}

function updateTimerLabel(){
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  el("timer").textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function renderEvaluation(payload){
  const wrap = el("evalWrap");
  const body = el("evalBody");
  body.innerHTML = "";

  // Estructuras posibles:
  // payload.modules = [{name, questions:[{id,text,options?}...]}...]
  // o payload = { ok:true, items:[...]}
  const modules = payload.modules || payload.items || payload.data || [];

  if(!modules.length){
    showError("No hay evaluación configurada para este cargo.");
    return;
  }

  // Regla: 1 pregunta aleatoria por módulo, módulos en orden aleatorio
  const shuffledModules = shuffle([...modules]);

  shuffledModules.forEach((mod, idx) => {
    const modName = mod.name || mod.module || `Módulo ${idx+1}`;
    const qs = Array.isArray(mod.questions) ? mod.questions : [];
    if(!qs.length) return;

    const q = qs[Math.floor(Math.random() * qs.length)];
    const qId = String(q.id ?? `${idx}_${Math.random()}`);
    const qText = q.text || q.question || q.enunciado || "Pregunta";

    const options = Array.isArray(q.options) ? q.options : (Array.isArray(q.answers) ? q.answers : null);

    const block = document.createElement("div");
    block.className = "qblock";
    block.innerHTML = `
      <div class="qhead">
        <div class="qmod">${escapeHtml(modName)}</div>
        <div class="qtitle">${escapeHtml(qText)}</div>
      </div>
      <div class="qbody" id="q_${escapeHtml(qId)}"></div>
    `;

    body.appendChild(block);

    const qbody = block.querySelector(`#q_${CSS.escape(qId)}`);

    if(options && options.length){
      const list = document.createElement("div");
      list.className = "qopts";

      options.forEach((opt, i) => {
        const val = String(opt.value ?? opt.id ?? opt);
        const lab = String(opt.label ?? opt.text ?? opt);
        const rid = `r_${qId}_${i}`;

        const row = document.createElement("label");
        row.className = "qopt";
        row.innerHTML = `
          <input type="radio" name="q_${escapeHtml(qId)}" id="${escapeHtml(rid)}" value="${escapeHtml(val)}">
          <span>${escapeHtml(lab)}</span>
        `;

        row.querySelector("input").addEventListener("change", (e) => {
          answers[qId] = e.target.value;
        });

        list.appendChild(row);
      });

      qbody.appendChild(list);
    }else{
      const ta = document.createElement("textarea");
      ta.className = "qtext";
      ta.placeholder = "Escribe tu respuesta...";
      ta.addEventListener("input", (e) => {
        answers[qId] = e.target.value;
      });
      qbody.appendChild(ta);
    }
  });

  // Mostrar sección
  wrap.classList.remove("hidden");
  wrap.scrollIntoView({behavior:"smooth", block:"start"});
}

/* ---------- Submit ---------- */
async function submitAll(){
  clearError();

  const d = getFormData();
  if(!validateForm(d)) return;

  if(!evalPayload){
    showError("No hay evaluación cargada.");
    return;
  }

  const file = d.resume_file;
  let cvBase64 = "";
  try{
    cvBase64 = await fileToBase64(file);
  }catch(err){
    console.error("CV base64 error:", err);
    showError("No se pudo leer el PDF. Intenta nuevamente.");
    return;
  }

  // Payload final hacia backend
  const payload = {
    candidate: {
      first_name: d.first_name,
      last_name: d.last_name,
      id_number: d.id_number,
      email: d.email,
      phone: d.phone,
      github: d.github,
      linkedin: d.linkedin,
      university: d.university,
      career: d.career,
      semester: d.semester,
      position_id: d.position_id
    },
    answers,
    resume: {
      filename: file.name,
      mime: file.type || "application/pdf",
      base64: cvBase64
    }
  };

  try{
    const res = await apiFetch(ENDPOINTS.SUBMIT, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    alert("Evaluación enviada correctamente.");
    console.log("Submit OK:", res);

  }catch(err){
    console.error("Submit error:", err);
    showError(`No se pudo enviar la evaluación: ${err.message}`);
  }
}

/* ---------- Start flow ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  const modal = setupModal();
  setupCvPicker();

  // Cargar cargos
  await loadPositions();

  // Botón iniciar
  el("btnStart").addEventListener("click", () => {
    clearError();
    const d = getFormData();
    if(!validateForm(d)) return;
    modal.show();
  });

  // Continuar (modal)
  el("modalContinue").addEventListener("click", async () => {
    modal.hide();
    clearError();

    const d = getFormData();
    if(!validateForm(d)) return;

    try{
      // pedir evaluación al backend
      const url = `${ENDPOINTS.EVAL}?position_id=${encodeURIComponent(d.position_id)}`;
      const data = await apiFetch(url, { method: "GET" });

      evalPayload = data;
      answers = {};

      renderEvaluation(evalPayload);

      // iniciar timer
      if(timerHandle) clearInterval(timerHandle);
      startTimer();

      // bind submit
      el("btnSubmit").onclick = submitAll;

    }catch(err){
      console.error("Eval load error:", err);
      showError(`No se pudo cargar la evaluación: ${err.message}`);
    }
  });

  // Política link (placeholder)
  el("policyLink").addEventListener("click", (e) => {
    e.preventDefault();
    alert("Aquí va tu Política de tratamiento de datos (URL real).");
  });
});

/* ---------- Utils ---------- */
function shuffle(arr){
  for(let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
