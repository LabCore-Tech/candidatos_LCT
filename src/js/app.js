/* LabCore - Evaluación de ingreso (front)
   Flujo limpio y estable
*/

// 🔐 API KEY pública
window.PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

(() => {
  const API_BASE = "https://protrack-49um.onrender.com";
  const ENDPOINT_POSITIONS = `${API_BASE}/api/gh/public/positions`;
  const ENDPOINT_EVAL = `${API_BASE}/api/gh/public/eval`;
  const ENDPOINT_SUBMIT = `${API_BASE}/api/gh/public/submit`;

  const $ = (id) => document.getElementById(id);

  // ===== DOM =====
  const form = $("candidateForm");
  const examCard = $("examCard");

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

  const cvFile = $("cvFile");
  const cvPicker = $("cvPicker");
  const acceptPolicy = $("acceptPolicy");

  const btnStart = $("btnStart");
  const btnNext = $("btnNext");

  const qText = $("qText");
  const qAnswer = $("qAnswer");
  const timerEl = $("timer");

  const modalInfo = $("modalInfo");
  const btnContinue = $("btnContinue");

  const formError = $("formError");
  const examError = $("examError");

  // ===== STATE =====
  const state = {
    questions: [],
    answers: [],
    index: 0,
    remaining: 600,
    timer: null,
  };

  // ===== Utils =====
  const show = (el) => el && el.classList.remove("hidden", "is-hidden");
  const hide = (el) => el && el.classList.add("hidden");

  const headers = () => ({
    Accept: "application/json",
    "X-Api-Key": window.PUBLIC_EVAL_API_KEY,
  });

  // ===== Validación =====
  function isFormOk() {
    return (
      firstName.value &&
      lastName.value &&
      cedula.value &&
      email.value &&
      phone.value &&
      github.value &&
      university.value &&
      roleSelect.value &&
      cvFile.files.length > 0 &&
      acceptPolicy.checked
    );
  }

  function refreshStartButton() {
    btnStart.disabled = !isFormOk();
  }

  // ===== Cargar cargos =====
  async function loadPositions() {
    const res = await fetch(ENDPOINT_POSITIONS, { headers: headers() });
    const data = await res.json();

    roleSelect.innerHTML = `<option value="">Selecciona un cargo</option>`;
    data.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id || p.position_id;
      opt.textContent = p.name || p.position_name;
      roleSelect.appendChild(opt);
    });
  }

  // ===== Popup =====
  function openModal() {
    show(modalInfo);
    modalInfo.classList.add("open");
  }

  function closeModal() {
    modalInfo.classList.remove("open");
    hide(modalInfo);
  }

  // ===== Evaluación =====
  async function startExam() {
    closeModal();

    hide(form);
    show(examCard);

    const pid = roleSelect.value;
    const res = await fetch(`${ENDPOINT_EVAL}?position_id=${pid}`, {
      headers: headers(),
    });
    const data = await res.json();

    state.questions = data.questions || [];
    state.answers = new Array(state.questions.length).fill("");
    state.index = 0;
    state.remaining = 600;

    renderQuestion();
    startTimer();
  }

  function renderQuestion() {
    const q = state.questions[state.index];
    if (!q) return;

    qText.textContent = `${state.index + 1}. ${q.prompt || q.text}`;
    qAnswer.value = state.answers[state.index];
    btnNext.textContent =
      state.index === state.questions.length - 1
        ? "Enviar evaluación"
        : "Siguiente";
  }

  function startTimer() {
    timerEl.textContent = "10:00";
    state.timer = setInterval(() => {
      state.remaining--;
      const m = String(Math.floor(state.remaining / 60)).padStart(2, "0");
      const s = String(state.remaining % 60).padStart(2, "0");
      timerEl.textContent = `${m}:${s}`;
      if (state.remaining <= 0) finishExam();
    }, 1000);
  }

  async function finishExam() {
    clearInterval(state.timer);
    alert("Evaluación enviada");
  }

  // ===== Events =====
  [
    firstName,
    lastName,
    cedula,
    email,
    phone,
    github,
    linkedin,
    university,
    career,
    semester,
  ].forEach((el) => el?.addEventListener("input", refreshStartButton));

  acceptPolicy.addEventListener("change", refreshStartButton);

  cvPicker.addEventListener("click", () => cvFile.click());
  cvFile.addEventListener("change", refreshStartButton);

  btnStart.addEventListener("click", (e) => {
    e.preventDefault();
    openModal();
  });

  btnContinue.addEventListener("click", startExam);

  btnNext.addEventListener("click", () => {
    state.answers[state.index] = qAnswer.value;
    if (state.index < state.questions.length - 1) {
      state.index++;
      renderQuestion();
    } else {
      finishExam();
    }
  });

  // ===== Init =====
  document.addEventListener("DOMContentLoaded", async () => {
    hide(examCard);
    btnStart.disabled = true;
    await loadPositions();
  });
})();

    if (!email.value.trim()) return false;
    if (!phone.value.trim()) return false;
    if (!github.value.trim()) return false;

    // ✅ VALIDACIÓN REAL DEL CV
    if (!cvFile || cvFile.files.length === 0) return false;

    if (!university.value.trim()) return false;
    if (!acceptPolicy.checked) return false;

    return true;
  }


  function refreshStartButton() {
    if (!btnStart) return;

    // 🔒 El botón SIEMPRE visible
    show(btnStart);

    if (isFormOk()) {
      btnStart.disabled = false;
      setMsg(formError, "");
    } else {
      btnStart.disabled = true;
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
    ensureQuestionUI();
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

  function openModalInfo() {
    if (!modalInfo) return;
    modalInfo.classList.remove("hidden");
    modalInfo.classList.remove("is-hidden");
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
    modalDone.classList.remove("hidden");
    modalDone.classList.remove("is-hidden");
    modalDone.classList.add("open");
  }

  function closeModalDone() {
    if (!modalDone) return;
    modalDone.classList.remove("open");
    modalDone.classList.add("hidden");
  }

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

  [firstName, lastName, cedula, university, career, semester]
    .forEach((el) => el?.addEventListener("input", revalidate));

  [email, phone, github, linkedin]
    .forEach((el) => el?.addEventListener("input", revalidate));

  // ✅ checkbox debe ser change
  acceptPolicy?.addEventListener("change", revalidate);

  // ===== CV picker (click en el campo abre selector y muestra nombre) =====
  function updateCvPickerLabel() {
    if (!cvPicker) return;
    const f = cvFile?.files?.[0];
    const label = f ? f.name : "Haz clic para adjuntar tu PDF";

    // cvPicker en tu HTML es BUTTON, así que se actualiza con textContent
    cvPicker.textContent = label;
  }

  cvPicker?.addEventListener("click", () => {
    cvFile?.click();
  });

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
    const pid = roleSelect.value.trim();
    state.activePositionId = pid;
    await preloadEvalForPosition(pid);
    refreshStartButton();
  });


  btnStart?.addEventListener("click", (e) => {
    e.preventDefault();
    openModalInfo();
  });

  btnContinue?.addEventListener("click", () => {
    closeModalInfo();
    beginExam();
  });

  // Cerrar modal info por backdrop o X (ambos tienen data-close="1" en el HTML)
  modalInfo?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalInfo);
  });


  // Navegación del examen
  btnPrev?.addEventListener("click", () => {
    if (!state.examStarted) return;
    saveCurrentAnswer();
    if (state.currentIndex > 0) {
      state.currentIndex -= 1;
      renderQuestion();
    }
  });

  btnNext?.addEventListener("click", () => {
    if (!state.examStarted) return;
    saveCurrentAnswer();
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex += 1;
      renderQuestion();
    }
  });

  btnSubmit?.addEventListener("click", async () => {
    if (!state.examStarted) return;
    saveCurrentAnswer();
    await finishExam();
  });

  // Enter en el textarea NO envía el form
  qAnswerEl?.addEventListener("keydown", (e) => {
    // no-op
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

  // ✅ Botón siempre visible; solo empieza deshabilitado
  show(btnStart);
  btnStart.disabled = true;

  await loadPositions();
  refreshStartButton();
  updateCvPickerLabel();
});

})();