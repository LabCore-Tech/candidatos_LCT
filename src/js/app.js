/* =========================================================
   LabCore - Evaluación de ingreso (GitHub Pages)
   ========================================================= */

const API_BASE = "https://protrack-49um.onrender.com";
const API_KEY = "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

const form = document.getElementById("candidateForm");
const positionSelect = document.getElementById("position");

const modalConfirm = document.getElementById("modalConfirm");
const modalOk = document.getElementById("modalOk");

const closeModal = document.getElementById("closeModal");
const continueBtn = document.getElementById("continueBtn");
const okBtn = document.getElementById("okBtn");

const cvFile = document.getElementById("cvFile");
const cvFake = document.getElementById("cvFake");

/* ---------- PDF ---------- */
cvFake.addEventListener("click", () => cvFile.click());
cvFile.addEventListener("change", () => {
  cvFake.value = cvFile.files[0]?.name || "";
});

/* ---------- CARGAR CARGOS ---------- */
async function loadPositions() {
  try {
    const res = await fetch(`${API_BASE}/api/gh/public/positions`, {
      headers: { "X-API-Key": API_KEY }
    });

    if (!res.ok) throw new Error("No autorizado");

    const data = await res.json();

    positionSelect.innerHTML = `<option value="">Selecciona un cargo</option>`;
    data.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      positionSelect.appendChild(opt);
    });

  } catch (e) {
    positionSelect.innerHTML =
      `<option value="">No hay cargos disponibles</option>`;
  }
}

/* ---------- FORM ---------- */
form.addEventListener("submit", e => {
  e.preventDefault();
  modalConfirm.classList.remove("hidden");
});

closeModal.addEventListener("click", () =>
  modalConfirm.classList.add("hidden")
);

continueBtn.addEventListener("click", async () => {
  modalConfirm.classList.add("hidden");

  // aquí iría el POST real
  modalOk.classList.remove("hidden");
});

okBtn.addEventListener("click", () =>
  modalOk.classList.add("hidden")
);

/* ---------- INIT ---------- */
loadPositions();
