/* LabCore - Evaluación de ingreso (front)
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

  // ✅ cantidad de preguntas = cantidad de módulos (siempre 8)
  const TARGET_MODULES = 8;

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
  const timerLabel = $("timerLabel");
  const timerHint = $("timerHint");
  const examError = $("examError");

  const questionHost = $("questionHost");
  const btnNext = $("btnNext");
  const btnSubmit = $("btnSubmit");

  // Modal info
  const modalInfo = $("modalInfo");
  const btnContinue = $("btnContinue");

  // Modal resultado
  const modalResult = $("modalResult");
  const mrMsg = $("mrMsg");

  // =============================
  // State
  // =============================
  const state = {
    evalByPosition: new Map(), // positionId -> { ok, questions, duration_minutes, raw }
    questions: [],
    answers: [],
    durationSeconds: 10 * 60,
    remaining: 10 * 60,
    timerHandle: null,
    examStarted: false,
    warning3mFired: false,
    warning1mFired: false,

    // Incidencias (NO se muestran)
    incidents: {
      total: 0,
      byQuestion: {},
    },

    // ✅ para trazabilidad (sin mostrar al candidato)
    orderSeed: null,
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
  // Incidents (silent)
  // =============================
  function ensureIncidentSlot(index) {
    const k = String(index);
    if (!state.incidents.byQuestion[k]) {
      state.incidents.byQuestion[k] = {
        copy: 0,
        paste: 0,
        cut: 0,
        blur: 0,
        screenshot: 0,
      };
    }
  }

  function registerIncident(type) {
    if (!state.examStarted) return;
    state.incidents.total++;
    ensureIncidentSlot(currentIndex);

    const slot = state.incidents.byQuestion[String(currentIndex)];
    if (slot && slot[type] !== undefined) slot[type]++;

    const el = document.getElementById("incidents");
    if (el) el.textContent = String(state.incidents.total);
  }

  // =============================
  // Random helpers
  // =============================
  function randomSeed() {
    // no crypto para compatibilidad + suficiente
    return (
      Date.now().toString(36) +
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2)
    );
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pickOne(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ✅ arma exactamente 1 pregunta por módulo y baraja el orden final
  function buildRandomExamFromModules(modules) {
    // modules: [{moduleId, moduleName, questions:[{id,prompt/text...}]}]
    const selected = [];

    const usable = (Array.isArray(modules) ? modules : [])
      .map((m) => ({
        moduleId: String(m?.moduleId || m?.id || m?.code || "").trim(),
        moduleName: String(m?.moduleName || m?.name || "").trim(),
        questions: Array.isArray(m?.questions) ? m.questions : [],
      }))
      .filter((m) => m.moduleId && m.questions.length > 0);

    // baraja módulos primero para que el orden cambie SIEMPRE
    shuffleInPlace(usable);

    // toma 1 por módulo hasta llegar a 8
    for (const m of usable) {
      if (selected.length >= TARGET_MODULES) break;

      const q = pickOne(m.questions);
      if (!q) continue;

      selected.push({
        id: q?.id || q?.qid || "",
        moduleId: m.moduleId,
        // moduleName NO se muestra, pero se guarda en payload si quieres
        moduleName: m.moduleName,
        prompt: q?.prompt || q?.text || q?.question || "",
      });
    }

    // baraja preguntas seleccionadas para que nunca sea “módulo 1..8”
    shuffleInPlace(selected);

    return selected;
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
  // Render WAKE
  // =============================
  async function wakeRender() {
    try {
      await fetch(ENDPOINT_POSITIONS, {
        method: "GET",
        headers: headers(),
        cache: "no-store",
        keepalive: true,
      });
    } catch (_) {}
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

  // =============================
  // Eval normalization
  // =============================
  function normalizeEvalResponse(data) {
    // Queremos módulos para poder seleccionar 1 por módulo.
    // Soporta:
    // C) { ok:true, modules:[{id,name,questions:[{id,text}]}...] } ✅ ideal
    // B) { ok:true, eval:{questions:[...] } } (sin módulos) -> fallback
    // A) { ok:true, questions:[...] } (sin módulos) -> fallback

    if (data?.ok === true && Array.isArray(data.modules)) {
      // normaliza módulos y preguntas
      const modules = data.modules.map((m) => ({
        moduleId: String(m?.id || m?.moduleId || m?.code || "").trim(),
        moduleName: String(m?.name || m?.moduleName || "").trim(),
        questions: (Array.isArray(m?.questions) ? m.questions : []).map((q) => ({
          id: q?.id || q?.qid || "",
          prompt: q?.text || q?.prompt || q?.question || "",
        })),
      }));

      return {
        ok: true,
        modules,
        duration_minutes: Number(data.duration_minutes || 10),
        raw: data,
      };
    }

    // fallback sin módulos (no ideal para tu requisito)
    if (data?.eval && Array.isArray(data.eval.questions)) {
      return {
        ok: true,
        modules: [],
        questions: data.eval.questions,
        duration_minutes: Number(data.eval.duration_minutes || 10),
        raw: data,
      };
    }

    if (data?.ok === true && Array.isArray(data.questions)) {
      return {
        ok: true,
        modules: [],
        questions: data.questions,
        duration_minutes: Number(data.duration_minutes || 10),
        raw: data,
      };
    }

    return { ok: false, modules: [], questions: [], duration_minutes: 10, raw: data };
  }

  // =============================
  // CV picker
  // =============================
  function updateCvPickerLabel() {
    if (!cvPicker) return;
    const f = cvFile?.files?.[0];
    cvPicker.textContent = f ? f.name : "Haz clic para adjuntar tu PDF";
    cvPicker.classList.toggle("has-file", !!f);
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

    if (!cvFile || cvFile.files.length === 0) return false;

    if (!university?.value.trim()) return false;
    if (!career?.value.trim()) return false;
    if (!semester?.value.trim()) return false;

    if (!acceptPolicy?.checked) return false;

    const evalData = state.evalByPosition.get(pid);
    if (!evalData?.ok) return false;

    // ✅ Debe haber 8 módulos con preguntas
    if (Array.isArray(evalData.modules) && evalData.modules.length > 0) {
      const usableModules = evalData.modules.filter(
        (m) => m.moduleId && Array.isArray(m.questions) && m.questions.length > 0
      );
      if (usableModules.length < TARGET_MODULES) return false;
      return true;
    }

    // fallback (si backend no manda módulos)
    if (Array.isArray(evalData.questions) && evalData.questions.length >= TARGET_MODULES) return true;

    return false;
  }

  function refreshStartButton() {
    if (!btnStart) return;
    const ok = isFormOk();
    btnStart.disabled = !ok;
    if (ok) setMsg(formError, "");
  }

  function isAnswerValid(text) {
    const t = String(text || "").trim();
    if (t.length < 2) return false;
    if (/^[\.\,\;\:\-\_\s·•]+$/.test(t)) return false;
    return true;
  }

  // =============================
  // Load positions + eval
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
      } else {
        // ✅ valida que haya 8 módulos con preguntas
        if (Array.isArray(normalized.modules) && normalized.modules.length > 0) {
          const usable = normalized.modules.filter(
            (m) => m.moduleId && Array.isArray(m.questions) && m.questions.length > 0
          );

          if (usable.length < TARGET_MODULES) {
            setMsg(
              formError,
              `La evaluación debe tener ${TARGET_MODULES} módulos con preguntas. Actualmente hay ${usable.length}.`
            );
          }
        } else {
          // fallback
          const count = Array.isArray(normalized.questions) ? normalized.questions.length : 0;
          if (count < TARGET_MODULES) {
            setMsg(formError, `La evaluación debe tener mínimo ${TARGET_MODULES} preguntas.`);
          }
        }
      }
    } catch (err) {
      state.evalByPosition.set(pid, { ok: false, modules: [], questions: [], duration_minutes: 10 });
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
      <div class="qcard">
        <div id="qText" class="qtitle"></div>
        <textarea id="qAnswer" class="input textarea" rows="6" autocomplete="off" spellcheck="false"></textarea>
      </div>
    `.trim();

    const ta = questionHost.querySelector("#qAnswer");
    if (ta) {
      ta.addEventListener("paste", (e) => {
        e.preventDefault();
        registerIncident("paste");
      });
      ta.addEventListener("copy", (e) => {
        e.preventDefault();
        registerIncident("copy");
      });
      ta.addEventListener("cut", (e) => {
        e.preventDefault();
        registerIncident("cut");
      });
    }
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

  function applyTimerVisuals() {
    if (!timerBox) return;
    timerBox.classList.remove("timer--warn", "timer--danger", "timer--pulse");

    if (state.remaining <= 60) {
      timerBox.classList.add("timer--danger", "timer--pulse");
    } else if (state.remaining <= 180) {
      timerBox.classList.add("timer--warn", "timer--pulse");
    }
  }

  function maybeFireWarnings() {
    if (state.remaining === 180 && !state.warning3mFired) {
      state.warning3mFired = true;
      if (timerHint) {
        timerHint.textContent = "⚠ Quedan 3 minutos";
        show(timerHint);
      }
    }
    if (state.remaining === 60 && !state.warning1mFired) {
      state.warning1mFired = true;
      if (timerHint) {
        timerHint.textContent = "⏳ Queda 1 minuto";
        show(timerHint);
      }
    }
    if (state.remaining === 0) {
      if (timerHint) hide(timerHint);
    }
  }

  function startTimer() {
    stopTimer();
    if (timerBox) show(timerBox);

    if (timerLabel) timerLabel.textContent = "Tiempo";
    if (timerEl) timerEl.textContent = formatTime(state.remaining);
    if (timerHint) hide(timerHint);

    state.warning3mFired = false;
    state.warning1mFired = false;

    applyTimerVisuals();

    state.timerHandle = setInterval(() => {
      state.remaining -= 1;
      if (timerEl) timerEl.textContent = formatTime(state.remaining);

      applyTimerVisuals();
      maybeFireWarnings();

      if (state.remaining <= 0) {
        stopTimer();
        finishExam({ dueToTimeout: true }).catch(() => {});
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

    const qTextEl = questionHost.querySelector("#qText");
    const qAnswerEl = questionHost.querySelector("#qAnswer");

    // ✅ NO mostrar módulo. Solo numeración + prompt.
    const prompt = q.prompt || q.text || q.question || "";
    const text = `${currentIndex + 1}. ${prompt}`;

    if (qTextEl) qTextEl.textContent = text;

    if (qAnswerEl) {
      qAnswerEl.value = state.answers[currentIndex] || "";
      qAnswerEl.placeholder = "Escribe tu respuesta aquí...";
      qAnswerEl.focus();
    }

    const last = currentIndex === state.questions.length - 1;
    if (last) {
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

    if (!evalData?.ok) {
      setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
      refreshStartButton();
      return;
    }

    // ✅ Selección aleatoria: 1 pregunta por módulo (8)
    let selectedQuestions = [];

    if (Array.isArray(evalData.modules) && evalData.modules.length > 0) {
      selectedQuestions = buildRandomExamFromModules(evalData.modules);

      if (selectedQuestions.length < TARGET_MODULES) {
        setMsg(
          formError,
          `No hay suficientes módulos/preguntas para generar ${TARGET_MODULES} preguntas.`
        );
        refreshStartButton();
        return;
      }
    } else {
      // fallback: si backend no manda módulos, tomamos 8 aleatorias
      const pool = Array.isArray(evalData.questions) ? [...evalData.questions] : [];
      if (pool.length < TARGET_MODULES) {
        setMsg(formError, `La evaluación debe tener mínimo ${TARGET_MODULES} preguntas.`);
        refreshStartButton();
        return;
      }
      shuffleInPlace(pool);
      selectedQuestions = pool.slice(0, TARGET_MODULES).map((q) => ({
        id: q?.id || q?.qid || "",
        moduleId: q?.moduleId || "",
        moduleName: q?.moduleName || "",
        prompt: q?.prompt || q?.text || q?.question || "",
      }));
      shuffleInPlace(selectedQuestions);
    }

    state.orderSeed = randomSeed(); // solo para trazabilidad si la quieres guardar
    state.questions = selectedQuestions;
    state.answers = new Array(state.questions.length).fill("");

    state.durationSeconds = Math.max(60, (evalData.duration_minutes || 10) * 60);
    state.remaining = state.durationSeconds;

    currentIndex = 0;
    state.examStarted = true;

    goToExamStep();

    show(btnNext);
    hide(btnSubmit);

    renderQuestion();
    startTimer();
  }

  async function finishExam({ dueToTimeout = false } = {}) {
    saveCurrentAnswer();

    const emptyIdx = state.answers.findIndex((a) => !isAnswerValid(a));
    if (emptyIdx !== -1) {
      if (dueToTimeout) {
        setMsg(examError, "Se agotó el tiempo.");
        state.examStarted = false;
        stopTimer();
        if (btnNext) btnNext.disabled = true;
        if (btnSubmit) btnSubmit.disabled = true;
        return;
      }

      currentIndex = emptyIdx;
      renderQuestion();
      setMsg(examError, `Debes responder la pregunta ${emptyIdx + 1} antes de continuar.`);
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

    if (btnSubmit) btnSubmit.disabled = true;
    const originalText = btnSubmit?.textContent || "Enviar evaluación";
    if (btnSubmit) btnSubmit.textContent = "Enviando...";

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
          order_seed: state.orderSeed, // ✅ trazabilidad del orden
        },
        // ✅ solo 8 preguntas (1 por módulo)
        questions: state.questions.map((q, i) => ({
          id: q.id || `Q${i + 1}`,
          moduleId: q.moduleId || "",
          // moduleName se envía si quieres para tu análisis interno,
          // pero el candidato NUNCA lo ve.
          moduleName: q.moduleName || "",
          prompt: q.prompt || "",
          answer: (state.answers[i] || "").trim(),
        })),
        cv: {
          name: file.name || "cv.pdf",
          mime: file.type || "application/pdf",
          base64: cvB64,
        },
        incidents: {
          total: state.incidents.total,
          detail: state.incidents.byQuestion,
        },
        timing: {
          duration_seconds: state.durationSeconds,
          remaining_seconds: state.remaining,
          finished_by_timeout: !!dueToTimeout,
        },
      };

      await postJson(ENDPOINT_SUBMIT, payload);

      if (mrMsg) mrMsg.textContent = "Evaluación enviada.";
      openModalResult();
    } catch (err) {
      setMsg(examError, err?.message || "No se pudo enviar la evaluación.");
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
      if (btnSubmit) btnSubmit.textContent = originalText;
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

  // Navegación: NO avanza si respuesta no válida
  btnNext?.addEventListener("click", () => {
    if (!state.examStarted) return;

    const ta = questionHost?.querySelector("#qAnswer");
    const currentVal = String(ta?.value || "").trim();

    if (!isAnswerValid(currentVal)) {
      setMsg(examError, "Debes escribir una respuesta válida para continuar.");
      return;
    }

    saveCurrentAnswer();

    if (currentIndex < state.questions.length - 1) {
      currentIndex += 1;
      renderQuestion();
    }
  });

  btnSubmit?.addEventListener("click", async () => {
    if (!state.examStarted) return;

    const ta = questionHost?.querySelector("#qAnswer");
    const currentVal = String(ta?.value || "").trim();

    if (!isAnswerValid(currentVal)) {
      setMsg(examError, "Debes escribir una respuesta válida antes de enviar.");
      return;
    }

    await finishExam({ dueToTimeout: false });
  });

  // Bloquear copiar / cortar / pegar durante examen (silencioso)
  ["copy", "cut", "paste"].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (!state.examStarted) return;
      e.preventDefault();
      registerIncident(evt);
    });
  });

  document.addEventListener("contextmenu", (e) => {
    if (!state.examStarted) return;
    e.preventDefault();
  });

  window.addEventListener("blur", () => {
    if (!state.examStarted) return;
    registerIncident("blur");
  });

  document.addEventListener("visibilitychange", () => {
    if (!state.examStarted) return;
    if (document.visibilityState === "hidden") registerIncident("blur");
  });

  document.addEventListener("keydown", (e) => {
    if (!state.examStarted) return;
    if (e.key === "PrintScreen") registerIncident("screenshot");
  });

  // =============================
  // Init
  // =============================
  document.addEventListener("DOMContentLoaded", async () => {
    hide(examCard);
    show(form);

    if (btnStart) {
      show(btnStart);
      btnStart.disabled = true;
    }

    updateCvPickerLabel();

    await wakeRender();

    try {
      await withRetry(async () => {
        await loadPositions();
        const optionsCount = roleSelect?.querySelectorAll("option")?.length || 0;
        if (optionsCount <= 1) throw new Error("Cargos aún no disponibles");
      }, 7);
    } catch (e) {
      setMsg(formError, "El servicio está iniciando. Espera unos segundos y recarga la página.");
      roleSelect.innerHTML = `<option value="" selected>Cargando...</option>`;
    }

    refreshStartButton();
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") await wakeRender();
  });
})();
