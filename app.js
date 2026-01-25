const state = {
  machines: [],
  dirty: false,
  lastSavedAt: 0,
  lastUpdatedAt: 0,
};

const DRIVE_CLIENT_ID =
  "195858719729-nj667rjf89ldrt9rev3mma4a3hfejva3.apps.googleusercontent.com";
const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_NAME = "GymTracker";
const DRIVE_STATE_KEY = "driveState";
const DRIVE_CONNECTED_KEY = "driveConnected";
const DRIVE_AUTOSYNC_KEY = "driveAutoSync";
const DRIVE_SYNC_MIN_MS = 60000;
const DRIVE_SYNC_DELAY_MS = 60000;
const DRIVE_SYNC_INTERVAL_MS = 30000;

const DB_NAME = "gym-tracker";
const STORE_NAME = "state";
const SAVE_KEY = "app";
const AUTOSAVE_MS = 30000;
const UNDO_TIMEOUT_MS = 8000;
const GROUP_FILTER_KEY = "groupFilter";
const COMPACT_VIEW_KEY = "compactView";

const GROUP_LABELS = {
  legs: "Legs",
  chest: "Chest",
  shoulders: "Shoulders",
  back: "Back",
  abs: "Abs",
  biceps: "Biceps",
  triceps: "Triceps",
};

const GROUP_ORDER = ["legs", "chest", "shoulders", "back", "abs", "biceps", "triceps"];

const GROUP_ALIAS = {
  arms: ["biceps", "triceps"],
};

const groupFilter = document.getElementById("groupFilters");
const groupFilterButtons = Array.from(
  document.querySelectorAll("[data-scope='filter'][data-group]")
);
const groupFilterAliasButtons = Array.from(
  document.querySelectorAll("[data-scope='filter'][data-alias]")
);
const editGroupButtons = Array.from(
  document.querySelectorAll("[data-scope='edit'][data-group]")
);
const editGroupAliasButtons = Array.from(
  document.querySelectorAll("[data-scope='edit'][data-alias]")
);
const machineList = document.getElementById("machineList");
const addMachineButton = document.getElementById("addMachine");
const compactToggle = document.getElementById("compactToggle");
const clearPinsButton = document.getElementById("clearPins");
const autosaveStatus = document.getElementById("autosaveStatus");
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");
const connectDrive = document.getElementById("connectDrive");
const disconnectDrive = document.getElementById("disconnectDrive");
const syncDrive = document.getElementById("syncDrive");
const driveStatus = document.getElementById("driveStatus");
const autoSyncToggle = document.getElementById("autoSync");
const loginGate = document.getElementById("loginGate");
const loginGateConnect = document.getElementById("loginGateConnect");
const loginGateStatus = document.getElementById("loginGateStatus");
const chartDialog = document.getElementById("chartDialog");
const chartCanvas = document.getElementById("chartCanvas");
const chartTitle = document.getElementById("chartTitle");
const closeChart = document.getElementById("closeChart");
const editDialog = document.getElementById("editDialog");
const editNameInput = document.getElementById("editName");
const editPhotoInput = document.getElementById("editPhotoInput");
const editPhotoCameraInput = document.getElementById("editPhotoCameraInput");
const editPhotoPreview = document.getElementById("editPhotoPreview");
const editPhotoPlaceholder = document.getElementById("editPhotoPlaceholder");
const cropPhotoButton = document.getElementById("cropPhoto");
const removePhotoButton = document.getElementById("removePhoto");
const saveEditButton = document.getElementById("saveEdit");
const closeEditButton = document.getElementById("closeEdit");
const undoToast = document.getElementById("undoToast");
const undoMessage = document.getElementById("undoMessage");
const undoAction = document.getElementById("undoAction");
const undoDismiss = document.getElementById("undoDismiss");

const machineTemplate = document.getElementById("machineTemplate");
const sessionTemplate = document.getElementById("sessionTemplate");
const setTemplate = document.getElementById("setTemplate");

const formatDate = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
}).format;

const formatTime = new Intl.DateTimeFormat("en-GB", {
  timeStyle: "short",
}).format;

const formatDateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
}).format;

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getSessionDateKey(session) {
  return formatDateInputValue(new Date(session.date));
}

function getSelectedSession(machine) {
  const pickedDate = uiState.sessionDatePick[machine.id];
  if (pickedDate) {
    return machine.sessions.find((item) => getSessionDateKey(item) === pickedDate) || null;
  }
  const selectedId = uiState.sessionView[machine.id];
  if (selectedId) {
    const match = machine.sessions.find((item) => item.id === selectedId);
    if (match) return match;
  }
  return machine.sessions[0] || null;
}

function getSessionSummary(session) {
  if (!session || !session.sets.length) return "Previous: no sets logged yet";
  let maxWeight = 0;
  let maxUnit = session.sets[0]?.unit || "kg";
  session.sets.forEach((set) => {
    const weight = Number.isFinite(set.weight) ? set.weight : 0;
    if (weight >= maxWeight) {
      maxWeight = weight;
      maxUnit = set.unit || maxUnit;
    }
  });
  const setCount = session.sets.length;
  return `Previous: ${setCount} sets | max ${maxWeight} ${maxUnit}`;
}

function confirmRemoval(message) {
  return window.confirm(message);
}

function clearUndo() {
  undoState.action = null;
  if (undoState.timer) {
    clearTimeout(undoState.timer);
    undoState.timer = null;
  }
  if (undoToast) {
    undoToast.classList.remove("is-visible");
  }
}

function showUndo(message, action) {
  if (!undoToast || !undoMessage) return;
  undoMessage.textContent = message;
  undoState.action = action;
  undoToast.classList.add("is-visible");
  if (undoState.timer) {
    clearTimeout(undoState.timer);
  }
  undoState.timer = setTimeout(() => {
    clearUndo();
  }, UNDO_TIMEOUT_MS);
}

const drive = {
  tokenClient: null,
  accessToken: "",
  tokenExpiry: 0,
  syncing: false,
  lastSync: 0,
  folderId: null,
  fileIds: {
    state: null,
    photos: {},
  },
  photoSyncMap: {},
};

let driveSyncTimeout = null;
let driveSyncInterval = null;

const uiState = {
  sessionView: {},
  sessionDatePick: {},
  groupFilter: [],
  primaryGroup: "legs",
  pinnedMachines: [],
  collapsedMachines: [],
};

const undoState = {
  action: null,
  timer: null,
};

const editState = {
  machineId: null,
  groups: [],
  photo: "",
  photoChanged: false,
  photoUpdatedAt: 0,
};

function normalizeSet(set) {
  const reps = Number.isFinite(set?.reps) ? set.reps : 0;
  const weight = Number.isFinite(set?.weight) ? set.weight : 0;
  const unit = set?.unit === "lb" ? "lb" : "kg";
  return {
    id: set?.id || uid(),
    reps,
    weight,
    unit,
  };
}

function normalizeSession(session) {
  return {
    id: session?.id || uid(),
    date: session?.date || new Date().toISOString(),
    sets: Array.isArray(session?.sets) ? session.sets.map(normalizeSet) : [],
  };
}

function normalizeMachine(machine) {
  const fallbackGroup = machine?.group || "legs";
  const groups = sortGroups(normalizeGroups(machine?.groups ?? machine?.group, fallbackGroup));
  return {
    id: machine?.id || uid(),
    group: groups[0] || fallbackGroup,
    groups,
    name: machine?.name || "",
    photo: machine?.photo || "",
    photoUpdatedAt: machine?.photoUpdatedAt || 0,
    sessions: Array.isArray(machine?.sessions)
      ? machine.sessions.map(normalizeSession)
      : [],
  };
}

function getLocalUpdatedAt() {
  return state.lastUpdatedAt || state.lastSavedAt || 0;
}

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
      state.machines = saved.machines.map(normalizeMachine);
      state.lastSavedAt = saved.updatedAt || saved.lastSavedAt || 0;
    }
  } catch (error) {
    console.warn("Failed to load saved state", error);
  }
}

async function saveState(options = {}) {
  try {
    const { skipSync = false } = options;
    const updatedAt = state.lastUpdatedAt || Date.now();
    state.lastSavedAt = updatedAt;
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ machines: state.machines, updatedAt }, SAVE_KEY);
    await new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    state.dirty = false;
    state.lastUpdatedAt = 0;
    autosaveStatus.textContent = `Saved ${formatTime(new Date())}`;
    if (!skipSync && autoSyncToggle.checked) {
      maybeSyncDrive();
    }
  } catch (error) {
    console.warn("Failed to save state", error);
    autosaveStatus.textContent = "Save failed";
  }
}

function scheduleSave() {
  state.dirty = true;
  state.lastUpdatedAt = Date.now();
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

function normalizeGroups(groups, fallbackGroup) {
  const normalized = [];
  const addGroup = (group) => {
    if (!group) return;
    if (GROUP_ALIAS[group]) {
      GROUP_ALIAS[group].forEach(addGroup);
      return;
    }
    normalized.push(group);
  };
  if (Array.isArray(groups)) {
    groups.forEach(addGroup);
  } else if (typeof groups === "string") {
    addGroup(groups);
  } else if (fallbackGroup) {
    addGroup(fallbackGroup);
  }
  const unique = Array.from(new Set(normalized));
  if (unique.length === 0 && fallbackGroup) {
    return [fallbackGroup];
  }
  return unique;
}

function sortGroups(groups) {
  const order = new Map(GROUP_ORDER.map((group, index) => [group, index]));
  return groups.slice().sort((a, b) => {
    const aIndex = order.has(a) ? order.get(a) : 999;
    const bIndex = order.has(b) ? order.get(b) : 999;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.localeCompare(b);
  });
}

function normalizeGroupSelection(groups, fallbackGroup = "legs") {
  const normalized = normalizeGroups(groups, fallbackGroup).filter((group) => GROUP_LABELS[group]);
  if (normalized.length === 0 && fallbackGroup) {
    return [fallbackGroup];
  }
  return sortGroups(Array.from(new Set(normalized)));
}

function getGroupLabel(group) {
  return GROUP_LABELS[group] || group;
}

function formatGroupLabel(groups) {
  const normalized = sortGroups(normalizeGroups(groups, null));
  const groupSet = new Set(normalized);
  if (groupSet.size === 2 && groupSet.has("biceps") && groupSet.has("triceps")) {
    return "Arms";
  }
  return normalized.map(getGroupLabel).join(" + ");
}

function getActiveGroupFilter() {
  return uiState.groupFilter.length ? uiState.groupFilter : ["legs"];
}

function getPrimaryGroup() {
  return uiState.primaryGroup || uiState.groupFilter[0] || "legs";
}

function renderMachines() {
  machineList.innerHTML = "";
  const activeGroups = getActiveGroupFilter();
  syncPinnedMachines();
  syncCollapsedMachines();
  const machines = state.machines.filter((machine) => {
    const groups = Array.isArray(machine.groups) ? machine.groups : normalizeGroups(machine.group, "legs");
    return groups.some((group) => activeGroups.includes(group));
  });
  const pinnedSet = new Set(uiState.pinnedMachines);
  const pinnedMachines = [];
  const regularMachines = [];
  machines.forEach((machine) => {
    if (pinnedSet.has(machine.id)) {
      pinnedMachines.push(machine);
    } else {
      regularMachines.push(machine);
    }
  });
  if (pinnedMachines.length > 1) {
    const pinnedOrder = new Map(
      uiState.pinnedMachines.map((id, index) => [id, index])
    );
    pinnedMachines.sort(
      (a, b) => (pinnedOrder.get(a.id) ?? 999) - (pinnedOrder.get(b.id) ?? 999)
    );
  }

  const totalCount = pinnedMachines.length + regularMachines.length;
  if (totalCount === 0) {
    const empty = document.createElement("div");
    empty.className = "machine";
    empty.innerHTML = "<p>No machines yet. Add one to start tracking.</p>";
    machineList.appendChild(empty);
    return;
  }

  if (pinnedMachines.length > 0) {
    const pinnedStack = document.createElement("div");
    pinnedStack.className = "pinned-stack";
    pinnedMachines.forEach((machine) => {
      const element = createMachineElement(machine);
      pinnedStack.appendChild(element);
    });
    machineList.appendChild(pinnedStack);
  }

  regularMachines.forEach((machine) => {
    const element = createMachineElement(machine);
    machineList.appendChild(element);
  });
}

function createMachineElement(machine) {
  const node = machineTemplate.content.cloneNode(true);
  const article = node.querySelector(".machine");
  const name = node.querySelector(".machine-name");
  const group = node.querySelector(".machine-group");
  const photo = node.querySelector(".machine-photo");
  const addSessionButton = node.querySelector(".add-session");
  const sessionDateInput = node.querySelector(".session-date-input");
  const sessionPrevious = node.querySelector(".session-previous");
  const sessionsSubtitle = node.querySelector(".sessions-subtitle");
  const sessionList = node.querySelector(".session-list");
  const removeButton = node.querySelector(".remove-machine");
  const chartButton = node.querySelector(".open-chart");
  const editButton = node.querySelector(".edit-machine");
  const editPhotoButton = node.querySelector(".edit-photo");
  const pinButton = node.querySelector(".pin-machine");

  article.dataset.id = machine.id;
  name.textContent = machine.name || "Unnamed machine";
  group.textContent = formatGroupLabel(
    machine.groups && machine.groups.length ? machine.groups : machine.group
  );
  const pinned = isMachinePinned(machine.id);
  const collapsed = isMachineCollapsed(machine.id);
  article.classList.toggle("is-pinned", pinned);
  article.classList.toggle("is-collapsed", collapsed);
  name.setAttribute("aria-expanded", collapsed ? "false" : "true");
  photo.src = machine.photo || "";
  photo.style.display = machine.photo ? "block" : "none";
  if (editPhotoButton) {
    editPhotoButton.textContent = machine.photo ? "Edit photo" : "Add photo";
  }
  if (pinButton) {
    pinButton.textContent = pinned ? "Unpin" : "Pin";
    pinButton.classList.toggle("is-active", pinned);
    pinButton.setAttribute("aria-pressed", pinned ? "true" : "false");
  }
  const handleToggle = () => {
    toggleMachineCollapsed(machine.id);
    renderMachines();
  };

  addSessionButton.addEventListener("click", () => {
    const newSession = addSession(machine);
    if (newSession) {
      uiState.sessionView[machine.id] = newSession.id;
      uiState.sessionDatePick[machine.id] = getSessionDateKey(newSession);
    }
    renderMachines();
    scheduleSave();
  });

  removeButton.addEventListener("click", () => {
    if (!confirmRemoval("Remove this machine and all sessions?")) return;
    const index = state.machines.findIndex((item) => item.id === machine.id);
    if (index < 0) return;
    const removed = state.machines.splice(index, 1)[0];
    showUndo("Machine removed.", () => {
      state.machines.splice(index, 0, removed);
    });
    renderMachines();
    scheduleSave();
  });

  chartButton.addEventListener("click", () => {
    openChart(machine);
  });

  editButton.addEventListener("click", () => {
    openEditDialog(machine);
  });

  if (editPhotoButton) {
    editPhotoButton.addEventListener("click", () => {
      openEditDialog(machine);
    });
  }

  if (pinButton) {
    pinButton.addEventListener("click", () => {
      togglePinnedMachine(machine.id);
      renderMachines();
    });
  }

  name.addEventListener("click", handleToggle);
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
  });

  const selectedSession = getSelectedSession(machine);
  const selectedIndex = selectedSession
    ? machine.sessions.findIndex((item) => item.id === selectedSession.id)
    : -1;
  const previousSession =
    selectedIndex >= 0 ? machine.sessions[selectedIndex + 1] : null;
  if (sessionPrevious) {
    sessionPrevious.textContent = previousSession ? getSessionSummary(previousSession) : "";
  }
  if (sessionsSubtitle) {
    if (!machine.sessions.length) {
      sessionsSubtitle.textContent = "No sessions yet";
    } else if (selectedIndex === 0) {
      sessionsSubtitle.textContent = "Showing latest session";
    } else if (selectedIndex > 0) {
      sessionsSubtitle.textContent = "Showing selected session";
    } else {
      sessionsSubtitle.textContent = "No session for this date";
    }
  }

  if (sessionDateInput) {
    const sessionDates = machine.sessions.map(getSessionDateKey);
    const sortedDates = sessionDates.slice().sort();
    sessionDateInput.disabled = machine.sessions.length === 0;
    sessionDateInput.min = sortedDates[0] || "";
    sessionDateInput.max = sortedDates[sortedDates.length - 1] || "";
    sessionDateInput.value =
      uiState.sessionDatePick[machine.id] || (selectedSession ? getSessionDateKey(selectedSession) : "");
    sessionDateInput.addEventListener("change", () => {
      uiState.sessionDatePick[machine.id] = sessionDateInput.value;
      const match = machine.sessions.find(
        (item) => getSessionDateKey(item) === sessionDateInput.value
      );
      uiState.sessionView[machine.id] = match ? match.id : null;
      renderMachines();
    });
  }

  if (!machine.sessions.length) {
    const empty = document.createElement("p");
    empty.className = "session-empty";
    empty.textContent = "No sessions yet. Add one to start tracking.";
    sessionList.appendChild(empty);
  } else if (selectedSession) {
    const sessionElement = createSessionElement(machine, selectedSession);
    sessionList.appendChild(sessionElement);
  } else {
    const empty = document.createElement("p");
    empty.className = "session-empty";
    empty.textContent = "No session on this date.";
    sessionList.appendChild(empty);
  }

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
    session.sets.push({ id: uid(), reps: 0, weight: 0, unit: "kg" });
    renderMachines();
    scheduleSave();
  });

  removeSessionButton.addEventListener("click", () => {
    if (!confirmRemoval("Remove this session?")) return;
    const index = machine.sessions.findIndex((item) => item.id === session.id);
    if (index < 0) return;
    const removed = machine.sessions.splice(index, 1)[0];
    showUndo("Session removed.", () => {
      machine.sessions.splice(index, 0, removed);
    });
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
  const weightInput = node.querySelector(".set-weight-value");
  const unitSelect = node.querySelector(".set-weight-unit");
  const removeSetButton = node.querySelector(".remove-set");

  row.dataset.setId = set.id;
  label.textContent = `#${index + 1}`;
  repsInput.value = set.reps ?? 0;
  weightInput.value = set.weight ?? 0;
  unitSelect.value = set.unit === "lb" ? "lb" : "kg";

  repsInput.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    set.reps = Number.isNaN(value) ? 0 : value;
    scheduleSave();
  });

  weightInput.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    set.weight = Number.isNaN(value) ? 0 : value;
    scheduleSave();
  });

  unitSelect.addEventListener("change", (event) => {
    set.unit = event.target.value;
    scheduleSave();
  });

  removeSetButton.addEventListener("click", () => {
    if (!confirmRemoval("Remove this set?")) return;
    const index = session.sets.findIndex((item) => item.id === set.id);
    if (index < 0) return;
    const removed = session.sets.splice(index, 1)[0];
    showUndo("Set removed.", () => {
      session.sets.splice(index, 0, removed);
    });
    renderMachines();
    scheduleSave();
  });

  return node;
}

function addMachine() {
  if (isLoginRequired()) return;
  const groups = normalizeGroupSelection([getPrimaryGroup()], "legs");
  const machine = {
    id: uid(),
    group: groups[0],
    groups,
    name: "",
    photo: "",
    photoUpdatedAt: 0,
    sessions: [],
  };
  state.machines.unshift(machine);
  if (!uiState.collapsedMachines.includes(machine.id)) {
    uiState.collapsedMachines.unshift(machine.id);
  }
  renderMachines();
  scheduleSave();
}

function addSession(machine) {
  const newSession = {
    id: uid(),
    date: new Date().toISOString(),
    sets: [{ id: uid(), reps: 0, weight: 0, unit: "kg" }],
  };
  machine.sessions.unshift(newSession);
  return newSession;
}

function openChart(machine) {
  chartTitle.textContent = `${machine.name || "Unnamed machine"} progress`;
  drawChart(machine.sessions);
  chartDialog.showModal();
}

function openEditDialog(machine) {
  if (!editDialog || !editNameInput || !editPhotoInput) return;
  editState.machineId = machine.id;
  editState.groups = normalizeGroupSelection(machine.groups || machine.group, "legs");
  editState.photo = machine.photo || "";
  editState.photoChanged = false;
  editState.photoUpdatedAt = machine.photoUpdatedAt || 0;
  editNameInput.value = machine.name || "";
  editPhotoInput.value = "";
  if (editPhotoCameraInput) editPhotoCameraInput.value = "";
  updateEditPhotoPreview(editState.photo);
  updateGroupSelection("edit", editState.groups, { persist: false });
  editDialog.showModal();
}

function updateEditPhotoPreview(dataUrl) {
  if (!editPhotoPreview || !editPhotoPlaceholder) return;
  if (dataUrl) {
    editPhotoPreview.src = dataUrl;
    editPhotoPreview.style.display = "block";
    editPhotoPlaceholder.style.display = "none";
  } else {
    editPhotoPreview.removeAttribute("src");
    editPhotoPreview.style.display = "none";
    editPhotoPlaceholder.style.display = "block";
  }
}

function resetEditDialog() {
  editState.machineId = null;
  editState.groups = [];
  editState.photo = "";
  editState.photoChanged = false;
  editState.photoUpdatedAt = 0;
  if (editNameInput) editNameInput.value = "";
  if (editPhotoInput) editPhotoInput.value = "";
  if (editPhotoCameraInput) editPhotoCameraInput.value = "";
  updateEditPhotoPreview("");
  updateGroupSelection("edit", ["legs"], { persist: false });
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_load_failed"));
    image.src = dataUrl;
  });
}

async function cropPhotoCenter(dataUrl) {
  const image = await loadImageFromDataUrl(dataUrl);
  const size = Math.min(image.width, image.height);
  const sx = (image.width - size) / 2;
  const sy = (image.height - size) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, sx, sy, size, size, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.92);
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

function applyCompactView(enabled) {
  document.body.classList.toggle("is-compact", enabled);
}

function loadCompactView() {
  return localStorage.getItem(COMPACT_VIEW_KEY) === "1";
}

function setupCompactView() {
  if (!compactToggle) return;
  const enabled = loadCompactView();
  compactToggle.checked = enabled;
  applyCompactView(enabled);
  compactToggle.addEventListener("change", () => {
    applyCompactView(compactToggle.checked);
    localStorage.setItem(COMPACT_VIEW_KEY, compactToggle.checked ? "1" : "0");
  });
}

function setupPinnedControls() {
  updatePinnedControls();
  if (!clearPinsButton) return;
  clearPinsButton.addEventListener("click", () => {
    uiState.pinnedMachines = [];
    updatePinnedControls();
    renderMachines();
  });
}

function updatePinnedControls() {
  if (!clearPinsButton) return;
  const count = uiState.pinnedMachines.length;
  clearPinsButton.disabled = count === 0;
  clearPinsButton.textContent = count ? `Clear pins (${count})` : "Clear pins";
}

function syncPinnedMachines() {
  if (uiState.pinnedMachines.length === 0) return;
  const available = new Set(state.machines.map((machine) => machine.id));
  uiState.pinnedMachines = uiState.pinnedMachines.filter((id) => available.has(id));
  updatePinnedControls();
}

function isMachinePinned(machineId) {
  return uiState.pinnedMachines.includes(machineId);
}

function togglePinnedMachine(machineId) {
  const index = uiState.pinnedMachines.indexOf(machineId);
  if (index >= 0) {
    uiState.pinnedMachines.splice(index, 1);
  } else {
    uiState.pinnedMachines.unshift(machineId);
    if (!isMachineCollapsed(machineId)) {
      uiState.collapsedMachines.unshift(machineId);
    }
  }
  updatePinnedControls();
}

function syncCollapsedMachines() {
  if (uiState.collapsedMachines.length === 0) return;
  const available = new Set(state.machines.map((machine) => machine.id));
  uiState.collapsedMachines = uiState.collapsedMachines.filter((id) => available.has(id));
}

function isMachineCollapsed(machineId) {
  return uiState.collapsedMachines.includes(machineId);
}

function toggleMachineCollapsed(machineId) {
  const index = uiState.collapsedMachines.indexOf(machineId);
  if (index >= 0) {
    uiState.collapsedMachines.splice(index, 1);
  } else {
    uiState.collapsedMachines.unshift(machineId);
  }
}

function initializeCollapsedMachines() {
  uiState.collapsedMachines = state.machines.map((machine) => machine.id);
}

function applyGroupButtonState(buttons, selectedGroups) {
  buttons.forEach((button) => {
    const group = button.dataset.group;
    const isActive = selectedGroups.includes(group);
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function applyAliasButtonState(buttons, selectedGroups) {
  buttons.forEach((button) => {
    const targets = (button.dataset.targets || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const activeCount = targets.filter((group) => selectedGroups.includes(group)).length;
    const isActive = targets.length > 0 && activeCount === targets.length;
    const isPartial = activeCount > 0 && !isActive;
    button.classList.toggle("is-active", isActive);
    button.classList.toggle("is-partial", isPartial);
    button.setAttribute("aria-pressed", isActive ? "true" : isPartial ? "mixed" : "false");
  });
}

function updateGroupSelection(scope, nextGroups, options = {}) {
  const { persist = true } = options;
  const normalized = normalizeGroupSelection(nextGroups, "legs");
  if (scope === "filter") {
    uiState.groupFilter = normalized;
    if (!normalized.includes(uiState.primaryGroup)) {
      uiState.primaryGroup = normalized[0] || "legs";
    }
    applyGroupButtonState(groupFilterButtons, normalized);
    applyAliasButtonState(groupFilterAliasButtons, normalized);
    if (persist) {
      localStorage.setItem(GROUP_FILTER_KEY, JSON.stringify(normalized));
    }
  } else {
    editState.groups = normalized;
    applyGroupButtonState(editGroupButtons, normalized);
    applyAliasButtonState(editGroupAliasButtons, normalized);
  }
}

function toggleGroupSelection(currentGroups, group) {
  const selected = new Set(currentGroups);
  if (selected.has(group)) {
    if (selected.size === 1) return currentGroups;
    selected.delete(group);
  } else {
    selected.add(group);
  }
  return Array.from(selected);
}

function toggleAliasSelection(currentGroups, targets) {
  const selected = new Set(currentGroups);
  const allSelected = targets.every((group) => selected.has(group));
  if (allSelected) {
    if (selected.size === targets.length) {
      return currentGroups;
    }
    targets.forEach((group) => selected.delete(group));
    if (selected.size === 0) {
      selected.add(targets[0]);
    }
  } else {
    targets.forEach((group) => selected.add(group));
  }
  return Array.from(selected);
}

function loadGroupFilterSelection() {
  const saved = localStorage.getItem(GROUP_FILTER_KEY);
  if (!saved) return ["legs"];
  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return normalizeGroupSelection(parsed, "legs");
    }
  } catch (error) {
    console.warn("Failed to load group filter", error);
  }
  return ["legs"];
}

function setupGroupFilters() {
  if (!groupFilter || groupFilterButtons.length === 0) return;
  updateGroupSelection("filter", loadGroupFilterSelection(), { persist: false });
  uiState.primaryGroup = uiState.groupFilter[0] || "legs";
  groupFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = toggleGroupSelection(uiState.groupFilter, button.dataset.group);
      updateGroupSelection("filter", next);
      if (uiState.groupFilter.includes(button.dataset.group)) {
        uiState.primaryGroup = button.dataset.group;
      } else {
        uiState.primaryGroup = uiState.groupFilter[0] || "legs";
      }
      renderMachines();
    });
  });
  groupFilterAliasButtons.forEach((button) => {
    const targets = (button.dataset.targets || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (targets.length === 0) return;
    button.addEventListener("click", () => {
      const next = toggleAliasSelection(uiState.groupFilter, targets);
      updateGroupSelection("filter", next);
      uiState.primaryGroup = uiState.groupFilter[0] || "legs";
      renderMachines();
    });
  });
}

function setupEditGroups() {
  if (editGroupButtons.length === 0) return;
  editGroupButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = toggleGroupSelection(editState.groups, button.dataset.group);
      updateGroupSelection("edit", next, { persist: false });
    });
  });
  editGroupAliasButtons.forEach((button) => {
    const targets = (button.dataset.targets || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (targets.length === 0) return;
    button.addEventListener("click", () => {
      const next = toggleAliasSelection(editState.groups, targets);
      updateGroupSelection("edit", next, { persist: false });
    });
  });
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
    connectToDrive(true);
  });
  disconnectDrive.addEventListener("click", () => {
    disconnectFromDrive();
  });
  syncDrive.addEventListener("click", () => {
    syncStateToDrive(true);
  });
  autoSyncToggle.addEventListener("change", () => {
    localStorage.setItem(DRIVE_AUTOSYNC_KEY, autoSyncToggle.checked ? "1" : "0");
  });
}

function setupChart() {
  closeChart.addEventListener("click", () => chartDialog.close());
}

function setupUndo() {
  if (!undoToast || !undoAction || !undoMessage || !undoDismiss) return;
  undoAction.addEventListener("click", () => {
    if (!undoState.action) return;
    undoState.action();
    clearUndo();
    renderMachines();
    scheduleSave();
  });
  undoDismiss.addEventListener("click", () => {
    clearUndo();
  });
}

function setupEditDialog() {
  if (
    !editDialog ||
    !editNameInput ||
    !editPhotoInput ||
    !editPhotoPreview ||
    !editPhotoPlaceholder ||
    !cropPhotoButton ||
    !removePhotoButton ||
    !saveEditButton ||
    !closeEditButton
  ) {
    return;
  }
  closeEditButton.addEventListener("click", () => editDialog.close());
  editDialog.addEventListener("close", resetEditDialog);
  editDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    editDialog.close();
  });
  const handlePhotoInputChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      editState.photo = reader.result;
      editState.photoChanged = true;
      editState.photoUpdatedAt = Date.now();
      updateEditPhotoPreview(editState.photo);
    };
    reader.readAsDataURL(file);
  };
  editPhotoInput.addEventListener("change", handlePhotoInputChange);
  if (editPhotoCameraInput) {
    editPhotoCameraInput.addEventListener("change", handlePhotoInputChange);
  }
  cropPhotoButton.addEventListener("click", async () => {
    if (!editState.photo) return;
    try {
      editState.photo = await cropPhotoCenter(editState.photo);
      editState.photoChanged = true;
      editState.photoUpdatedAt = Date.now();
      updateEditPhotoPreview(editState.photo);
    } catch (error) {
      console.warn("Failed to crop image", error);
    }
  });
  removePhotoButton.addEventListener("click", () => {
    editState.photo = "";
    editState.photoChanged = true;
    editState.photoUpdatedAt = Date.now();
    updateEditPhotoPreview("");
  });
  saveEditButton.addEventListener("click", () => {
    const machine = state.machines.find((item) => item.id === editState.machineId);
    if (!machine) {
      editDialog.close();
      return;
    }
    machine.name = editNameInput.value.trim();
    const nextGroups = normalizeGroupSelection(editState.groups, machine.group || "legs");
    machine.groups = nextGroups;
    machine.group = nextGroups[0];
    if (editState.photoChanged) {
      machine.photo = editState.photo || "";
      machine.photoUpdatedAt = editState.photo ? editState.photoUpdatedAt : 0;
    }
    renderMachines();
    scheduleSave();
    editDialog.close();
  });
}

async function init() {
  loginGateConnect.addEventListener("click", () => {
    connectToDrive(true);
  });
  await loadState();
  initializeCollapsedMachines();
  loadDriveState();
  setupTabs();
  setupSettings();
  setupChart();
  setupUndo();
  setupEditDialog();
  setupGroupFilters();
  setupEditGroups();
  setupCompactView();
  setupPinnedControls();
  addMachineButton.addEventListener("click", addMachine);
  renderMachines();
  startAutosave();
  autosaveStatus.textContent = "Autosave running";
  autoSyncToggle.checked = localStorage.getItem(DRIVE_AUTOSYNC_KEY) !== "0";
  setLoginRequired(true);
  if (localStorage.getItem(DRIVE_CONNECTED_KEY) === "true") {
    connectToDrive(false);
  }
}

init();

function loadDriveState() {
  const saved = localStorage.getItem(DRIVE_STATE_KEY);
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    drive.folderId = parsed.folderId || null;
    drive.fileIds = parsed.fileIds || { state: null, photos: {} };
    drive.photoSyncMap = parsed.photoSyncMap || {};
  } catch (error) {
    console.warn("Failed to load Drive state", error);
  }
}

function saveDriveState() {
  const payload = {
    folderId: drive.folderId,
    fileIds: drive.fileIds,
    photoSyncMap: drive.photoSyncMap,
  };
  localStorage.setItem(DRIVE_STATE_KEY, JSON.stringify(payload));
}

function ensureTokenClient() {
  if (drive.tokenClient) return true;
  if (!window.google?.accounts?.oauth2) {
    driveStatus.textContent = "Google identity services not loaded";
    setLoginStatus("Google sign-in is still loading. Try again in a moment.");
    return false;
  }
  drive.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID,
    scope: DRIVE_SCOPES,
    callback: () => {},
  });
  return true;
}

function startDriveSyncTimer() {
  stopDriveSyncTimer();
  driveSyncTimeout = setTimeout(() => {
    if (autoSyncToggle.checked) {
      maybeSyncDrive();
    }
    driveSyncInterval = setInterval(() => {
      if (autoSyncToggle.checked) {
        maybeSyncDrive();
      }
    }, DRIVE_SYNC_INTERVAL_MS);
  }, DRIVE_SYNC_DELAY_MS);
}

function stopDriveSyncTimer() {
  if (driveSyncTimeout) {
    clearTimeout(driveSyncTimeout);
    driveSyncTimeout = null;
  }
  if (driveSyncInterval) {
    clearInterval(driveSyncInterval);
    driveSyncInterval = null;
  }
}

function connectToDrive(interactive) {
  driveStatus.textContent = "Connecting...";
  setLoginStatus("Connecting...");
  waitForGoogleIdentity(2000)
    .then(() => {
      if (!ensureTokenClient()) throw new Error("gis_missing");
      return requestAccessToken(interactive);
    })
    .then(() => {
      driveStatus.textContent = "Connected to Google Drive";
      localStorage.setItem(DRIVE_CONNECTED_KEY, "true");
      setLoginRequired(false);
      setLoginStatus("");
      return restoreStateFromDrive(interactive);
    })
    .then(() => {
      startDriveSyncTimer();
    })
    .catch((err) => {
      drive.accessToken = "";
      drive.tokenExpiry = 0;
      localStorage.removeItem(DRIVE_CONNECTED_KEY);
      setLoginRequired(true);
      stopDriveSyncTimer();
      driveStatus.textContent = "Sign-in required";
      setLoginStatus("Sign-in required. Click “Sign in with Google”.");
      console.warn("Drive sign-in failed", err);
    });
}

function disconnectFromDrive() {
  drive.accessToken = "";
  drive.tokenExpiry = 0;
  drive.folderId = null;
  drive.fileIds = { state: null, photos: {} };
  drive.photoSyncMap = {};
  localStorage.removeItem(DRIVE_CONNECTED_KEY);
  stopDriveSyncTimer();
  saveDriveState();
  driveStatus.textContent = "Not connected";
  setLoginRequired(true);
}

function requestAccessToken(interactive) {
  return new Promise((resolve, reject) => {
    if (!ensureTokenClient()) {
      reject(new Error("missing_client"));
      return;
    }
    const now = Date.now();
    if (drive.accessToken && now < drive.tokenExpiry) {
      resolve(drive.accessToken);
      return;
    }
    if (!interactive) {
      reject(new Error("needs_user_gesture"));
      return;
    }
    drive.tokenClient.callback = (response) => {
      if (response?.error || !response?.access_token) {
        drive.accessToken = "";
        drive.tokenExpiry = 0;
        localStorage.removeItem(DRIVE_CONNECTED_KEY);
        reject(response);
        return;
      }
      drive.accessToken = response.access_token;
      drive.tokenExpiry = Date.now() + (response.expires_in - 60) * 1000;
      localStorage.setItem(DRIVE_CONNECTED_KEY, "true");
      resolve(drive.accessToken);
    };
    drive.tokenClient.requestAccessToken();
  });
}

function maybeSyncDrive() {
  if (!autoSyncToggle.checked) return;
  const now = Date.now();
  if (drive.syncing || now - drive.lastSync < DRIVE_SYNC_MIN_MS) return;
  if (!drive.accessToken || now >= drive.tokenExpiry) return;
  const localUpdatedAt = getLocalUpdatedAt();
  if (!state.dirty && drive.lastSync && localUpdatedAt <= drive.lastSync) return;
  syncStateToDrive(false);
}

async function syncStateToDrive(interactive) {
  if (drive.syncing) return;
  const now = Date.now();
  if (!interactive && (!drive.accessToken || now >= drive.tokenExpiry)) {
    driveStatus.textContent = "Sign-in required to sync";
    setLoginRequired(true);
    return;
  }
  drive.syncing = true;
  driveStatus.textContent = "Syncing...";
  try {
    if (state.dirty) {
      await saveState({ skipSync: true });
    }
    await requestAccessToken(interactive);
    const folderId = await ensureDriveFolder();
    await uploadStateFile(folderId);
    await uploadPhotos(folderId);
    drive.lastSync = Date.now();
    driveStatus.textContent = `Backup uploaded ${formatDateTime(new Date())}`;
    saveDriveState();
  } catch (error) {
    console.warn("Drive sync failed", error);
    driveStatus.textContent = "Sync failed";
    setLoginRequired(true);
  } finally {
    drive.syncing = false;
  }
}

async function ensureDriveFolder() {
  if (drive.folderId) return drive.folderId;
  const query =
    "name='" +
    DRIVE_FOLDER_NAME +
    "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
  const url =
    "https://www.googleapis.com/drive/v3/files?q=" +
    encodeURIComponent(query) +
    "&fields=files(id,name)";
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${drive.accessToken}` },
  });
  const data = await response.json();
  if (data.files && data.files.length > 0) {
    drive.folderId = data.files[0].id;
    return drive.folderId;
  }
  const createResponse = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${drive.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  const created = await createResponse.json();
  drive.folderId = created.id;
  return drive.folderId;
}

async function uploadStateFile(folderId) {
  const updatedAt = getLocalUpdatedAt() || Date.now();
  const body = JSON.stringify({ machines: state.machines, updatedAt }, null, 2);
  const fileId = drive.fileIds.state;
  const upload = await uploadDriveFile({
    fileId,
    name: "gym-tracker-state.json",
    mimeType: "application/json",
    data: new Blob([body], { type: "application/json" }),
    folderId,
  });
  drive.fileIds.state = upload.id;
}

async function uploadPhotos(folderId) {
  for (const machine of state.machines) {
    if (!machine.photo) continue;
    const lastSynced = drive.photoSyncMap[machine.id] || 0;
    if (machine.photoUpdatedAt && machine.photoUpdatedAt <= lastSynced) {
      continue;
    }
    const blob = dataUrlToBlob(machine.photo); 
    const fileName = `machine-${machine.id}.${blob.type.split("/")[1] || "jpg"}`; 
    const fileId = drive.fileIds.photos[machine.id] || null;
    const upload = await uploadDriveFile({
      fileId,
      name: fileName,
      mimeType: blob.type,
      data: blob,
      folderId,
    });
    drive.fileIds.photos[machine.id] = upload.id;
    drive.photoSyncMap[machine.id] = machine.photoUpdatedAt || Date.now();
  }
}

async function uploadDriveFile({ fileId, name, mimeType, data, folderId }) {
  const metadata = { name };
  if (!fileId && folderId) {
    metadata.parents = [folderId];
  }
  const boundary = "-------gymtrackerboundary";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const body = new Blob(
    [
      delimiter,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
      delimiter,
      `Content-Type: ${mimeType}\r\n\r\n`,
      data,
      closeDelimiter,
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );
  const urlBase = "https://www.googleapis.com/upload/drive/v3/files";
  const url = fileId
    ? `${urlBase}/${fileId}?uploadType=multipart`
    : `${urlBase}?uploadType=multipart`;
  const response = await fetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${drive.accessToken}`,
    },
    body,
  });
  return response.json();
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function setGroupFilterDisabled(disabled) {
  groupFilterButtons.forEach((button) => {
    button.disabled = disabled;
  });
  groupFilterAliasButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function setLoginRequired(required) {
  loginGate.classList.toggle("is-hidden", !required);
  addMachineButton.disabled = required;
  setGroupFilterDisabled(required);
  if (compactToggle) compactToggle.disabled = required;
  if (clearPinsButton) clearPinsButton.disabled = required || uiState.pinnedMachines.length === 0;
  tabs.forEach((tab) => {
    tab.disabled = required;
  });
}

function isLoginRequired() {
  return !loginGate.classList.contains("is-hidden");
}

function setLoginStatus(message) {
  if (!loginGateStatus) return;
  loginGateStatus.textContent = message;
}

function waitForGoogleIdentity(timeoutMs) {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("gis_timeout"));
      }
    }, 100);
  });
}

function shouldRestoreRemoteState(remoteState) {
  const remoteMachines = Array.isArray(remoteState?.machines) ? remoteState.machines : [];
  if (remoteMachines.length === 0) return false;
  if (state.machines.length === 0) return true;
  const remoteUpdatedAt = remoteState.updatedAt || remoteState.lastSavedAt || 0;
  const localUpdatedAt = getLocalUpdatedAt();
  if (!remoteUpdatedAt && !localUpdatedAt) return true;
  return remoteUpdatedAt >= localUpdatedAt;
}

async function fetchDriveState(fileId) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: { Authorization: `Bearer ${drive.accessToken}` },
    }
  );
  if (!response.ok) {
    throw new Error("drive_state_fetch_failed");
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn("Failed to parse Drive state file", error);
    return null;
  }
}

async function restoreStateFromDrive(interactive) {
  driveStatus.textContent = "Checking Drive backup...";
  try {
    await requestAccessToken(interactive);
    const folderId = await ensureDriveFolder();
    const fileId = await findStateFileId(folderId);
    if (!fileId) {
      driveStatus.textContent = "No backup found yet";
      if (interactive && state.machines.length > 0) {
        await syncStateToDrive(true);
      }
      return;
    }
    const data = await fetchDriveState(fileId);
    if (data && data.machines) {
      const remoteUpdatedAt = data.updatedAt || data.lastSavedAt || 0;
      const shouldRestore = shouldRestoreRemoteState(data);
      if (shouldRestore) {
        state.machines = data.machines.map(normalizeMachine);
        state.lastSavedAt = remoteUpdatedAt;
        state.lastUpdatedAt = remoteUpdatedAt;
        initializeCollapsedMachines();
        renderMachines();
        await saveState();
        await restorePhotosFromDrive(folderId);
        driveStatus.textContent = `Backup downloaded ${formatDateTime(new Date())}`;
      } else {
        driveStatus.textContent = "Local data is newer; keeping this device";
        if (interactive) {
          await syncStateToDrive(true);
        }
      }
    } else {
      driveStatus.textContent = "Backup file was empty";
    }
    drive.fileIds.state = fileId;
    saveDriveState();
  } catch (error) {
    console.warn("Drive restore failed", error);
    driveStatus.textContent = "Restore failed";
  }
}

async function findStateFileId(folderId) {
  if (drive.fileIds.state) return drive.fileIds.state;
  const query =
    "name='gym-tracker-state.json' and '" +
    folderId +
    "' in parents and trashed=false";
  const url =
    "https://www.googleapis.com/drive/v3/files?q=" +
    encodeURIComponent(query) +
    "&fields=files(id,name)";
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${drive.accessToken}` },
  });
  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

async function restorePhotosFromDrive(folderId) {
  const files = await listPhotoFiles(folderId);
  if (!files.length) return;
  for (const file of files) {
    const machineId = parseMachineId(file.name);
    if (!machineId) continue;
    const machine = state.machines.find((item) => item.id === machineId);
    if (!machine) continue;
    const blobResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
      { headers: { Authorization: `Bearer ${drive.accessToken}` } }
    );
    const blob = await blobResponse.blob();
    const dataUrl = await blobToDataUrl(blob);
    machine.photo = dataUrl;
    machine.photoUpdatedAt = Date.now();
    drive.fileIds.photos[machineId] = file.id;
    drive.photoSyncMap[machineId] = machine.photoUpdatedAt;
  }
  renderMachines();
  saveDriveState();
}

async function listPhotoFiles(folderId) {
  const query =
    "name contains 'machine-' and '" + folderId + "' in parents and trashed=false";
  const url =
    "https://www.googleapis.com/drive/v3/files?q=" +
    encodeURIComponent(query) +
    "&fields=files(id,name)";
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${drive.accessToken}` },
  });
  const data = await response.json();
  return data.files || [];
}

function parseMachineId(fileName) {
  if (!fileName.startsWith("machine-")) return null;
  const trimmed = fileName.replace("machine-", "");
  const dotIndex = trimmed.indexOf(".");
  return dotIndex === -1 ? trimmed : trimmed.slice(0, dotIndex);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
