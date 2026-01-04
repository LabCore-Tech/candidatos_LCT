/* =========================================================
   LabCore - Evaluación de ingreso (GitHub Pages)
   ========================================================= */

(() => {
  "use strict";

  // ============ CONFIG ============
  const PROTRACK_BASE = "https://protrack-49um.onrender.com";
  const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`;
  const ENDPOINT_EVAL      = `${PROTRACK_BASE}/api/gh/public/eval`;     // ?position_id=...
  const ENDPOINT_SUBMIT    = `${PROTRACK_BASE}/api/gh/public/submit`;   // POST

  // Header EXACTO: X-API-Key
  const PUBLIC_EVAL_API_KEY =
    document.querySelector('meta[name="PUBLIC_EVAL_API_KEY"]')?.content?.trim()
    || "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

  const MAX_CV_MB = 8;
  const LOCK_KEY = "labcore_eval_lock_v2";

  // ============ HELPERS ============
  const $ = (id) => document.getElementById(id);

  function show(el){ if (el) el.classList.remove("hidden"); }
  function hide(el){ if (el) el.classList.add("hidden"); }

  function setMsg(id, msg){
    const el = $(id);
    if (!el) return;
    if (!msg){ el.textContent=""; el.style.display="none"; return; }
    el.textContent = msg;
    el.style.display = "block";
  }

  function buildHeaders(extra = {}){
    return { "Content-Type":"application/json", "X-API-Key": PUBLIC_EVAL_API_KEY, ...extra };
  }

  async function apiGetJson(url){
    const r = await fetch(url, { method:"GET", headers: buildHeaders() });
    const txt = await r.text();
    let json = null;
    try{ json = txt ? JSON.parse(txt) : null; } catch { json = null; }

    if (!r.ok) throw new Error(json?.msg || json?.message || `HTTP ${r.status}`);
    if (json && json.ok === false) throw new Error(json.msg || json.message || "Unauthorized");
    return json;
  }

  async function apiPostJson(url, payload){
    const r = await fetch(url, { method:"POST", headers: buildHeaders(), body: JSON.stringify(payload) });
    const txt = await r.text();
    let json = null;
    try{ json = txt ? JSON.parse(txt) : null; } catch { json = null; }

    if (!r.ok) throw new Error(json?.msg || json?.message || `HTTP ${r.status}`);
    if (json && json.ok === false) throw new Error(json.msg || json.message || "Unauthorized");
    return json;
  }

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  // ============ CV UI ============
  function humanFileSize(bytes){
    const units = ["B","KB","MB","GB"];
    let n = bytes, u = 0;
    while (n >= 1024 && u < units.length - 1){ n /= 1024; u++; }
    return `${n.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
  }

  async function fileToBase64(file){
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

  function bindCv(){
    const input = $("cvFile");
    const selected = $("cvSelected");
    const drop = $("cvDrop");
    const dropText = $("cvDropText");
    if (!input || !selected || !drop || !dropText) return;

    drop.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " "){
        e.preventDefault();
        input.click();
      }
    });

    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (!f){
        selected.textContent = "";
        dropText.textContent = "Haz clic para adjuntar tu PDF";
        return;
      }
      selected.textContent = `${f.name} · ${humanFileSize(f.size)}`;
      dropText.textContent = f.name;
    });
  }

  // ============ POSITIONS ============
  function normalizePositions(json){
    if (!json) return [];
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.positions)) return json.positions;
    return [];
  }

  function optionLabel(p){
    return (p?.name || p?.title || p?.role || p?.position || "").trim();
  }

  async function loadPositions(){
    const sel = $("cargo");
    if (!sel) return;

    sel.innerHTML = `<option value="">Cargando...</option>`;
    sel.disabled = true;

    try{
      const json = await apiGetJson(ENDPOINT_POSITIONS);
      const list = normalizePositions(json);

      if (!list.length){
        sel.innerHTML = `<option value="">No hay cargos disponibles</option>`;
        sel.disabled = true;
        return;
      }

      sel.innerHTML =
        `<option value="">Selecciona…</option>` +
        list.map((p) => {
          const id = p.id ?? p.position_id ?? p.code ?? p.value;
          return `<option value="${String(id)}">${escapeHtml(optionLabel(p) || `Cargo ${id}`)}</option>`;
        }).join("");

      sel.disabled = false;
    }catch(e){
      console.error("loadPositions error:", e);
      sel.innerHTML = `<option value="">No hay cargos disponibles</option>`;
      sel.disabled = true;
      setMsg("formMsg", `No se pudieron cargar los cargos: ${e.message}`);
    }
  }

  // ============ VALIDATION ============
  function getValue(id){ return ($(id)?.value || "").trim(); }

  function validateForm(){
    const required = [
      ["nombre","Nombre"],
      ["apellido","Apellido"],
      ["cedula","Cédula"],
      ["correo","Correo"],
      ["celular","Celular"],
      ["github","GitHub"],
      ["universidad","Universidad"],
      ["carrera","Carrera"],
      ["semestre","Semestre"],
      ["cargo","Cargo a concursar"],
    ];

    for (const [id,label] of required){
      const v = getValue(id);
      if (!v) return `Falta: ${label}.`;
    }

    if ($("acceptPolicy") && !$("acceptPolicy").checked){
      return "Debes aceptar la política de tratamiento de datos.";
    }

    const cv = $("cvFile")?.files?.[0];
    if (!cv) return "Adjunta tu hoja de vida (PDF).";
    if (cv.type !== "application/pdf") return "La hoja de vida debe ser un PDF.";
    if (cv.size > MAX_CV_MB * 1024 * 1024) return `El PDF supera ${MAX_CV_MB} MB.`;

    return null;
  }

  // ============ MODALS ============
  function openModal(id){ const m=$(id); if (m) m.classList.remove("hidden"); }
  function closeModal(id){ const m=$(id); if (m) m.classList.add("hidden"); }

  function bindModals(){
    $("btnStart")?.addEventListener("click", () => {
      setMsg("formMsg","");
      if (localStorage.getItem(LOCK_KEY)){
        setMsg("formMsg","Esta evaluación ya fue iniciada en este dispositivo.");
        return;
      }
      openModal("modalInfo");
    });

    $("modalInfoClose")?.addEventListener("click", () => closeModal("modalInfo"));
    $("btnAcceptStart")?.addEventListener("click", async () => {
      closeModal("modalInfo");
      await startEvaluation();
    });

    $("modalDoneClose")?.addEventListener("click", () => closeModal("modalDone"));
    $("btnDoneOk")?.addEventListener("click", () => closeModal("modalDone"));

    ["modalInfo","modalDone"].forEach((mid) => {
      const m = $(mid);
      if (!m) return;
      m.addEventListener("click", (e) => { if (e.target === m) closeModal(mid); });
    });
  }

  // ============ EVALUATION ============
  let questions = [];
  let answers = [];
  let idx = 0;

  let timerSeconds = 10 * 60;
  let timerHandle = null;

  function clearTimer(){ if (timerHandle) clearInterval(timerHandle); timerHandle=null; }

  function setTimerUI(){
    const mm = String(Math.floor(timerSeconds/60)).padStart(2,"0");
    const ss = String(timerSeconds%60).padStart(2,"0");
    $("timer").textContent = `${mm}:${ss}`;
  }

  function startTimer(){
    clearTimer();
    setTimerUI();
    timerHandle = setInterval(() => {
      timerSeconds -= 1;
      setTimerUI();
      if (timerSeconds <= 0){
        clearTimer();
        submitEvaluation(true).catch((e) => setMsg("uiMsg", e.message));
      }
    }, 1000);
  }

  function normalizeQuestions(json){
    const q =
      (Array.isArray(json?.questions) && json.questions) ||
      (Array.isArray(json?.data?.questions) && json.data.questions) ||
      (Array.isArray(json?.eval?.questions) && json.eval.questions) ||
      [];
    return q.map((x,i) => {
      if (typeof x === "string") return { id:i+1, text:x };
      return { id: x.id ?? i+1, text: x.text ?? x.question ?? "" };
    }).filter((x) => (x.text||"").trim().length > 0);
  }

  function renderQuestion(){
    const total = questions.length;
    const q = questions[idx];

    $("qCounter").textContent = `${idx+1}/${total}`;
    $("qText").textContent = q.text;

    const area = $("qAnswer");
    area.value = answers[idx] || "";

    const isLast = idx === total-1;
    $("btnNext").style.display = isLast ? "none" : "";
    $("btnSend").style.display = isLast ? "" : "none";
  }

  function bindExam(){
    $("qAnswer")?.addEventListener("input", (e) => { answers[idx] = e.target.value; });

    $("btnNext")?.addEventListener("click", () => {
      setMsg("uiMsg","");
      answers[idx] = $("qAnswer").value;

      if (idx < questions.length-1){
        idx += 1;
        renderQuestion();
      }
    });

    $("btnSend")?.addEventListener("click", () => submitEvaluation(false).catch((e) => setMsg("uiMsg", e.message)));

    $("btnCancel")?.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setMsg("uiMsg","La evaluación ya inició. Completa y envía para finalizar.");
    });
  }

  function lock(){ localStorage.setItem(LOCK_KEY, String(Date.now())); }

  function buildPayloadBase(){
    const cv = $("cvFile")?.files?.[0];
    return {
      nombre: getValue("nombre"),
      apellido: getValue("apellido"),
      cedula: getValue("cedula"),
      correo: getValue("correo"),
      celular: getValue("celular"),
      github: getValue("github"),
      linkedin: getValue("linkedin"),
      universidad: getValue("universidad"),
      carrera: getValue("carrera"),
      semestre: getValue("semestre"),
      position_id: getValue("cargo"),
      cv_filename: cv?.name || "",
    };
  }

  async function startEvaluation(){
    const err = validateForm();
    if (err){ setMsg("formMsg", err); return; }

    lock();

    hide($("indexCard"));
    show($("examCard"));
    setMsg("uiMsg","");

    const positionId = getValue("cargo");

    try{
      const json = await apiGetJson(`${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`);
      questions = normalizeQuestions(json);

      if (!questions.length) throw new Error("No hay preguntas para este cargo.");

      const minutes = Number(json.duration_min ?? json.data?.duration_min ?? json.eval?.duration_min ?? 10) || 10;
      timerSeconds = minutes * 60;

      answers = Array(questions.length).fill("");
      idx = 0;

      renderQuestion();
      startTimer();
    }catch(e){
      console.error("startEvaluation error:", e);
      setMsg("formMsg", `No se pudo cargar la evaluación: ${e.message}`);
      clearTimer();
      show($("indexCard"));
      hide($("examCard"));
    }
  }

  async function submitEvaluation(auto){
    setMsg("uiMsg","");
    answers[idx] = $("qAnswer").value;

    const empty = answers.findIndex((x) => !String(x||"").trim());
    if (!auto && empty >= 0){
      idx = empty;
      renderQuestion();
      throw new Error("Debes responder todas las preguntas antes de enviar.");
    }

    const base = buildPayloadBase();
    const cvFile = $("cvFile")?.files?.[0];
    const cv_base64 = cvFile ? await fileToBase64(cvFile) : "";

    const payload = {
      ...base,
      started_at: Number(localStorage.getItem(LOCK_KEY)) || Date.now(),
      submitted_at: Date.now(),
      auto_submit: !!auto,
      preguntas: questions.map((q,i) => ({ id:q.id, pregunta:q.text, respuesta: answers[i] || "" })),
      cv_base64,
    };

    $("btnSend").disabled = true;

    try{
      const res = await apiPostJson(ENDPOINT_SUBMIT, payload);
      clearTimer();

      $("doneMsg").textContent = res?.msg || "Evaluación enviada.";
      openModal("modalDone");
    }catch(e){
      console.error("submitEvaluation error:", e);
      $("btnSend").disabled = false;
      throw e;
    }
  }

  // ============ INIT ============
  document.addEventListener("DOMContentLoaded", async () => {
    bindCv();
    bindModals();
    bindExam();

    hide($("examCard"));
    show($("indexCard"));
    setMsg("formMsg","");
    setMsg("uiMsg","");
    if ($("timer")) $("timer").textContent = "10:00";

    await loadPositions();
  });

})();
