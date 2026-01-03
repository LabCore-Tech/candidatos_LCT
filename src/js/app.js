/* =========================
   LabCore Tech - Evaluación (Repo A)
   Conecta con ProTrack (Repo B) vía endpoints públicos /api/gh/public/*
   ========================= */

// ================= CONFIG =================
const PROTRACK_BASE = "https://protrack-49um.onrender.com"; // backend real (Render)
const PUBLIC_EVAL_API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

const ENDPOINT_POSITIONS = `${PROTRACK_BASE}/api/gh/public/positions`;
const ENDPOINT_EVAL = `${PROTRACK_BASE}/api/gh/public/eval`; // ?position_id=...
const ENDPOINT_SUBMIT = `${PROTRACK_BASE}/api/gh/public/submit`; // POST

const MAX_CV_MB = 8;
const LOCK_KEY = "labcore_eval_lock_v2";
const VIOLATION_LIMIT = 50;

// ================= HELPERS =================
function $(id) {
  return document.getElementById(id);
}

function apiHeaders() {
  return {
    "Content-Type": "application/json",
    "X-API-Key": PUBLIC_EVAL_API_KEY,
  };
}

function setUiMsg(text, type = "info") {
  const el = $("uiMsg");
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("hidden");
  el.classList.toggle("msg-error", type === "error");
  if (!text) el.classList.add("hidden");
}

function showExamError(text) {
  const el = $("examError");
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("hidden");
  if (!text) el.classList.add("hidden");
}

function onlyDigits(v) {
  return String(v || "").replace(/\D+/g, "");
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

function mb(sizeBytes) {
  return sizeBytes / (1024 * 1024);
}

function validateRequired() {
  const firstName = $("firstName")?.value?.trim();
  const lastName = $("lastName")?.value?.trim();
  const idNumber = onlyDigits($("idNumber")?.value);
  const email = $("email")?.value?.trim();
  const phone = $("phone")?.value?.trim();
  const github = $("github")?.value?.trim();
  const position = $("positionSelect")?.value;
  const uni = $("university")?.value?.trim();
  const career = $("career")?.value?.trim();
  const semester = $("semester")?.value?.trim();
  const policy = $("policyCheck")?.checked;

  const cvFile = $("cvFile")?.files?.[0];

  if (!firstName || !lastName || !idNumber || !email || !phone || !github) return false;
  if (!position) return false;
  if (!uni || !career || !semester) return false;
  if (!policy) return false;
  if (!cvFile) return false;

  if (cvFile.type !== "application/pdf") {
    setUiMsg("La hoja de vida debe ser un PDF.", "error");
    return false;
  }
  if (mb(cvFile.size) > MAX_CV_MB) {
    setUiMsg(`El PDF supera el máximo permitido (${MAX_CV_MB} MB).`, "error");
    return false;
  }

  return true;
}

function updateStartBtnState() {
  const btn = $("btnStart");
  if (!btn) return;
  btn.disabled = !validateRequired();
}

// ================= POSITIONS =================
async function loadPositions() {
  const sel = $("positionSelect");
  if (!sel) return;

  sel.innerHTML = `<option value="" selected disabled>Cargando...</option>`;

  try {
    const r = await fetch(ENDPOINT_POSITIONS, {
      method: "GET",
      headers: apiHeaders(),
    });

    const data = await r.json().catch(() => null);

    if (!r.ok || !data) {
      throw new Error((data && data.msg) || `HTTP ${r.status}`);
    }
    if (data.ok === false) {
      throw new Error(data.msg || "unauthorized");
    }

    const positions =
      (Array.isArray(data.positions) && data.positions) ||
      (Array.isArray(data.data) && data.data) ||
      (Array.isArray(data.items) && data.items) ||
      (Array.isArray(data) && data) ||
      [];

    if (!positions.length) {
      sel.innerHTML = `<option value="" selected disabled>No hay cargos disponibles</option>`;
      return;
    }

    const opt = (id, name) =>
      `<option value="${String(id).replace(/"/g, "&quot;")}">${String(name)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</option>`;

    sel.innerHTML =
      `<option value="" selected disabled>Selecciona un cargo...</option>` +
      positions
        .map((p) => {
          if (p && typeof p === "object") {
            const pid = p.id ?? p.position_id ?? p.value ?? p.code ?? p.cargo_id ?? p.name;
            const pname = p.name ?? p.cargo ?? p.title ?? p.label ?? String(pid);
            return opt(pid, pname);
          }
          return opt(p, p);
        })
        .join("");
  } catch (err) {
    console.error("loadPositions error:", err);
    sel.innerHTML = `<option value="" selected disabled>No hay cargos disponibles</option>`;
    showExamError(
      "No se pudieron cargar los cargos. Verifica que el endpoint esté activo y que la API Key sea válida."
    );
  }
}

// ================= EVAL BUILD =================
function pickOnePerModuleFromFlat(flat) {
  // Si el backend te devuelve lista plana, esta función selecciona una por módulo (si viene module_id).
  if (!Array.isArray(flat)) return [];
  const byMod = new Map();
  for (const q of flat) {
    const mid = q.module_id ?? q.module ?? "mod";
    if (!byMod.has(mid)) byMod.set(mid, []);
    byMod.get(mid).push(q);
  }
  const out = [];
  for (const [mid, arr] of byMod.entries()) {
    // Escoge la primera (o random si quieres)
    out.push(arr[0]);
  }
  return out;
}

function renderExamFromJson(json) {
  // Esto debe respetar tu estructura anterior. Aquí NO destruyo tu layout: solo renderiza en #examContainer.
  const container = $("examContainer");
  if (!container) return;

  container.innerHTML = "";

  // Soportar varias formas de payload
  const questions = json?.questions || json?.data?.questions || json?.items || json?.data || [];
  const finalQuestions = Array.isArray(questions) ? questions : [];

  if (!finalQuestions.length) {
    container.innerHTML = `<div class="msg">No se encontraron preguntas para este cargo.</div>`;
    return;
  }

  // Render simple (si tú tienes un render más avanzado, se adapta a tu JSON exacto)
  finalQuestions.forEach((q, idx) => {
    const card = document.createElement("div");
    card.className = "q-card";
    card.style.border = "1px solid rgba(15,23,42,.10)";
    card.style.borderRadius = "16px";
    card.style.padding = "14px 16px";
    card.style.marginBottom = "12px";
    card.style.background = "rgba(248,250,252,.9)";

    const title = document.createElement("div");
    title.style.fontWeight = "900";
    title.style.marginBottom = "8px";
    title.textContent = `${idx + 1}. ${q.title || q.question || "Pregunta"}`;

    const opts = document.createElement("div");
    opts.style.display = "grid";
    opts.style.gap = "8px";

    const answers = q.answers || q.options || q.choices || [];
    (Array.isArray(answers) ? answers : []).forEach((a, j) => {
      const label = document.createElement("label");
      label.style.display = "flex";
      label.style.alignItems = "center";
      label.style.gap = "10px";
      label.style.fontWeight = "650";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = `q_${q.id ?? idx}`;
      input.value = a.id ?? a.value ?? a;
      input.dataset.qid = q.id ?? idx;

      const span = document.createElement("span");
      span.textContent = a.text ?? a.label ?? String(a);

      label.appendChild(input);
      label.appendChild(span);
      opts.appendChild(label);
    });

    card.appendChild(title);
    card.appendChild(opts);
    container.appendChild(card);
  });
}

// ================= MODAL / FLOW =================
function openPreStart() {
  $("preStartBackdrop")?.classList.remove("hidden");
}

function closePreStart() {
  $("preStartBackdrop")?.classList.add("hidden");
}

function showExam() {
  $("examSection")?.classList.remove("hidden");
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", async () => {
  setUiMsg("", "info");
  showExamError("");

  // Validaciones en vivo
  ["firstName", "lastName", "idNumber", "email", "phone", "github", "linkedin", "university", "career", "semester"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      if (id === "idNumber") $("idNumber").value = onlyDigits($("idNumber").value);
      updateStartBtnState();
    });
  });
  $("policyCheck")?.addEventListener("change", updateStartBtnState);
  $("positionSelect")?.addEventListener("change", updateStartBtnState);
  $("cvFile")?.addEventListener("change", updateStartBtnState);

  // Cargar cargos
  await loadPositions();
  
  // CV input (oculto) + campo visual
  const cvFile = $("cvFile");
  const cvDisplay = $("cvDisplay");
  const cvDisplayText = $("cvDisplayText");
  if (cvFile && cvDisplay) {
    cvDisplay.addEventListener("click", () => cvFile.click());
    cvFile.addEventListener("change", () => {
      const f = cvFile.files && cvFile.files[0];
      if (cvDisplayText) cvDisplayText.textContent = f ? f.name : "Haz clic para adjuntar tu PDF";
    });
  }

  updateStartBtnState();

  // Modal
  $("btnStart")?.addEventListener("click", () => {
    setUiMsg("", "info");
    if (!validateRequired()) {
      setUiMsg("Debes completar todos los campos obligatorios.", "error");
      return;
    }
    openPreStart();
  });

  $("btnCloseModal")?.addEventListener("click", closePreStart);

  $("btnContinue")?.addEventListener("click", async () => {
    closePreStart();

    const positionId = $("positionSelect")?.value;
    if (!positionId) return;

    try {
      showExamError("");
      const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;
      const r = await fetch(url, { headers: apiHeaders() });
      const data = await r.json().catch(() => null);

      if (!r.ok || !data) throw new Error(`HTTP ${r.status}`);
      if (data.ok === false) throw new Error(data.msg || "No se pudo cargar evaluación");

      renderExamFromJson(data);
      showExam();
    } catch (e) {
      console.error(e);
      showExamError("No se pudo cargar la evaluación. Revisa el endpoint y el JSON devuelto.");
    }
  });

  // Enviar evaluación (tu lógica real puede ser más completa; aquí dejo el POST funcionando)
  $("btnSubmit")?.addEventListener("click", async () => {
    try {
      const cv = $("cvFile")?.files?.[0];
      if (!cv) {
        showExamError("Adjunta tu hoja de vida antes de enviar.");
        return;
      }

      // Recoger respuestas
      const answers = [];
      document.querySelectorAll('#examContainer input[type="radio"]:checked').forEach((el) => {
        answers.push({
          question_id: el.dataset.qid,
          answer: el.value,
        });
      });

      const payload = {
        first_name: $("firstName")?.value?.trim(),
        last_name: $("lastName")?.value?.trim(),
        id_number: onlyDigits($("idNumber")?.value),
        email: $("email")?.value?.trim(),
        phone: $("phone")?.value?.trim(),
        github: $("github")?.value?.trim(),
        linkedin: $("linkedin")?.value?.trim(),
        university: $("university")?.value?.trim(),
        career: $("career")?.value?.trim(),
        semester: $("semester")?.value?.trim(),
        position_id: $("positionSelect")?.value,
        cv_filename: cv.name,
        cv_base64: await fileToBase64(cv),
        answers,
      };

      const r = await fetch(ENDPOINT_SUBMIT, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => null);

      if (!r.ok || !data) throw new Error(`HTTP ${r.status}`);
      if (data.ok === false) throw new Error(data.msg || "No se pudo enviar");

      showExamError("");
      setUiMsg("✅ Evaluación enviada correctamente.", "info");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      console.error(e);
      showExamError("No se pudo enviar la evaluación. Revisa consola y Network.");
    }
  });
});
