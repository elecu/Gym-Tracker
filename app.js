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

const groupSelect = document.getElementById("groupSelect");
const machineList = document.getElementById("machineList");
const addMachineButton = document.getElementById("addMachine");
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
const editPhotoPreview = document.getElementById("editPhotoPreview");
const editPhotoPlaceholder = document.getElementById("editPhotoPlaceholder");
const cropPhotoButton = document.getElementById("cropPhoto");
const removePhotoButton = document.getElementById("removePhoto");
const saveEditButton = document.getElementById("saveEdit");
const closeEditButton = document.getElementById("closeEdit");

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

const editState = {
  machineId: null,
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
  return {
    id: machine?.id || uid(),
    group: machine?.group || "legs",
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
  const photo = node.querySelector(".machine-photo");
  const addSessionButton = node.querySelector(".add-session");
  const sessionList = node.querySelector(".session-list");
  const removeButton = node.querySelector(".remove-machine");
  const chartButton = node.querySelector(".open-chart");
  const editButton = node.querySelector(".edit-machine");
  const editPhotoButton = node.querySelector(".edit-photo");

  article.dataset.id = machine.id;
  name.textContent = machine.name || "Unnamed machine";
  group.textContent = getGroupLabel(machine.group);
  photo.src = machine.photo || "";
  photo.style.display = machine.photo ? "block" : "none";
  if (editPhotoButton) {
    editPhotoButton.textContent = machine.photo ? "Edit photo" : "Add photo";
  }

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

  editButton.addEventListener("click", () => {
    openEditDialog(machine);
  });

  if (editPhotoButton) {
    editPhotoButton.addEventListener("click", () => {
      openEditDialog(machine);
    });
  }

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
    session.sets.push({ id: uid(), reps: 0, weight: 0, unit: "kg" });
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
    session.sets = session.sets.filter((item) => item.id !== set.id);
    renderMachines();
    scheduleSave();
  });

  return node;
}

function addMachine() {
  if (isLoginRequired()) return;
  const machine = {
    id: uid(),
    group: groupSelect.value,
    name: "",
    photo: "",
    photoUpdatedAt: 0,
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
    sets: [{ id: uid(), reps: 0, weight: 0, unit: "kg" }],
  });
}

function openChart(machine) {
  chartTitle.textContent = `${machine.name || "Unnamed machine"} progress`;
  drawChart(machine.sessions);
  chartDialog.showModal();
}

function openEditDialog(machine) {
  if (!editDialog || !editNameInput || !editPhotoInput) return;
  editState.machineId = machine.id;
  editState.photo = machine.photo || "";
  editState.photoChanged = false;
  editState.photoUpdatedAt = machine.photoUpdatedAt || 0;
  editNameInput.value = machine.name || "";
  editPhotoInput.value = "";
  updateEditPhotoPreview(editState.photo);
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
  editState.photo = "";
  editState.photoChanged = false;
  editState.photoUpdatedAt = 0;
  if (editNameInput) editNameInput.value = "";
  if (editPhotoInput) editPhotoInput.value = "";
  updateEditPhotoPreview("");
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
  editPhotoInput.addEventListener("change", (event) => {
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
  });
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
  loadDriveState();
  setupTabs();
  setupSettings();
  setupChart();
  setupEditDialog();
  groupSelect.addEventListener("change", renderMachines);
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

function setLoginRequired(required) {
  loginGate.classList.toggle("is-hidden", !required);
  addMachineButton.disabled = required;
  groupSelect.disabled = required;
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
