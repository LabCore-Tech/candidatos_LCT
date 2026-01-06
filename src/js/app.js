/* LabCore - Evaluación de ingreso (front)
   - Carga cargos (positions)
   - Precarga evaluación (questions) por cargo
   - Habilita "Iniciar prueba" SOLO cuando el formulario es válido + hay preguntas
   - Step 1: Datos del postulante
   - Step 2: Solo pregunta + textarea de respuesta (responsive)
*/

(() => {
  // =============================
  // Config
  // =============================
  const API_BASE = "https://protrack-49um.onrender.com";

  const ENDPOINT_POSITIONS = `${API_BASE}/api/gh/public/positions`;
  const ENDPOINT_EVAL = `${API_BASE}/api/gh/public/eval`; // ?position_id=xxx
  const ENDPOINT_SUBMIT = `${API_BASE}/api/gh/public/submit`;

  // ✅ API KEY (public eval) - NO LO TOQUES
  const metaKey =
    document.querySelector('meta[name="public-eval-api-key"]')?.content?.trim() || "";
  const PUBLIC_KEY = String(window.PUBLIC_EVAL_API_KEY || metaKey || "").trim();

  // =============================
  // DOM
  // =============================
  const form = document.getElementById("candidateForm");
  const examCard = document.getElementById("examCard");

  const uiMsg = document.getElementById("serviceInfo");
  const formError = document.getElementById("formError");
  const examError = document.getElementById("examError");

  const firstName = document.getElementById("firstName");
  const lastName = document.getElementById("lastName");
  const cedula = document.getElementById("cedula");
  const roleSelect = document.getElementById("role");
  const email = document.getElementById("email");
  const phone = document.getElementById("phone");
  const github = document.getElementById("github");
  const linkedin = document.getElementById("linkedin");
  const university = document.getElementById("university");
  const career = document.getElementById("career");
  const semester = document.getElementById("semester");
  const acceptPolicy = document.getElementById("acceptPolicy");

  const cvFile = document.getElementById("cvFile");
  const cvPicker = document.getElementById("cvPicker");

  const btnStart = document.getElementById("btnStart");
  const btnContinue = document.getElementById("btnContinue");

  const questionHost = document.getElementById("questionHost");

  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const btnSubmit = document.getElementById("btnSubmit");

  const incidentsEl = document.getElementById("incidents");

  const timerBox = document.getElementById("timerBox");
  const timerEl = document.getElementById("timer");
  const timeHint = document.getElementById("timeHint");

  const modalInfo = document.getElementById("modalInfo");
  const modalResult = document.getElementById("modalResult");
  const mrMsg = document.getElementById("mrMsg");

  // =============================
  // Helpers UI
  // =============================
  const hide = (el) => el && el.classList.add("hidden");
  const show = (el) => el && el.classList.remove("hidden");
  const isHidden = (el) => !el || el.classList.contains("hidden") || el.classList.contains("is-hidden");

  const setMsg = (el, msg) => {
    if (!el) return;
    if (!msg) {
      el.textContent = "";
      hide(el);
      return;
    }
    el.textContent = msg;
    show(el);
  };

  function openModal(el) {
    if (!el) return;
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
  }
  function closeModal(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
  }

  // close modals by backdrop/buttons
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t?.dataset?.close === "1") {
      closeModal(modalInfo);
      closeModal(modalResult);
    }
  });

  // =============================
  // Normalizers (✅ FIX submit 500 por +57)
  // =============================
  const _digits = (v) => String(v || "").replace(/\D+/g, "");
  function normalizePhone10(raw) {
    let d = _digits(raw);
    // Colombia: allow +57 / 57 prefix
    if (d.length === 12 && d.startsWith("57")) d = d.slice(2);
    // keep last 10 digits if longer
    if (d.length > 10) d = d.slice(-10);
    return d;
  }

  // =============================
  // Networking
  // =============================
  function headers(extra = {}) {
    const h = {
      Accept: "application/json",
      ...extra,
    };
    if (PUBLIC_KEY) h["X-API-Key"] = PUBLIC_KEY; // ✅ FIX 401
    return h;
  }

  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: headers(opts.headers || {}),
    });

    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

    if (!res.ok) {
      const msg = (body && body.error) ? body.error : (typeof body === "string" ? body : `HTTP ${res.status}`);
      const err = new Error(msg);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  async function wakeRender() {
    // ping simple al root para "despertar" render si está dormido
    try {
      await fetch(API_BASE, { method: "GET" });
    } catch (_) {}
  }

  async function withRetry(fn, tries = 7, delayMs = 900) {
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw last;
  }

  // =============================
  // CV picker UX
  // =============================
  function updateCvPickerLabel() {
    if (!cvPicker) return;
    const f = cvFile?.files?.[0];
    if (!f) {
      cvPicker.textContent = "Haz clic para adjuntar tu PDF";
      return;
    }
    cvPicker.textContent = `PDF: ${f.name}`;
  }

  function bindCvPicker() {
    if (!cvPicker || !cvFile) return;
    cvPicker.addEventListener("click", () => cvFile.click());
    cvPicker.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        cvFile.click();
      }
    });
    cvFile.addEventListener("change", () => {
      updateCvPickerLabel();
      refreshStartButton();
    });
  }

  // =============================
  // Form validity
  // =============================
  function isEmailOk(v) {
    const s = String(v || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function isUrlOk(v) {
    const s = String(v || "").trim();
    if (!s) return true;
    try {
      new URL(s);
      return true;
    } catch (_) {
      return false;
    }
  }

  function isFormOk() {
    if (!firstName?.value.trim()) return false;
    if (!lastName?.value.trim()) return false;

    const cc = _digits(cedula?.value || "");
    if (!cc) return false;

    if (!roleSelect?.value) return false;

    if (!isEmailOk(email?.value)) return false;

    if (!phone?.value.trim()) return false;
    const phone10 = normalizePhone10(phone.value);
    if (phone10.length !== 10) return false; // ✅ FIX: no deja mandar +57

    if (!github?.value.trim() || !isUrlOk(github.value)) return false;
    if (!isUrlOk(linkedin?.value)) return false;

    if (!university?.value.trim()) return false;
    if (!career?.value.trim()) return false;
    if (!semester?.value.trim()) return false;

    if (!acceptPolicy?.checked) return false;

    const f = cvFile?.files?.[0];
    if (!f) return false;
    if (f.type !== "application/pdf") return false;
    if (f.size > 8 * 1024 * 1024) return false;

    return true;
  }

  function refreshStartButton() {
    if (!btnStart) return;
    btnStart.disabled = true;

    // Debe haber cargos reales
    const optCount = roleSelect?.querySelectorAll("option")?.length || 0;
    if (optCount <= 1) return;

    // Debe cumplir el form
    if (!isFormOk()) return;

    btnStart.disabled = false;
  }

  [
    firstName, lastName, cedula, roleSelect, email, phone, github, linkedin,
    university, career, semester, acceptPolicy
  ].forEach((el) => el && el.addEventListener("input", refreshStartButton));
  roleSelect && roleSelect.addEventListener("change", refreshStartButton);
  acceptPolicy && acceptPolicy.addEventListener("change", refreshStartButton);

  // =============================
  // Load positions (✅ FIX 401)
  // =============================
  async function loadPositions() {
    // deja placeholder
    roleSelect.innerHTML = `<option value="" selected>Cargando...</option>`;
    const data = await fetchJson(ENDPOINT_POSITIONS, { method: "GET" });

    const items = Array.isArray(data) ? data : (data?.items || []);
    roleSelect.innerHTML = `<option value="">Selecciona un cargo</option>`;

    for (const it of items) {
      const id = it.id || it.position_id || it.value || "";
      const name = it.name || it.title || it.label || id;
      if (!id) continue;
      const op = document.createElement("option");
      op.value = id;
      op.textContent = name;
      roleSelect.appendChild(op);
    }
  }

  // =============================
  // Exam runtime
  // =============================
  const EXAM_MINUTES = 10;
  const WARN_AT_SECONDS = 180; // 3 minutos

  let exam = {
    startedAt: null,
    endsAt: null,
    timerId: null,
    timeLeft: EXAM_MINUTES * 60,
    incidents: 0,
    positionId: null,

    questions: [],
    qIndex: 0,

    // respuestas
    answers: {}, // { qid: "texto" }
  };

  function setIncidents(n) {
    exam.incidents = n;
    if (incidentsEl) incidentsEl.textContent = String(n);
  }

  function tickTimer() {
    const now = Date.now();
    const left = Math.max(0, Math.floor((exam.endsAt - now) / 1000));
    exam.timeLeft = left;

    const mm = String(Math.floor(left / 60)).padStart(2, "0");
    const ss = String(left % 60).padStart(2, "0");
    if (timerEl) timerEl.textContent = `${mm}:${ss}`;

    // estilo warning/danger
    const timerBoxInner = timerEl?.closest(".timer");
    if (timerBoxInner) {
      timerBoxInner.classList.remove("is-warn", "is-danger");
      if (left <= WARN_AT_SECONDS && left > 30) timerBoxInner.classList.add("is-warn");
      if (left <= 30) timerBoxInner.classList.add("is-danger");
    }

    if (timeHint) {
      timeHint.classList.remove("hidden", "is-danger");
      if (left <= WARN_AT_SECONDS && left > 30) {
        timeHint.textContent = "Quedan 3 minutos. Finaliza tus respuestas.";
        show(timeHint);
      } else if (left <= 30 && left > 0) {
        timeHint.textContent = "Últimos segundos…";
        timeHint.classList.add("is-danger");
        show(timeHint);
      } else {
        hide(timeHint);
      }
    }

    if (left <= 0) {
      stopTimer();
      finishExam(true);
    }
  }

  function startTimer() {
    exam.startedAt = Date.now();
    exam.endsAt = exam.startedAt + EXAM_MINUTES * 60 * 1000;
    if (timerBox) show(timerBox);
    tickTimer();
    exam.timerId = setInterval(tickTimer, 1000);
  }

  function stopTimer() {
    if (exam.timerId) clearInterval(exam.timerId);
    exam.timerId = null;
  }

  // =============================
  // Questions + Modules (ya lo tienes)
  // =============================
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pickOnePerModule(questions) {
    // Agrupa por module
    const byMod = new Map();
    for (const q of questions) {
      const mod = q.module || q.category || q.section || "General";
      if (!byMod.has(mod)) byMod.set(mod, []);
      byMod.get(mod).push(q);
    }
    // Escoge 1 por módulo
    const picked = [];
    for (const [_, list] of byMod.entries()) {
      const sel = list[Math.floor(Math.random() * list.length)];
      picked.push(sel);
    }
    return shuffle(picked);
  }

  async function loadEval(positionId) {
    exam.positionId = positionId;

    const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;
    const data = await fetchJson(url, { method: "GET" });

    const all = Array.isArray(data) ? data : (data?.questions || []);
    if (!all.length) throw new Error("No hay preguntas configuradas para este cargo.");

    // ✅ tu lógica: 1 por módulo (8 módulos => 8 preguntas)
    const picked = pickOnePerModule(all);

    exam.questions = picked;
    exam.qIndex = 0;
    exam.answers = {};

    return picked;
  }

  function getCurrentQ() {
    return exam.questions[exam.qIndex] || null;
  }

  function renderQuestion() {
    const q = getCurrentQ();
    if (!q) return;

    const qid = q.id || q.qid || `${exam.qIndex + 1}`;
    const text = q.text || q.question || q.prompt || "";

    questionHost.innerHTML = `
      <div class="question">
        <div class="question__text">${exam.qIndex + 1} de ${exam.questions.length}. ${escapeHtml(text)}</div>
        <textarea id="answerBox" class="input textarea" placeholder="Escribe tu respuesta aquí..."></textarea>
      </div>
    `;

    const answerBox = document.getElementById("answerBox");
    answerBox.value = exam.answers[qid] || "";

    answerBox.addEventListener("input", () => {
      exam.answers[qid] = answerBox.value;
      updateNavButtons();
    });

    // bloquear copy/paste
    ["copy", "cut", "paste"].forEach((evt) => {
      answerBox.addEventListener(evt, (e) => {
        e.preventDefault();
        setIncidents(exam.incidents + 1);
      });
    });

    updateNavButtons();
  }

  function updateNavButtons() {
    const q = getCurrentQ();
    if (!q) return;

    const qid = q.id || q.qid || `${exam.qIndex + 1}`;
    const ans = String(exam.answers[qid] || "").trim();

    // ✅ No permitir avanzar si no hay respuesta válida
    const isValidAnswer = validateAnswer(ans);

    // prev visible si index > 0
    if (btnPrev) {
      if (exam.qIndex > 0) show(btnPrev);
      else hide(btnPrev);
      btnPrev.disabled = exam.qIndex <= 0;
    }

    // si no es la última pregunta => next
    if (btnNext) {
      if (exam.qIndex < exam.questions.length - 1) {
        show(btnNext);
        btnNext.disabled = !isValidAnswer;
      } else {
        hide(btnNext);
      }
    }

    // submit solo en la última
    if (btnSubmit) {
      if (exam.qIndex === exam.questions.length - 1) {
        show(btnSubmit);
        btnSubmit.disabled = !isValidAnswer;
      } else {
        hide(btnSubmit);
      }
    }
  }

  function validateAnswer(ans) {
    // no permitir "." "..." "...." etc
    if (!ans) return false;
    const onlyDots = ans.replace(/\./g, "").trim() === "";
    if (onlyDots) return false;
    if (ans.length < 5) return false; // mínimo razonable
    return true;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // =============================
  // Submit
  // =============================
  async function toBase64(file) {
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function finishExam(byTimeout = false) {
    setMsg(examError, "");

    // valida todas respuestas antes de enviar
    for (let i = 0; i < exam.questions.length; i++) {
      const q = exam.questions[i];
      const qid = q.id || q.qid || `${i + 1}`;
      const ans = String(exam.answers[qid] || "").trim();
      if (!validateAnswer(ans)) {
        exam.qIndex = i;
        renderQuestion();
        setMsg(examError, "Debes responder la pregunta antes de continuar.");
        return;
      }
    }

    const f = cvFile?.files?.[0];
    const cv_b64 = f ? await toBase64(f) : "";

    const payload = {
      position_id: exam.positionId,
      by_timeout: !!byTimeout,
      incidents: exam.incidents,
      started_at: exam.startedAt,
      ended_at: Date.now(),
      time_seconds: EXAM_MINUTES * 60 - exam.timeLeft,

      candidate: {
        firstName: firstName.value.trim(),
        lastName: lastName.value.trim(),
        cedula: _digits(cedula.value),
        email: email.value.trim(),
        phone: normalizePhone10(phone.value), // ✅ FIX +57 => 10 dígitos
        github: github.value.trim(),
        linkedin: linkedin.value.trim(),
        university: university.value.trim(),
        career: career.value.trim(),
        semester: semester.value.trim(),
      },

      hv: {
        filename: f?.name || "",
        content_type: f?.type || "",
        size: f?.size || 0,
        base64: cv_b64 || "",
      },

      answers: exam.questions.map((q, idx) => {
        const qid = q.id || q.qid || `${idx + 1}`;
        return {
          id: qid,
          text: q.text || q.question || q.prompt || "",
          module: q.module || q.category || q.section || "",
          answer: String(exam.answers[qid] || ""),
        };
      }),
    };

    try {
      btnSubmit && (btnSubmit.disabled = true);

      await fetchJson(ENDPOINT_SUBMIT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      mrMsg.textContent = "Evaluación enviada correctamente. Gracias.";
      openModal(modalResult);

      // reset
      stopTimer();
      hide(examCard);
      show(form);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setMsg(examError, e?.message || "Error guardando en BD");
    } finally {
      btnSubmit && (btnSubmit.disabled = false);
    }
  }

  // =============================
  // Events
  // =============================
  btnPrev && btnPrev.addEventListener("click", () => {
    if (exam.qIndex <= 0) return;
    exam.qIndex -= 1;
    renderQuestion();
  });

  btnNext && btnNext.addEventListener("click", () => {
    const q = getCurrentQ();
    if (!q) return;

    const qid = q.id || q.qid || `${exam.qIndex + 1}`;
    const ans = String(exam.answers[qid] || "").trim();
    if (!validateAnswer(ans)) {
      setMsg(examError, "Debes responder antes de continuar.");
      return;
    }

    if (exam.qIndex < exam.questions.length - 1) {
      exam.qIndex += 1;
      renderQuestion();
    }
  });

  btnSubmit && btnSubmit.addEventListener("click", () => finishExam(false));

  btnStart && btnStart.addEventListener("click", () => {
    setMsg(formError, "");
    openModal(modalInfo);
  });

  btnContinue && btnContinue.addEventListener("click", async () => {
    closeModal(modalInfo);

    // seguridad extra
    if (!isFormOk()) {
      setMsg(formError, "Completa todos los campos obligatorios antes de iniciar.");
      refreshStartButton();
      return;
    }

    try {
      setMsg(formError, "");
      setMsg(uiMsg, "");

      // carga evaluación
      await loadEval(roleSelect.value);

      // ir a examen
      hide(form);
      show(examCard);

      // reset incidents
      setIncidents(0);

      // timer
      startTimer();

      // primera pregunta
      renderQuestion();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setMsg(formError, e?.message || "No fue posible iniciar la evaluación.");
      show(form);
      hide(examCard);
    }
  });

  // =============================
  // Init
  // =============================
  document.addEventListener("DOMContentLoaded", async () => {
    hide(examCard);
    show(form);

    show(btnStart);
    btnStart.disabled = true;

    bindCvPicker();
    updateCvPickerLabel();

    // ✅ Cargar cargos con reintentos (por si Render está dormido)
    try {
      setMsg(uiMsg, "Cargando cargos...");
      await wakeRender();

      await withRetry(async () => {
        await loadPositions();
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
