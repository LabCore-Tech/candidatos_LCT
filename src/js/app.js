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

  // Si existe meta, también se puede tomar de ahí
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
  const btnPrev = $("btnPrev");
  const btnNext = $("btnNext");
  const btnSubmit = $("btnSubmit");

  // Modal info
  const modalInfo = $("modalInfo");
  const btnContinue = $("btnContinue");

  // Modal resultado (tu HTML se llama modalResult)
  const modalResult = $("modalResult");
  const mrMsg = $("mrMsg");

  // =============================
  // State
  // =============================
  const state = {
    evalByPosition: new Map(), // positionId -> { ok, questions, duration_minutes }
    questions: [],
    answers: [],
    durationSeconds: 10 * 60,
    remaining: 10 * 60,
    timerHandle: null,
    examStarted: false,
  };

  let currentIndex = 0;

  // =============================
  // Utils UI
  // =============================
  function setMsg(el, msg) {
    if (!el) return;
    el.textContent = msg || "";
    if (msg) el.classList.remove("hidden", "is-hidden");
    else el.classList.add("hidden");
  }

  function show(el) {
    if (!el) return;
    el.classList.remove("hidden");
    el.classList.remove("is-hidden");
  }

  function hide(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.classList.add("is-hidden");
  }

  // =============================
  // HTTP
  // =============================
  function headers() {
    const h = { Accept: "application/json" };
    if (PUBLIC_KEY) h["X-Api-Key"] = PUBLIC_KEY;
    return h;
  }

    // =============================
  // Render WAKE (evita "cargos no cargan" cuando está dormido)
  // =============================
  async function wakeRender() {
    // endpoint liviano: positions (si está dormido, esto lo despierta)
    try {
      await fetch(ENDPOINT_POSITIONS, {
        method: "GET",
        headers: headers(),
        cache: "no-store",
      });
    } catch (_) {
      // no hacemos nada: el objetivo es "tocar" el servicio
    }
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Reintenta una función async varias veces con backoff
  async function withRetry(fn, tries = 6) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        // backoff: 0.5s, 1s, 2s, 4s, 6s, 8s...
        const wait = i === 0 ? 500 : Math.min(8000, 1000 * Math.pow(2, i - 1));
        await sleep(wait);
      }
    }
    throw lastErr || new Error("No se pudo completar la operación.");
  }


  async function fetchJson(url) {
    const res = await fetch(url, { method: "GET", headers: headers() });
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
    // Soporta:
    // A) { ok:true, questions:[...] }
    // B) { ok:true, eval:{questions:[...]} }
    // C) { ok:true, modules:[{id,name,questions:[{id,text}]}...] }  ✅ TU CASO

    // 1) caso directo
    if (data?.ok === true && Array.isArray(data.questions)) {
      return {
        ok: true,
        questions: data.questions,
        duration_minutes: Number(data.duration_minutes || 10),
        raw: data,
      };
    }

    // 2) caso eval.questions
    if (data?.eval && Array.isArray(data.eval.questions)) {
      return {
        ok: true,
        questions: data.eval.questions,
        duration_minutes: Number(data.eval.duration_minutes || 10),
        raw: data,
      };
    }

    // 3) ✅ TU CASO: modules[].questions[]  -> aplanar a [{id,moduleId,moduleName,prompt}]
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

      return {
        ok: true,
        questions: flat,
        duration_minutes: Number(data.duration_minutes || 10),
        raw: data,
      };
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
  // Validation (NO se quita)
  // =============================
  function hasPdfSelected() {
    const f = cvFile?.files?.[0];
    if (!f) return false;
    // Aceptar por mime o por extensión (por si navegador no pone mime)
    const mime = String(f.type || "").toLowerCase();
    const name = String(f.name || "").toLowerCase();
    if (mime === "application/pdf") return true;
    if (name.endsWith(".pdf")) return true;
    return false;
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

    // ✅ CV obligatorio
    if (!cvFile || cvFile.files.length === 0) return false;

    // ✅ estos TAMBIÉN obligatorios (como me dices)
    if (!university?.value.trim()) return false;
    if (!career?.value.trim()) return false;
    if (!semester?.value.trim()) return false;

    if (!acceptPolicy?.checked) return false;

    // ✅ debe existir evaluación precargada con preguntas
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


  // =============================
  // Load positions
  // =============================
  async function loadPositions() {
    setMsg(formError, "");
    // deja un placeholder fijo mientras carga
    roleSelect.innerHTML = `<option value="" selected>Cargando...</option>`;

    try {
      const data = await fetchJson(ENDPOINT_POSITIONS);

      const positions = Array.isArray(data)
        ? data
        : Array.isArray(data.positions)
          ? data.positions
          : Array.isArray(data.data)
            ? data.data
            : [];

      roleSelect.innerHTML =
        `<option value="" disabled selected>Selecciona un cargo</option>`;

      for (const p of positions) {
        const id = String(p.position_id || p.id || "").trim();
        const name = String(p.position_name || p.name || id || "").trim();
        if (!id) continue;

        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name || id;
        roleSelect.appendChild(opt);
      }
    } catch (err) {
      setMsg(formError, `No se pudieron cargar cargos: ${err.message}`);
      roleSelect.innerHTML = `<option value="" selected>Error al cargar</option>`;
    } finally {
      refreshStartButton();
    }
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

      if (!normalized.ok) {
        setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
      } else if (!normalized.questions?.length) {
        setMsg(formError, "La evaluación existe, pero no tiene preguntas.");
      }
    } catch (err) {
      state.evalByPosition.set(pid, { ok: false, questions: [], duration_minutes: 10 });
      setMsg(formError, `No se pudo cargar la evaluación: ${err.message}`);
    } finally {
      refreshStartButton();
    }
  }

  // =============================
  // Exam UI (questionHost)
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
    if (timerBox) show(timerBox);
    if (timerEl) timerEl.textContent = formatTime(state.remaining);

    state.timerHandle = setInterval(() => {
      state.remaining -= 1;
      if (timerEl) timerEl.textContent = formatTime(state.remaining);

      if (state.remaining <= 0) {
        stopTimer();
        finishExam().catch(() => {});
      }
    }, 1000);
  }

  function goToExamStep() {
    hide(form);
    show(examCard);
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

    const qTextEl2 = questionHost.querySelector("#qText");
    const qAnswerEl2 = questionHost.querySelector("#qAnswer");

    const moduleName = q.moduleName || q.module || "";
    const prompt = q.prompt || q.text || q.question || "";

    qTextEl2.textContent = moduleName
      ? `${currentIndex + 1}. ${moduleName}: ${prompt}`
      : `${currentIndex + 1}. ${prompt}`;

    qAnswerEl2.value = state.answers[currentIndex] || "";
    qAnswerEl2.placeholder = "Escribe tu respuesta aquí...";
    qAnswerEl2.focus();

    // Botones
    btnPrev.disabled = currentIndex === 0;

    // mostrar Submit solo en la última
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

    state.durationSeconds = Math.max(1, (evalData.duration_minutes || 10) * 60);
    state.remaining = state.durationSeconds;

    currentIndex = 0;
    state.examStarted = true;

    goToExamStep();
    renderQuestion();
    startTimer();
  }

  async function finishExam() {
    saveCurrentAnswer();

    const empty = state.answers.findIndex((a) => !a || !a.trim());
    if (empty !== -1) {
      currentIndex = empty;
      renderQuestion();
      setMsg(examError, `Falta responder la pregunta ${empty + 1}.`);
      return;
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
          answer: (state.answers[i] || "").trim(),
        })),
        cv: {
          name: file.name || "cv.pdf",
          mime: file.type || "application/pdf",
          base64: cvB64,
        },
      };

      await postJson(ENDPOINT_SUBMIT, payload);

      // Modal resultado (tu HTML)
      if (mrMsg) mrMsg.textContent = "Evaluación enviada.";
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

  // Start: SOLO abre modal si ya está OK (pero igual estará disabled si no)
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

  // Modal resultado: cerrar con cualquier data-close
  modalResult?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalResult);
  });

  // Examen navegación
  btnPrev?.addEventListener("click", () => {
    if (!state.examStarted) return;
    saveCurrentAnswer();
    if (currentIndex > 0) {
      currentIndex -= 1;
      renderQuestion();
    }
  });

  btnNext?.addEventListener("click", () => {
    if (!state.examStarted) return;
    saveCurrentAnswer();
    if (currentIndex < state.questions.length - 1) {
      currentIndex += 1;
      renderQuestion();
    }
  });

  btnSubmit?.addEventListener("click", async () => {
    if (!state.examStarted) return;
    await finishExam();
  });

  // =============================
  // Init
  // =============================
  document.addEventListener("DOMContentLoaded", async () => {
    hide(examCard);
    show(form);

    show(btnStart);
    btnStart.disabled = true;

    updateCvPickerLabel();

    // ✅ WAKE Render (despierta el servicio)
    setMsg(uiMsg, "Activando servicio...");
    await wakeRender();

    // ✅ Cargar cargos con reintentos (por si Render aún está levantando)
    try {
      await withRetry(async () => {
        await loadPositions();
        // valida que ya haya opciones reales
        const optionsCount = roleSelect?.querySelectorAll("option")?.length || 0;
        if (optionsCount <= 1) throw new Error("Cargos aún no disponibles");
      }, 7);
      setMsg(uiMsg, "");
    } catch (e) {
      setMsg(uiMsg, "");
      setMsg(formError, "El servicio está iniciando. Espera unos segundos y recarga la página.");
    }

    refreshStartButton();
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      await wakeRender();
    }
  });


})();
