/* LabCore - Evaluación de ingreso (front)
   - Carga cargos (positions)
   - Precarga evaluación (questions) por cargo
   - Habilita "Iniciar prueba" SOLO cuando el formulario es válido + hay preguntas
   - Step 1: Datos del postulante
   - Step 2: Solo pregunta + textarea de respuesta (responsive)
*/
// 🔐 API KEY pública para evaluación
window.PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

(() => {
  // =============================
  // Config
  // =============================
  const API_BASE = "https://protrack-49um.onrender.com";
  
  const ENDPOINT_POSITIONS = `${API_BASE}/api/gh/public/positions`;
  const ENDPOINT_EVAL = `${API_BASE}/api/gh/public/eval`; // ?position_id=xxx
  const ENDPOINT_SUBMIT = `${API_BASE}/api/gh/public/submit`;


  // Si existe <meta name="PUBLIC_EVAL_API_KEY" content="..."> lo toma de ahí
  const metaKey =
    document.querySelector('meta[name="PUBLIC_EVAL_API_KEY"]')?.getAttribute("content") || "";
  const PUBLIC_KEY = window.PUBLIC_EVAL_API_KEY || metaKey || "";

    // =============================
  // DOM
  // =============================
  const $ = (id) => document.getElementById(id);

  const form = $("candidateForm");
  const firstName = $("firstName");
  const lastName = $("lastName");
  const cedula = $("cedula");

  // ✅ (Opcionales: si existen en tu HTML, se usan. Si no existen, NO rompe)
  const email = $("email");
  const phone = $("phone");
  const github = $("github");
  const linkedin = $("linkedin");

  const university = $("university");
  const career = $("career");
  const semester = $("semester");
  const roleSelect = $("role");
  const cvFile = $("cvFile");
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

  // Modales (si existen)
  const modalInfo = $("modalInfo");
  const modalInfoClose = $("modalInfoClose");
  const btnCancelStart = $("btnCancelStart");
  const btnAcceptStart = $("btnAcceptStart");

  const modalDone = $("modalDone");
  const modalDoneClose = $("modalDoneClose");
  const btnDoneOk = $("btnDoneOk");

  // =============================
  // State
  // =============================
  const state = {
    positions: [],
    evalByPosition: new Map(), // position_id -> normalized eval
    activePositionId: "",
    questions: [],
    answers: [],
    durationSeconds: 10 * 60,
    remaining: 10 * 60,
    timerHandle: null,
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

  function show(el) { el?.classList.remove("is-hidden"); }
  function hide(el) { el?.classList.add("is-hidden"); }

  function headers() {
    const h = { Accept: "application/json" };
    if (PUBLIC_KEY) h["X-Api-Key"] = PUBLIC_KEY;
    return h;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { method: "GET", headers: headers() });
    const ct = (res.headers.get("content-type") || "").toLowerCase();

    if (!ct.includes("application/json")) {
      const txt = await res.text();
      throw new Error(`Respuesta no JSON (${res.status}). ${txt.slice(0, 160)}`);
    }

    const data = await res.json();
    if (!res.ok) {
      const msg = data?.msg || data?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  // ✅ NUEVO: POST JSON para enviar evaluación
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
      const err = new Error(msg);
      err.code = data?.code || "";
      throw err;
    }

    return data;
  }

  // ✅ NUEVO: convierte archivo PDF a base64 (sin prefijo data:)
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

  function normalizeEvalResponse(data) {
    // Soporta:
    // A) { ok:true, position:{...}, qb:{...}, questions:[...] }
    // B) { eval:{questions:[...], duration_minutes, title}, position:{...}, qb:{...} }
    if (data?.ok === true) {
      return {
        ok: true,
        position: data.position,
        qb: data.qb,
        questions: Array.isArray(data.questions) ? data.questions : [],
        duration_minutes: 10,
        title: "Evaluación de ingreso",
        raw: data,
      };
    }
    if (data?.eval) {
      return {
        ok: true,
        position: data.position,
        qb: data.qb,
        questions: Array.isArray(data.eval.questions) ? data.eval.questions : [],
        duration_minutes: Number(data.eval.duration_minutes || 10),
        title: String(data.eval.title || "Evaluación de ingreso"),
        raw: data,
      };
    }
    return { ok: false, questions: [], raw: data };
  }

  function formatTime(sec) {
    const s = Math.max(0, sec | 0);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  // =============================
  // Step control
  // =============================
  function goToExamStep() {
    hide(form);        // Paso 1 fuera
    show(examCard);    // Paso 2 solo evaluación
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // =============================
  // Validation
  // =============================
  function isFormOk() {
    if (!firstName.value.trim()) return false;
    if (!lastName.value.trim()) return false;
    if (!cedula.value.trim()) return false;

    // ✅ Si estos inputs existen en tu HTML, se vuelven obligatorios (backend los exige)
    if (email && !email.value.trim()) return false;
    if (phone && !phone.value.trim()) return false;
    if (github && !github.value.trim()) return false;

    if (!university.value.trim()) return false;
    if (!career.value.trim()) return false;
    if (!semester.value.trim()) return false;
    if (!roleSelect.value.trim()) return false;
    if (!cvFile.files || cvFile.files.length === 0) return false;
    if (!acceptPolicy.checked) return false;

    const pid = roleSelect.value.trim();
    const evalData = state.evalByPosition.get(pid);
    if (!evalData?.ok) return false;
    if (!Array.isArray(evalData.questions) || evalData.questions.length === 0) return false;

    return true;
  }

  function refreshStartButton() {
    if (isFormOk()) {
      btnStart.disabled = false;
      show(btnStart);            // requisito: solo aparece cuando todo OK
      setMsg(formError, "");
    } else {
      btnStart.disabled = true;
      hide(btnStart);
    }
  }

  // =============================
  // Data load
  // =============================
  async function loadPositions() {
    setMsg(uiMsg, "Cargando cargos...");
    try {
      const data = await fetchJson(ENDPOINT_POSITIONS);
      const positions = Array.isArray(data) ? data : (data.positions || data.data || []);
      state.positions = positions;

      roleSelect.innerHTML = `<option value="" disabled selected>Selecciona un cargo</option>`;
      for (const p of positions) {
        const id = String(p.position_id || p.id || "").trim();
        const name = String(p.position_name || p.name || id);
        if (!id) continue;
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name;
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
    if (!positionId) return;
    if (state.evalByPosition.has(positionId)) return;

    setMsg(uiMsg, "Cargando evaluación...");
    try {
      const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;
      const data = await fetchJson(url);
      const normalized = normalizeEvalResponse(data);

      state.evalByPosition.set(positionId, normalized);

      if (!normalized.ok) {
        setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
      } else if (!normalized.questions?.length) {
        setMsg(formError, "La evaluación existe, pero no tiene preguntas.");
      } else {
        setMsg(formError, "");
      }
    } catch (err) {
      setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
    } finally {
      setMsg(uiMsg, "");
      refreshStartButton();
    }
  }

  // =============================
  // Exam
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
        // ✅ finishExam ahora es async
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

    // Paso 2: SOLO pregunta + respuesta
    qTextEl.textContent = moduleName
      ? `${currentIndex + 1}. ${moduleName}: ${prompt}`
      : `${currentIndex + 1}. ${prompt}`;

    qAnswerEl.value = state.answers[currentIndex] || "";
    qAnswerEl.placeholder = "Escribe tu respuesta aquí...";
    qAnswerEl.focus();

    btnNext.textContent = currentIndex === state.questions.length - 1
      ? "Enviar evaluación"
      : "Siguiente";

    setMsg(examError, "");
  }

  // ✅ CAMBIO: finishExam ahora envía POST y hace popup SOLO para "Límite máximo alcanzado."
  async function finishExam() {
    saveCurrentAnswer();

    const empty = state.answers.findIndex((a) => !a || !a.trim());
    if (empty !== -1) {
      currentIndex = empty;
      renderQuestion();
      setMsg(examError, `Falta responder la pregunta ${empty + 1}.`);
      return;
    }

    // Backend exige estos 3 campos
    const emailVal = email ? email.value.trim() : "";
    const phoneVal = phone ? phone.value.trim() : "";
    const githubVal = github ? github.value.trim() : "";

    if (email && !emailVal) { setMsg(examError, "Email es obligatorio."); return; }
    if (phone && !phoneVal) { setMsg(examError, "Celular es obligatorio."); return; }
    if (github && !githubVal) { setMsg(examError, "GitHub es obligatorio."); return; }

    const file = cvFile?.files?.[0];
    if (!file) { setMsg(examError, "Falta adjuntar el CV."); return; }

    // Si quieres ser estricto con PDF:
    // (puedes comentar este if si no quieres forzar)
    if ((file.type || "").toLowerCase() !== "application/pdf") {
      setMsg(examError, "El CV debe ser PDF.");
      return;
    }

    btnNext.disabled = true;
    const originalBtnText = btnNext.textContent;
    btnNext.textContent = "Enviando...";

    try {
      const cvB64 = await fileToBase64NoPrefix(file);

      const pid = roleSelect.value.trim();

      // Payload EXACTO que espera tu app.py:
      // b = { candidate, meta, questions, cv }
      const payload = {
        candidate: {
          positionId: pid,
          roleId: pid,
          role: pid,

          first_name: firstName.value.trim(),
          last_name: lastName.value.trim(),
          cedula: cedula.value.trim(),

          // obligatorios en backend (si existen inputs, ya validamos arriba)
          email: emailVal,
          phone: phoneVal,
          github: githubVal,
          linkedin: linkedin ? (linkedin.value.trim()) : "",

          university: university.value.trim(),
          career: career.value.trim(),
          semester: semester.value.trim(),
        },
        meta: {
          user_agent: navigator.userAgent,
          lang: navigator.language,
        },
        // questions: array con pregunta + respuesta
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
      const msg = err?.message || "No se pudo enviar la evaluación.";

      // ✅ POPUP SOLO para este caso exacto
      if (msg === "Límite máximo alcanzado.") {
        openModalDone(msg);
        return;
      }

      // otros errores: no popup
      setMsg(examError, msg);
    } finally {
      btnNext.disabled = false;
      btnNext.textContent = originalBtnText;
    }
  }

  function openModalInfo() { modalInfo?.classList.add("open"); }
  function closeModalInfo() { modalInfo?.classList.remove("open"); }

  function openModalDone(title) {
    if (modalDone) {
      const t = $("modalDoneTitle");
      if (t) t.textContent = title || "Listo";
      modalDone.classList.add("open");
    }
  }
  function closeModalDone() { modalDone?.classList.remove("open"); }

  function beginExam() {
    const pid = roleSelect.value.trim();
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

    goToExamStep();
    renderQuestion();
    startTimer();
  }

  // =============================
  // Events
  // =============================
  const revalidate = () => refreshStartButton();

  [firstName, lastName, cedula, university, career, semester, acceptPolicy]
    .forEach((el) => el?.addEventListener("input", revalidate));

  // ✅ Si existen en tu HTML, también revalidan sin romper nada
  [email, phone, github, linkedin].forEach((el) => el?.addEventListener("input", revalidate));

  cvFile?.addEventListener("change", revalidate);

  roleSelect?.addEventListener("change", async () => {
    const pid = roleSelect.value.trim();
    state.activePositionId = pid;
    await preloadEvalForPosition(pid);
    refreshStartButton();
  });

  btnStart?.addEventListener("click", (e) => {
    e.preventDefault();
    openModalInfo();
  });

  btnAcceptStart?.addEventListener("click", () => {
    closeModalInfo();
    beginExam();
  });

  btnCancelStart?.addEventListener("click", closeModalInfo);
  modalInfoClose?.addEventListener("click", closeModalInfo);

  btnNext?.addEventListener("click", (e) => {
    e.preventDefault();
    saveCurrentAnswer();

    if (currentIndex < state.questions.length - 1) {
      currentIndex += 1;
      renderQuestion();
      return;
    }

    // ✅ finishExam ahora es async
    finishExam().catch(() => {});
  });

  qAnswerEl?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") btnNext.click();
  });

  modalDoneClose?.addEventListener("click", closeModalDone);
  btnDoneOk?.addEventListener("click", closeModalDone);

  // =============================
  // Init
  // =============================
  document.addEventListener("DOMContentLoaded", async () => {
    hide(examCard);
    show(form);

    hide(btnStart);
    btnStart.disabled = true;

    await loadPositions();
    refreshStartButton();
  });
})();