const state = {
  machines: [],
  dirty: false,
};

const DB_NAME = "gym-tracker";
const STORE_NAME = "state";
const SAVE_KEY = "app";
const AUTOSAVE_MS = 30000;

const groupSelect = document.getElementById("groupSelect");
const machineList = document.getElementById("machineList");
const addMachineButton = document.getElementById("addMachine");
const autosaveStatus = document.getElementById("autosaveStatus");
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");
const connectDrive = document.getElementById("connectDrive");
const disconnectDrive = document.getElementById("disconnectDrive");
const driveStatus = document.getElementById("driveStatus");
const chartDialog = document.getElementById("chartDialog");
const chartCanvas = document.getElementById("chartCanvas");
const chartTitle = document.getElementById("chartTitle");
const closeChart = document.getElementById("closeChart");

const machineTemplate = document.getElementById("machineTemplate");
const sessionTemplate = document.getElementById("sessionTemplate");
const setTemplate = document.getElementById("setTemplate");

const formatDate = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
}).format;

const formatTime = new Intl.DateTimeFormat("en-GB", {
  timeStyle: "short",
}).format;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadState() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(SAVE_KEY);
    const saved = await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (saved && saved.machines) {
      state.machines = saved.machines;
    }
  } catch (error) {
    console.warn("Failed to load saved state", error);
  }
}

async function saveState() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ machines: state.machines }, SAVE_KEY);
    await new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    state.dirty = false;
    autosaveStatus.textContent = `Saved ${formatTime(new Date())}`;
  } catch (error) {
    console.warn("Failed to save state", error);
    autosaveStatus.textContent = "Save failed";
  }
}

function scheduleSave() {
  state.dirty = true;
  autosaveStatus.textContent = "Pending save";
}

function startAutosave() {
  setInterval(() => {
    if (state.dirty) {
      saveState();
    }
  }, AUTOSAVE_MS);
}

function uid() {
  return crypto.randomUUID();
}

function getGroupLabel(group) {
  const labels = {
    legs: "Legs",
    chest: "Chest",
    shoulders: "Shoulders",
    back: "Back",
    arms: "Arms",
    abs: "Abs",
  };
  return labels[group] || group;
}

function renderMachines() {
  machineList.innerHTML = "";
  const currentGroup = groupSelect.value;
  const machines = state.machines.filter((machine) => machine.group === currentGroup);

  if (machines.length === 0) {
    const empty = document.createElement("div");
    empty.className = "machine";
    empty.innerHTML = "<p>No machines yet. Add one to start tracking.</p>";
    machineList.appendChild(empty);
    return;
  }

  machines.forEach((machine) => {
    const element = createMachineElement(machine);
    machineList.appendChild(element);
  });
}

function createMachineElement(machine) {
  const node = machineTemplate.content.cloneNode(true);
  const article = node.querySelector(".machine");
  const name = node.querySelector(".machine-name");
  const group = node.querySelector(".machine-group");
  const titleInput = node.querySelector(".machine-title");
  const photo = node.querySelector(".machine-photo");
  const fileInput = node.querySelector(".file-upload input");
  const addSessionButton = node.querySelector(".add-session");
  const sessionList = node.querySelector(".session-list");
  const removeButton = node.querySelector(".remove-machine");
  const chartButton = node.querySelector(".open-chart");

  article.dataset.id = machine.id;
  name.textContent = machine.name || "Unnamed machine";
  group.textContent = getGroupLabel(machine.group);
  titleInput.value = machine.name || "";
  photo.src = machine.photo || "";
  photo.style.display = machine.photo ? "block" : "none";

  titleInput.addEventListener("input", (event) => {
    machine.name = event.target.value.trim();
    name.textContent = machine.name || "Unnamed machine";
    scheduleSave();
  });

  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      machine.photo = reader.result;
      photo.src = machine.photo;
      photo.style.display = "block";
      scheduleSave();
    };
    reader.readAsDataURL(file);
  });

  addSessionButton.addEventListener("click", () => {
    addSession(machine);
    renderMachines();
    scheduleSave();
  });

  removeButton.addEventListener("click", () => {
    state.machines = state.machines.filter((item) => item.id !== machine.id);
    renderMachines();
    scheduleSave();
  });

  chartButton.addEventListener("click", () => {
    openChart(machine);
  });

  machine.sessions.forEach((session) => {
    const sessionElement = createSessionElement(machine, session);
    sessionList.appendChild(sessionElement);
  });

  return node;
}

function createSessionElement(machine, session) {
  const node = sessionTemplate.content.cloneNode(true);
  const sessionElement = node.querySelector(".session");
  const date = node.querySelector(".session-date");
  const addSetButton = node.querySelector(".add-set");
  const removeSessionButton = node.querySelector(".remove-session");
  const setList = node.querySelector(".set-list");

  sessionElement.dataset.sessionId = session.id;
  date.textContent = formatDate(new Date(session.date));

  addSetButton.addEventListener("click", () => {
    session.sets.push({ id: uid(), reps: 0 });
    renderMachines();
    scheduleSave();
  });

  removeSessionButton.addEventListener("click", () => {
    machine.sessions = machine.sessions.filter((item) => item.id !== session.id);
    renderMachines();
    scheduleSave();
  });

  session.sets.forEach((set, index) => {
    const setElement = createSetElement(machine, session, set, index);
    setList.appendChild(setElement);
  });

  return node;
}

function createSetElement(machine, session, set, index) {
  const node = setTemplate.content.cloneNode(true);
  const row = node.querySelector(".set-row");
  const label = node.querySelector(".set-index");
  const repsInput = node.querySelector(".set-reps");
  const removeSetButton = node.querySelector(".remove-set");

  row.dataset.setId = set.id;
  label.textContent = `#${index + 1}`;
  repsInput.value = set.reps ?? 0;

  repsInput.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    set.reps = Number.isNaN(value) ? 0 : value;
    scheduleSave();
  });

  removeSetButton.addEventListener("click", () => {
    session.sets = session.sets.filter((item) => item.id !== set.id);
    renderMachines();
    scheduleSave();
  });

  return node;
}

function addMachine() {
  const machine = {
    id: uid(),
    group: groupSelect.value,
    name: "",
    photo: "",
    sessions: [],
  };
  state.machines.unshift(machine);
  renderMachines();
  scheduleSave();
}

function addSession(machine) {
  machine.sessions.unshift({
    id: uid(),
    date: new Date().toISOString(),
    sets: [{ id: uid(), reps: 0 }],
  });
}

function openChart(machine) {
  chartTitle.textContent = `${machine.name || "Unnamed machine"} progress`;
  drawChart(machine.sessions);
  chartDialog.showModal();
}

function drawChart(sessions) {
  const ctx = chartCanvas.getContext("2d");
  ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);

  const padding = 40;
  const width = chartCanvas.width - padding * 2;
  const height = chartCanvas.height - padding * 2;
  const totals = sessions
    .slice()
    .reverse()
    .map((session) => session.sets.reduce((sum, set) => sum + (set.reps || 0), 0));

  if (totals.length === 0) {
    ctx.fillStyle = "#8e8c96";
    ctx.font = "16px Space Grotesk";
    ctx.fillText("No sessions yet", padding, padding + 20);
    return;
  }

  const max = Math.max(...totals, 1);

  ctx.strokeStyle = "#2c2a35";
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, padding + height);
  ctx.lineTo(padding + width, padding + height);
  ctx.stroke();

  ctx.strokeStyle = "#42f5b3";
  ctx.lineWidth = 2;
  ctx.beginPath();
  totals.forEach((value, index) => {
    const x = padding + (width / Math.max(totals.length - 1, 1)) * index;
    const y = padding + height - (value / max) * height;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

function setupTabs() {
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((item) => item.classList.remove("is-active"));
      panels.forEach((panel) => panel.classList.remove("is-active"));
      tab.classList.add("is-active");
      document.getElementById(tab.dataset.tab).classList.add("is-active");
    });
  });
}

function setupSettings() {
  connectDrive.addEventListener("click", () => {
    driveStatus.textContent = "Google Drive connection not configured";
  });
  disconnectDrive.addEventListener("click", () => {
    driveStatus.textContent = "Not connected";
  });
}

function setupChart() {
  closeChart.addEventListener("click", () => chartDialog.close());
}

async function init() {
  await loadState();
  setupTabs();
  setupSettings();
  setupChart();
  groupSelect.addEventListener("change", renderMachines);
  addMachineButton.addEventListener("click", addMachine);
  renderMachines();
  startAutosave();
  autosaveStatus.textContent = "Autosave running";
}

init();
