/* LabCore - Evaluación de ingreso (front)
   - Carga cargos (positions)
   - Precarga evaluación (questions) por cargo
   - "Iniciar prueba" visible siempre, habilitado solo si formulario OK + evaluación OK
   - Step 1: Datos del postulante
   - Step 2: Solo evaluación
*/

// 🔐 API KEY pública para evaluación (tu valor)
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

  const email = $("email");
  const phone = $("phone");
  const github = $("github");
  const linkedin = $("linkedin");

  const university = $("university");
  const career = $("career");
  const semester = $("semester");

  const roleSelect = $("role");

  const cvFile = $("cvFile");     // input type=file (hidden)
  const cvPicker = $("cvPicker"); // button (campo visible)
  const acceptPolicy = $("acceptPolicy");

  const btnStart = $("btnStart");
  const formError = $("formError");
  const uiMsg = $("uiMsg");

  const examCard = $("examCard");
  const timerEl = $("timer");
  const qTextEl = $("qText");
  const qAnswerEl = $("qAnswer");
  const btnNext = $("btnNext");
  const examError = $("examError");

  const modalInfo = $("modalInfo");
  const btnContinue = $("btnContinue");
  const modalDone = $("modalDone");
  const modalDoneClose = $("modalDoneClose");
  const btnDoneOk = $("btnDoneOk");

  // =============================
  // State
  // =============================
  const state = {
    evalByPosition: new Map(), // positionId -> { ok, questions, duration_minutes }
    activePositionId: "",
    questions: [],
    answers: [],
    durationSeconds: 10 * 60,
    remaining: 10 * 60,
    timerHandle: null,
    examStarted: false,
  };

  let currentIndex = 0;

  // =============================
  // Utils
  // =============================
  function setMsg(el, msg) {
    if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
  }

  function show(el) {
    if (!el) return;
    el.classList.remove("is-hidden", "hidden");
  }

  function hide(el) {
    if (!el) return;
    el.classList.add("is-hidden");
  }

  function headers() {
    const h = { Accept: "application/json" };
    if (PUBLIC_KEY) h["X-Api-Key"] = PUBLIC_KEY; // 👈 CLAVE para evitar 401
    return h;
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
    // B) { eval:{questions:[...], duration_minutes} }
    if (data?.ok === true) {
      return {
        ok: true,
        questions: Array.isArray(data.questions) ? data.questions : [],
        duration_minutes: 10,
      };
    }
    if (data?.eval) {
      return {
        ok: true,
        questions: Array.isArray(data.eval.questions) ? data.eval.questions : [],
        duration_minutes: Number(data.eval.duration_minutes || 10),
      };
    }
    return { ok: false, questions: [], duration_minutes: 10 };
  }

  function formatTime(sec) {
    const s = Math.max(0, sec | 0);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function goToExamStep() {
    hide(form);
    show(examCard);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

    // además: debe existir evaluación precargada con preguntas
    const evalData = state.evalByPosition.get(pid);
    if (!evalData?.ok || !evalData.questions?.length) return false;

    return true;
  }

  function refreshStartButton() {
     if (!btnStart) return;
   
     // ✅ SIEMPRE visible y SIEMPRE habilitado
     show(btnStart);
     btnStart.disabled = false;
   
     // Si quieres limpiar mensajes cuando ya está ok
     if (isFormOk()) setMsg(formError, "");
   }


  // =============================
  // Load positions
  // =============================
  async function loadPositions() {
    setMsg(uiMsg, "Cargando cargos...");
    setMsg(formError, "");

    try {
      const data = await fetchJson(ENDPOINT_POSITIONS);

      // Respuestas posibles:
      // - array directo
      // - { positions:[...] }
      // - { data:[...] }
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

      setMsg(uiMsg, "");
    } catch (err) {
      setMsg(uiMsg, "");
      setMsg(formError, `No se pudieron cargar cargos: ${err.message}`);
    } finally {
      refreshStartButton();
    }
  }

  async function preloadEvalForPosition(positionId) {
    const pid = String(positionId || "").trim();
    if (!pid) return;
    if (state.evalByPosition.has(pid)) return;

    setMsg(uiMsg, "Cargando evaluación...");
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
      } else {
        setMsg(formError, "");
      }
    } catch (err) {
      state.evalByPosition.set(pid, { ok: false, questions: [], duration_minutes: 10 });
      setMsg(formError, `No se pudo cargar la evaluación: ${err.message}`);
    } finally {
      setMsg(uiMsg, "");
      refreshStartButton();
    }
  }

  // =============================
  // Exam flow
  // =============================
  function stopTimer() {
    if (state.timerHandle) clearInterval(state.timerHandle);
    state.timerHandle = null;
  }

  function startTimer() {
    stopTimer();
    timerEl.textContent = formatTime(state.remaining);
    state.timerHandle = setInterval(() => {
      state.remaining -= 1;
      timerEl.textContent = formatTime(state.remaining);
      if (state.remaining <= 0) {
        stopTimer();
        finishExam().catch(() => {});
      }
    }, 1000);
  }

  function saveCurrentAnswer() {
    state.answers[currentIndex] = (qAnswerEl.value || "").trim();
  }

  function renderQuestion() {
    const q = state.questions[currentIndex];
    if (!q) return;

    const moduleName = q.moduleName || q.module || "";
    const prompt = q.prompt || q.text || q.question || "";

    qTextEl.textContent = moduleName
      ? `${currentIndex + 1}. ${moduleName}: ${prompt}`
      : `${currentIndex + 1}. ${prompt}`;

    qAnswerEl.value = state.answers[currentIndex] || "";
    qAnswerEl.placeholder = "Escribe tu respuesta aquí...";
    qAnswerEl.focus();

    btnNext.textContent =
      currentIndex === state.questions.length - 1 ? "Enviar evaluación" : "Siguiente";

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

    state.activePositionId = pid;
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

    if ((file.type || "").toLowerCase() !== "application/pdf") {
      setMsg(examError, "El CV debe ser PDF.");
      return;
    }

    btnNext.disabled = true;
    const originalBtnText = btnNext.textContent;
    btnNext.textContent = "Enviando...";

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
          linkedin: linkedin.value.trim(),

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
      openModalDone("Evaluación enviada");
    } catch (err) {
      setMsg(examError, err?.message || "No se pudo enviar la evaluación.");
    } finally {
      btnNext.disabled = false;
      btnNext.textContent = originalBtnText;
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

  function openModalDone(title) {
    if (!modalDone) return;
    const t = $("modalDoneTitle");
    if (t) t.textContent = title || "Listo";
    modalDone.classList.remove("hidden", "is-hidden");
    modalDone.classList.add("open");
  }

  function closeModalDone() {
    if (!modalDone) return;
    modalDone.classList.remove("open");
    modalDone.classList.add("hidden");
  }

  // =============================
  // Events
  // =============================
  const revalidate = () => refreshStartButton();

  [firstName, lastName, cedula, university, career, semester].forEach((el) =>
    el?.addEventListener("input", revalidate)
  );
  [email, phone, github, linkedin].forEach((el) =>
    el?.addEventListener("input", revalidate)
  );
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
    state.activePositionId = pid;
    await preloadEvalForPosition(pid);
    refreshStartButton();
  });

  btnStart?.addEventListener("click", (e) => {
     e.preventDefault();
   
     // ✅ Aquí validas (en vez de deshabilitar el botón)
     if (!isFormOk()) {
       setMsg(formError, "Completa todos los campos obligatorios y adjunta tu hoja de vida (PDF).");
       return;
     }
   
     // ✅ Si todo está OK, recién ahí abre la popup
     openModalInfo();
   });

  btnContinue?.addEventListener("click", () => {
    closeModalInfo();
    beginExam();
  });

  modalInfo?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalInfo);
  });

  btnNext?.addEventListener("click", async () => {
    if (!state.examStarted) return;
    saveCurrentAnswer();

    if (currentIndex < state.questions.length - 1) {
      currentIndex += 1;
      renderQuestion();
      return;
    }

    await finishExam();
  });

  modalDoneClose?.addEventListener("click", closeModalDone);
  btnDoneOk?.addEventListener("click", closeModalDone);

  // =============================
  // Init
  // =============================
  document.addEventListener("DOMContentLoaded", async () => {
    hide(examCard);
    show(form);

    show(btnStart);
    btnStart.disabled = true;

    updateCvPickerLabel();
    await loadPositions();
    refreshStartButton();
  });
})();
