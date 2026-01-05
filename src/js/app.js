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