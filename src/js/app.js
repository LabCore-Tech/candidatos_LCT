/* LabCore - Evaluación de ingreso (front)
   - Carga cargos (positions)
   - Precarga evaluación (questions) por cargo
   - Botón "Iniciar prueba" deshabilitado hasta que el formulario esté OK + evaluación OK
   - Step 1: Datos del postulante
   - Step 2: Solo evaluación (pregunta + respuesta)
*/

// 🔐 API KEY pública para evaluación
window.PUBLIC_EVAL_API_KEY =
  window.PUBLIC_EVAL_API_KEY ||
  "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

(() => {
  "use strict";

  // =============================
  // Config
  // =============================
  const API_BASE = "https://protrack-49um.onrender.com";
  const ENDPOINT_POSITIONS = `${API_BASE}/api/gh/public/positions`;
  const ENDPOINT_EVAL = `${API_BASE}/api/gh/public/eval`; // ?position_id=xxx
  const ENDPOINT_SUBMIT = `${API_BASE}/api/gh/public/submit`;

  const metaKey =
    document
      .querySelector('meta[name="PUBLIC_EVAL_API_KEY"]')
      ?.getAttribute("content") || "";
  const PUBLIC_KEY = String(window.PUBLIC_EVAL_API_KEY || metaKey || "").trim();

  // =============================
  // DOM
  // =============================
  const $ = (id) => document.getElementById(id);

  const form = $("candidateForm");

  const firstName = $("firstName");
  const lastName = $("lastName");
  const cedula = $("cedula");
  const roleSelect = $("role");

  const email = $("email");
  const phone = $("phone");
  const github = $("github");
  const linkedin = $("linkedin");

  const university = $("university");
  const career = $("career");
  const semester = $("semester");

  const cvFile = $("cvFile");
  const cvPicker = $("cvPicker");

  const acceptPolicy = $("acceptPolicy");

  const btnStart = $("btnStart");
  const formError = $("formError");

  const examCard = $("examCard");
  const timerBox = $("timerBox");
  const timerEl = $("timer");
  const examError = $("examError");

  const questionHost = $("questionHost");
  const btnNext = $("btnNext");
  const btnSubmit = $("btnSubmit");

  const modalInfo = $("modalInfo");
  const btnContinue = $("btnContinue");

  const modalResult = $("modalResult");
  const mrMsg = $("mrMsg");

  // =============================
  // State
  // =============================
  const state = {
    evalByPosition: new Map(),
    questions: [],
    answers: [],
    durationSeconds: 10 * 60,
    remaining: 10 * 60,
    timerHandle: null,
    examStarted: false,

    incidents: { total: 0, byQuestion: {} },

    _warn3: false,
    _warn1: false,
  };

  let currentIndex = 0;

  // =============================
  // Utils UI
  // =============================
  function setMsg(el, msg) {
    if (!el) return;
    el.textContent = msg || "";
    if (msg) el.classList.remove("hidden", "is-hidden");
    else el.classList.add("hidden", "is-hidden");
  }

  function show(el) {
    if (!el) return;
    el.classList.remove("hidden", "is-hidden");
  }

  function hide(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.classList.add("is-hidden");
  }

  function ensureIncidentSlot(index) {
    if (!state.incidents.byQuestion[index]) {
      state.incidents.byQuestion[index] = {
        copy: 0,
        paste: 0,
        cut: 0,
        blur: 0,
        screenshot: 0
      };
    }
  }

  function registerIncident(type) {
    state.incidents.total++;
    ensureIncidentSlot(currentIndex);
    if (state.incidents.byQuestion[currentIndex][type] !== undefined) {
      state.incidents.byQuestion[currentIndex][type]++;
    }
    // NO se muestra en UI (por tu instrucción)
  }

  // =============================
  // HTTP
  // =============================
  function headers() {
    const h = { Accept: "application/json" };
    if (PUBLIC_KEY) h["X-Api-Key"] = PUBLIC_KEY;
    return h;
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function withRetry(fn, tries = 7) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const wait = i === 0 ? 600 : Math.min(8000, 900 * Math.pow(2, i - 1));
        await sleep(wait);
      }
    }
    throw lastErr || new Error("No se pudo completar la operación.");
  }

  async function fetchJson(url) {
    const res = await fetch(url, { method: "GET", headers: headers(), cache: "no-store" });
    const ct = (res.headers.get("content-type") || "").toLowerCase();

    if (!ct.includes("application/json")) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Respuesta no JSON (${res.status}). ${txt.slice(0, 160)}`);
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.msg || data?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function postJson(url, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let data = null;

    if (ct.includes("application/json")) {
      data = await res.json().catch(() => null);
    } else {
      const txt = await res.text().catch(() => "");
      data = { ok: false, msg: txt?.slice(0, 160) || `HTTP ${res.status}` };
    }

    if (!res.ok || !data || data.ok === false) {
      const msg = data?.msg || data?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  }

  function normalizeEvalResponse(data) {
    if (data?.ok === true && Array.isArray(data.questions)) {
      return { ok: true, questions: data.questions, duration_minutes: Number(data.duration_minutes || 10), raw: data };
    }
    if (data?.eval && Array.isArray(data.eval.questions)) {
      return { ok: true, questions: data.eval.questions, duration_minutes: Number(data.eval.duration_minutes || 10), raw: data };
    }
    if (data?.ok === true && Array.isArray(data.modules)) {
      const flat = [];
      for (const m of data.modules) {
        const moduleId = String(m?.id || m?.moduleId || m?.code || "").trim();
        const moduleName = String(m?.name || m?.moduleName || "").trim();
        const qs = Array.isArray(m?.questions) ? m.questions : [];
        for (const q of qs) {
          flat.push({
            id: q?.id || q?.qid || "",
            moduleId,
            moduleName,
            prompt: q?.text || q?.prompt || q?.question || "",
          });
        }
      }
      return { ok: true, questions: flat, duration_minutes: Number(data.duration_minutes || 10), raw: data };
    }
    return { ok: false, questions: [], duration_minutes: 10, raw: data };
  }

  // =============================
  // CV picker
  // =============================
  function updateCvPickerLabel() {
    if (!cvPicker) return;
    const f = cvFile?.files?.[0];
    cvPicker.textContent = f ? f.name : "Haz clic para adjuntar tu PDF";
  }

  function fileToBase64NoPrefix(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const res = String(fr.result || "");
        const parts = res.split("base64,");
        resolve(parts.length > 1 ? parts[1] : "");
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  // =============================
  // Validation
  // =============================
  function hasPdfSelected() {
    const f = cvFile?.files?.[0];
    if (!f) return false;
    const mime = String(f.type || "").toLowerCase();
    const name = String(f.name || "").toLowerCase();
    return mime === "application/pdf" || name.endsWith(".pdf");
  }

  function isFormOk() {
    if (!firstName?.value.trim()) return false;
    if (!lastName?.value.trim()) return false;
    if (!cedula?.value.trim()) return false;

    const pid = roleSelect?.value ? String(roleSelect.value).trim() : "";
    if (!pid) return false;

    if (!email?.value.trim()) return false;
    if (!phone?.value.trim()) return false;
    if (!github?.value.trim()) return false;

    if (!cvFile || cvFile.files.length === 0) return false;

    if (!university?.value.trim()) return false;
    if (!career?.value.trim()) return false;
    if (!semester?.value.trim()) return false;

    if (!acceptPolicy?.checked) return false;

    const evalData = state.evalByPosition.get(pid);
    if (!evalData?.ok || !evalData.questions?.length) return false;

    return true;
  }

  function refreshStartButton() {
    if (!btnStart) return;
    show(btnStart);
    const ok = isFormOk();
    btnStart.disabled = !ok;
    if (ok) setMsg(formError, "");
  }

  // ✅ validación de respuesta (no puntos / no vacío / no solo signos)
  function isAnswerValid(text) {
    const raw = String(text || "").trim();
    if (!raw) return false;
    if (/^[\.,;:!¡?¿\-_=\+\*~`'\s]+$/.test(raw)) return false;
    if (/^[\.\s]+$/.test(raw)) return false;

    const alnum = raw.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]/g, "");
    if (alnum.length < 3) return false;

    const uniq = new Set(raw.split(""));
    if (uniq.size <= 2 && raw.length >= 6) return false;

    if (raw.length < 8) return false;
    return true;
  }

  function requireValidAnswerOrShow() {
    const a = String(state.answers[currentIndex] || "").trim();
    if (isAnswerValid(a)) return true;
    setMsg(examError, "Responde bien antes de continuar (no vacío, no puntos, no '...').");
    questionHost?.querySelector("#qAnswer")?.focus();
    return false;
  }

  // =============================
  // Load positions + preload eval
  // =============================
  async function loadPositions() {
    setMsg(formError, "");
    roleSelect.innerHTML = `<option value="" selected>Cargando...</option>`;

    const data = await fetchJson(ENDPOINT_POSITIONS);

    const positions = Array.isArray(data)
      ? data
      : Array.isArray(data.positions)
        ? data.positions
        : Array.isArray(data.data)
          ? data.data
          : [];

    roleSelect.innerHTML = `<option value="" disabled selected>Selecciona un cargo</option>`;

    for (const p of positions) {
      const id = String(p.position_id || p.id || "").trim();
      const name = String(p.position_name || p.name || id || "").trim();
      if (!id) continue;

      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name || id;
      roleSelect.appendChild(opt);
    }

    refreshStartButton();
  }

  async function preloadEvalForPosition(positionId) {
    const pid = String(positionId || "").trim();
    if (!pid) return;
    if (state.evalByPosition.has(pid)) return;

    setMsg(formError, "");

    try {
      const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(pid)}`;
      const data = await fetchJson(url);
      const normalized = normalizeEvalResponse(data);
      state.evalByPosition.set(pid, normalized);

      if (!normalized.ok) setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
      else if (!normalized.questions?.length) setMsg(formError, "La evaluación existe, pero no tiene preguntas.");
    } catch (err) {
      state.evalByPosition.set(pid, { ok: false, questions: [], duration_minutes: 10 });
      setMsg(formError, `No se pudo cargar la evaluación: ${err.message}`);
    } finally {
      refreshStartButton();
    }
  }

  // =============================
  // Exam UI
  // =============================
  function ensureQuestionUI() {
    if (!questionHost) return;
    if (questionHost.querySelector("#qText") && questionHost.querySelector("#qAnswer")) return;

    questionHost.innerHTML = `
      <div class="question">
        <div id="qText" class="question__text"></div>
        <textarea id="qAnswer" class="input textarea" rows="6"></textarea>
      </div>
    `.trim();
  }

  function formatTime(sec) {
    const s = Math.max(0, sec | 0);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function stopTimer() {
    if (state.timerHandle) clearInterval(state.timerHandle);
    state.timerHandle = null;
  }

  function startTimer() {
    stopTimer();
    show(timerBox);
    if (timerEl) timerEl.textContent = formatTime(state.remaining);

    state._warn3 = false;
    state._warn1 = false;

    timerBox?.classList?.remove("timer--warn", "timer--danger");

    state.timerHandle = setInterval(() => {
      state.remaining -= 1;
      if (timerEl) timerEl.textContent = formatTime(state.remaining);

      if (timerBox) {
        if (state.remaining <= 60) {
          timerBox.classList.add("timer--danger");
          timerBox.classList.remove("timer--warn");
        } else if (state.remaining <= 180) {
          timerBox.classList.add("timer--warn");
          timerBox.classList.remove("timer--danger");
        } else {
          timerBox.classList.remove("timer--warn", "timer--danger");
        }
      }

      if (!state._warn3 && state.remaining === 180) {
        state._warn3 = true;
        setMsg(examError, "⏳ Quedan 3 minutos.");
        setTimeout(() => setMsg(examError, ""), 2200);
      }
      if (!state._warn1 && state.remaining === 60) {
        state._warn1 = true;
        setMsg(examError, "⚠️ Queda 1 minuto.");
        setTimeout(() => setMsg(examError, ""), 2200);
      }

      if (state.remaining <= 0) {
        stopTimer();
        finishExam(true).catch(() => {});
      }
    }, 1000);
  }

  function goToExamStep() {
    hide(form);
    show(examCard);
    show(timerBox);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveCurrentAnswer() {
    const ta = questionHost?.querySelector("#qAnswer");
    state.answers[currentIndex] = String(ta?.value || "").trim();
  }

  function renderQuestion() {
    ensureQuestionUI();

    const q = state.questions[currentIndex];
    if (!q) return;

    const qTextEl = questionHost.querySelector("#qText");
    const qAnswerEl = questionHost.querySelector("#qAnswer");

    const moduleName = q.moduleName || q.module || "";
    const prompt = q.prompt || q.text || q.question || "";

    qTextEl.textContent = moduleName
      ? `${currentIndex + 1}. ${moduleName}: ${prompt}`
      : `${currentIndex + 1}. ${prompt}`;

    qAnswerEl.value = state.answers[currentIndex] || "";
    qAnswerEl.placeholder = "Escribe tu respuesta aquí...";
    qAnswerEl.focus();

    // ✅ SOLO UNO visible
    if (currentIndex === state.questions.length - 1) {
      hide(btnNext);
      show(btnSubmit);
    } else {
      show(btnNext);
      hide(btnSubmit);
    }

    setMsg(examError, "");
  }

  function beginExam() {
    const pid = String(roleSelect.value || "").trim();
    const evalData = state.evalByPosition.get(pid);

    if (!evalData?.ok || !evalData.questions?.length) {
      setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
      refreshStartButton();
      return;
    }

    state.questions = evalData.questions;
    state.answers = new Array(state.questions.length).fill("");

    const minutes = Math.max(1, Number(evalData.duration_minutes || 10));
    state.durationSeconds = minutes * 60;
    state.remaining = state.durationSeconds;

    currentIndex = 0;
    state.examStarted = true;

    goToExamStep();
    renderQuestion();
    startTimer();
  }

  async function finishExam(forceSend = false) {
    saveCurrentAnswer();

    // Si NO es forzado (tiempo normal), valida que todas estén OK
    if (!forceSend) {
      const bad = state.answers.findIndex((a) => !isAnswerValid(a));
      if (bad !== -1) {
        currentIndex = bad;
        renderQuestion();
        setMsg(examError, "Responde bien antes de enviar (no vacío, no puntos, no '...').");
        return;
      }
    }

    const file = cvFile?.files?.[0];
    if (!file) {
      setMsg(examError, "Falta adjuntar el CV.");
      return;
    }
    if (!hasPdfSelected()) {
      setMsg(examError, "El CV debe ser PDF.");
      return;
    }

    btnSubmit.disabled = true;
    const originalText = btnSubmit.textContent;
    btnSubmit.textContent = "Enviando...";

    try {
      const cvB64 = await fileToBase64NoPrefix(file);
      const pid = String(roleSelect.value || "").trim();

      const payload = {
        candidate: {
          positionId: pid,
          roleId: pid,
          role: pid,

          first_name: firstName.value.trim(),
          last_name: lastName.value.trim(),
          cedula: cedula.value.trim(),

          email: email.value.trim(),
          phone: phone.value.trim(),
          github: github.value.trim(),
          linkedin: (linkedin?.value || "").trim(),

          university: university.value.trim(),
          career: career.value.trim(),
          semester: semester.value.trim(),
        },
        meta: {
          user_agent: navigator.userAgent,
          lang: navigator.language,
        },
        questions: state.questions.map((q, i) => ({
          id: q.id || q.qid || `Q${i + 1}`,
          moduleId: q.moduleId || q.module || "",
          moduleName: q.moduleName || "",
          prompt: q.prompt || q.text || q.question || "",
          answer: (forceSend && !isAnswerValid(state.answers[i])) ? "" : String(state.answers[i] || "").trim(),
        })),
        cv: {
          name: file.name || "cv.pdf",
          mime: file.type || "application/pdf",
          base64: cvB64,
        },
        incidents: {
          total: state.incidents.total,
          detail: state.incidents.byQuestion
        },
      };

      await postJson(ENDPOINT_SUBMIT, payload);

      if (mrMsg) mrMsg.textContent = forceSend ? "Se acabó el tiempo. Evaluación enviada." : "Evaluación enviada.";
      openModalResult();
    } catch (err) {
      setMsg(examError, err?.message || "No se pudo enviar la evaluación.");
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = originalText;
    }
  }

  // =============================
  // Modals
  // =============================
  function openModalInfo() {
    if (!modalInfo) return;
    modalInfo.classList.remove("hidden", "is-hidden");
    modalInfo.classList.add("open");
  }

  function closeModalInfo() {
    if (!modalInfo) return;
    modalInfo.classList.remove("open");
    modalInfo.classList.add("hidden");
  }

  function openModalResult() {
    if (!modalResult) return;
    modalResult.classList.remove("hidden", "is-hidden");
    modalResult.classList.add("open");
  }

  function closeModalResult() {
    if (!modalResult) return;
    modalResult.classList.remove("open");
    modalResult.classList.add("hidden");
  }

  // =============================
  // Events
  // =============================
  const revalidate = () => refreshStartButton();

  [firstName, lastName, cedula, email, phone, github, linkedin, university, career, semester]
    .forEach((el) => el?.addEventListener("input", revalidate));

  acceptPolicy?.addEventListener("change", revalidate);

  cvPicker?.addEventListener("click", () => cvFile?.click());
  cvPicker?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cvFile?.click();
    }
  });

  cvFile?.addEventListener("change", () => {
    updateCvPickerLabel();
    refreshStartButton();
  });

  roleSelect?.addEventListener("change", async () => {
    const pid = String(roleSelect.value || "").trim();
    await preloadEvalForPosition(pid);
    refreshStartButton();
  });

  btnStart?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!isFormOk()) {
      setMsg(formError, "Completa todos los campos obligatorios (*) y adjunta tu PDF.");
      return;
    }
    openModalInfo();
  });

  btnContinue?.addEventListener("click", () => {
    closeModalInfo();
    beginExam();
  });

  modalInfo?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalInfo);
  });

  modalResult?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalResult);
  });

  // ✅ Next: no pasa sin respuesta válida
  btnNext?.addEventListener("click", () => {
    if (!state.examStarted) return;
    saveCurrentAnswer();
    if (!requireValidAnswerOrShow()) return;

    if (currentIndex < state.questions.length - 1) {
      currentIndex += 1;
      renderQuestion();
    }
  });

  // ✅ Submit: valida todas
  btnSubmit?.addEventListener("click", async () => {
    if (!state.examStarted) return;
    saveCurrentAnswer();

    const bad = state.answers.findIndex((a) => !isAnswerValid(a));
    if (bad !== -1) {
      currentIndex = bad;
      renderQuestion();
      setMsg(examError, "Responde bien antes de enviar (no vacío, no puntos, no '...').");
      return;
    }

    await finishExam(false);
  });

  // Incidentes: bloquear copy/cut/paste durante examen
  ["copy", "cut", "paste"].forEach(evt => {
    document.addEventListener(evt, (e) => {
      if (!state.examStarted) return;
      e.preventDefault();
      registerIncident(evt);
    });
  });

  window.addEventListener("blur", () => {
    if (!state.examStarted) return;
    registerIncident("blur");
  });

  document.addEventListener("visibilitychange", () => {
    if (!state.examStarted) return;
    if (document.visibilityState === "hidden") registerIncident("blur");
  });

  // =============================
  // Init (SIN wakeRender / SIN uiMsg)
  // =============================
  document.addEventListener("DOMContentLoaded", async () => {
    hide(examCard);
    show(form);

    show(btnStart);
    btnStart.disabled = true;

    updateCvPickerLabel();

    try {
      await withRetry(async () => {
        await loadPositions();
        const optionsCount = roleSelect?.querySelectorAll("option")?.length || 0;
        if (optionsCount <= 1) throw new Error("Cargos aún no disponibles");
      }, 7);
    } catch (e) {
      setMsg(formError, "El servicio está iniciando. Espera unos segundos y recarga la página.");
    }

    refreshStartButton();
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      try { await loadPositions(); } catch (_) {}
      refreshStartButton();
    }
  });

})();
