import { createNeedle, createWhistle, tool } from "../vendor/cactus-needle/dist/browser/index.js";

const WHISTLE_SHA256 = "b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb";
const NEEDLE_SHA256 = "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38";
const MAX_RECORDING_MS = 30_000;
const SUPPORTED_SPEECH_LANGUAGES = new Set(["en", "de", "fr", "es", "it", "nl", "pl"]);
const whistleModelUrl = new URL("../models/whistle.cact", import.meta.url).href;
const needleModelUrl = new URL("../models/needle3.cact", import.meta.url).href;

const recordButton = query("#recordButton");
const statusText = query("#statusText");
const transcript = query("#transcript");
const lightButtons = Array.from(document.querySelectorAll("[data-room]"));
const timerDisplay = query("#timerDisplay");
const timerStatus = query("#timerStatus");
const cancelTimerButton = query("#cancelTimerButton");
const notesList = query("#notesList");
const notesEmpty = query("#notesEmpty");
const commandLog = query("#commandLog");

const lights = {
  living: false,
  cocina: false,
  jardin: false,
};

let notes = [];
let nextNoteId = 1;
let timerRemaining = 0;
let timerInterval = 0;
let state = "loading";
let whistle = null;
let needle = null;
let mediaRecorder = null;
let mediaStream = null;
let audioContext = null;
let recordingTimeout = 0;
let audioChunks = [];
let activeInput = null;
let pressSequence = 0;
let currentCommandInput = "";
let currentTranscriptionLanguages = { passed: "auto", detected: "—" };

const commandTools = {
  set_light: tool({
    description: "Enciende o apaga una luz de la casa.",
    triggers: ["luz", "luces", "enciende", "encendé", "apaga", "apagá"],
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", enum: ["living", "cocina", "jardin"] },
        on: { type: "boolean" },
      },
      required: ["room", "on"],
      additionalProperties: false,
    },
    execute({ room, on }) {
      const result = setLight(room, on);
      appendCommandLog("set_light", { room, on });
      return result;
    },
  }),
  set_timer: tool({
    description: "Inicia o reemplaza el temporizador con una duración expresada en segundos.",
    triggers: ["temporizador", "timer", "cuenta regresiva", "avísame en"],
    inputSchema: {
      type: "object",
      properties: {
        seconds: { type: "integer", minimum: 1, maximum: 86400 },
      },
      required: ["seconds"],
      additionalProperties: false,
    },
    execute({ seconds }) {
      const result = startTimer(seconds);
      appendCommandLog("set_timer", { seconds });
      return result;
    },
  }),
  cancel_timer: tool({
    description: "Cancela y apaga el temporizador activo.",
    triggers: ["cancela el temporizador", "detén el temporizador", "apaga el timer"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute() {
      const result = cancelTimer();
      appendCommandLog("cancel_timer", {});
      return result;
    },
  }),
  add_note: tool({
    description: "Agrega una nota breve a la lista.",
    triggers: ["anota", "agrega una nota", "recuerda", "apunta", "recordame"],
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1 },
      },
      required: ["text"],
      additionalProperties: false,
    },
    execute({ text }) {
      const result = addNote(text);
      appendCommandLog("add_note", { text });
      return result;
    },
  }),
  remove_note: tool({
    description: "Elimina una nota usando el número visible junto a ella.",
    triggers: ["elimina la nota", "borra la nota", "quita la nota"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    execute({ id }) {
      const result = removeNote(id);
      appendCommandLog("remove_note", { id });
      return result;
    },
  }),
  clear_notes: tool({
    description: "Elimina todas las notas de la lista.",
    triggers: ["borra todas las notas", "limpia las notas", "elimina todas las notas"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute() {
      const result = clearNotes();
      appendCommandLog("clear_notes", {});
      return result;
    },
  }),
};

function query(selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`No se encontró ${selector}`);
  return element;
}

function setState(nextState, message) {
  state = nextState;
  statusText.textContent = message;
  recordButton.disabled = ["loading", "transcribing", "error"].includes(nextState);
  recordButton.setAttribute("aria-pressed", String(nextState === "recording"));
  document.body.dataset.state = nextState;
}

async function loadModels() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    fail(new Error("Este navegador no permite grabar audio"), "Micrófono no compatible");
    return;
  }

  try {
    setState("loading", "Cargando motor de voz a texto...");
    whistle = await createWhistle({
      model: whistleModelUrl,
      modelSha256: WHISTLE_SHA256,
      cache: true,
    });

    setState("loading", "Cargando motor de comandos...");
    needle = await createNeedle({
      model: needleModelUrl,
      modelSha256: NEEDLE_SHA256,
      cache: true,
      stateless: true,
      tools: commandTools,
      system: "Interpretá órdenes de domótica en español. Ejecutá todos los comandos solicitados. Convertí las duraciones a segundos. Las notas se eliminan por su número visible.",
    });

    setState("ready", "Listo para escuchar");
  } catch (error) {
    fail(error, "No se pudieron cargar los modelos");
  }
}

async function beginRecording(source) {
  if (activeInput !== null || state !== "ready") return;
  activeInput = source;
  const sequence = ++pressSequence;
  setState("requesting", "Solicitando micrófono");

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (activeInput !== source || sequence !== pressSequence) {
      releaseStream();
      setState("ready", "Listo para escuchar");
      return;
    }

    audioContext = new AudioContext();
    audioChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.addEventListener("dataavailable", ({ data }) => {
      if (data.size > 0) audioChunks.push(data);
    });
    mediaRecorder.addEventListener("stop", () => void processRecording(), { once: true });
    mediaRecorder.start(200);

    recordingTimeout = window.setTimeout(() => endRecording(), MAX_RECORDING_MS);
    setState("recording", "Escuchando");
  } catch (error) {
    activeInput = null;
    releaseStream();
    await closeAudioContext();
    fail(error, "No se pudo acceder al micrófono");
  }
}

function endRecording(source) {
  if (source && activeInput !== source) return;
  activeInput = null;
  pressSequence += 1;

  if (state === "requesting") return;
  if (state !== "recording" || !mediaRecorder) return;

  window.clearTimeout(recordingTimeout);
  setState("transcribing", "Transcribiendo");
  mediaRecorder.stop();
}

async function processRecording() {
  try {
    if (!whistle || !needle || !audioContext) throw new Error("Los modelos todavía no están listos");
    const blob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || "audio/webm" });
    releaseStream();
    mediaRecorder = null;

    const encodedAudio = await blob.arrayBuffer();
    const decodedAudio = await audioContext.decodeAudioData(encodedAudio);
    if (decodedAudio.duration < 0.15) throw new Error("La grabación fue demasiado corta");

    const systemLanguage = navigator.language.split("-")[0].toLowerCase();
    const passedLanguage = SUPPORTED_SPEECH_LANGUAGES.has(systemLanguage) ? systemLanguage : "auto";
    const result = await whistle.transcribe(
      {
        samples: downmix(decodedAudio),
        sampleRate: decodedAudio.sampleRate,
      },
      passedLanguage === "auto" ? {} : { language: passedLanguage },
    );
    currentTranscriptionLanguages = {
      passed: passedLanguage,
      detected: result.language || "—",
    };
    const text = result.text.trim();
    transcript.textContent = text || "No se detectó voz. Intentá nuevamente.";

    if (!text) {
      setState("ready", "Listo para escuchar");
      return;
    }

    setState("transcribing", "Interpretando comando");
    currentCommandInput = text;
    let commandResult;
    try {
      commandResult = await needle.run(text, { maxSteps: 4 });
    } finally {
      currentCommandInput = "";
    }
    const successfulActions = commandResult.results.filter(
      (item) => !item || typeof item !== "object" || !("error" in item),
    ).length;

    if (successfulActions === 0) {
      appendUnrecognizedInput(text);
      setState("ready", "No se reconoció ningún comando");
    } else {
      const label = successfulActions === 1 ? "comando ejecutado" : "comandos ejecutados";
      setState("ready", `${successfulActions} ${label}`);
    }
  } catch (error) {
    fail(error, "No se pudo procesar el comando");
  } finally {
    await closeAudioContext();
    audioChunks = [];
  }
}

function downmix(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const output = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    for (let index = 0; index < input.length; index += 1) {
      output[index] += input[index] / buffer.numberOfChannels;
    }
  }
  return output;
}

function setLight(room, on) {
  if (!(room in lights)) throw new Error(`Luz desconocida: ${room}`);
  lights[room] = Boolean(on);
  const button = lightButtons.find((item) => item.dataset.room === room);
  const icon = button?.querySelector("[data-light-icon]");
  if (button) button.setAttribute("aria-pressed", String(lights[room]));
  if (icon) icon.textContent = lights[room] ? "🟡" : "⚫";
  return { room, on: lights[room] };
}

function startTimer(seconds) {
  const duration = Math.round(Number(seconds));
  if (!Number.isFinite(duration) || duration < 1 || duration > 86400) {
    throw new Error("La duración debe estar entre 1 y 86400 segundos");
  }

  window.clearInterval(timerInterval);
  timerRemaining = duration;
  timerStatus.textContent = "Activo";
  cancelTimerButton.disabled = false;
  renderTimer();
  timerInterval = window.setInterval(() => {
    timerRemaining = Math.max(0, timerRemaining - 1);
    renderTimer();
    if (timerRemaining === 0) finishTimer();
  }, 1000);
  return { seconds: duration, active: true };
}

function finishTimer() {
  window.clearInterval(timerInterval);
  timerInterval = 0;
  timerStatus.textContent = "Finalizado";
  cancelTimerButton.disabled = true;
}

function cancelTimer() {
  const remainingSeconds = timerRemaining;
  window.clearInterval(timerInterval);
  timerInterval = 0;
  timerRemaining = 0;
  timerStatus.textContent = "Apagado";
  cancelTimerButton.disabled = true;
  renderTimer();
  return { cancelled: remainingSeconds > 0, remainingSeconds };
}

function renderTimer() {
  const minutes = Math.floor(timerRemaining / 60);
  const seconds = timerRemaining % 60;
  timerDisplay.textContent = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function addNote(text) {
  const normalizedText = String(text).trim();
  if (!normalizedText) throw new Error("La nota no puede estar vacía");
  const note = { id: String(nextNoteId), text: normalizedText };
  nextNoteId += 1;
  notes.push(note);
  renderNotes();
  return note;
}

function removeNote(id) {
  const normalizedId = String(id);
  const index = notes.findIndex((note) => note.id === normalizedId);
  if (index === -1) return { id: normalizedId, removed: false };
  const [removedNote] = notes.splice(index, 1);
  renderNotes();
  return { ...removedNote, removed: true };
}

function clearNotes() {
  const removed = notes.length;
  notes = [];
  renderNotes();
  return { removed };
}

function renderNotes() {
  notesList.replaceChildren();
  if (notes.length === 0) {
    notesList.append(notesEmpty);
    return;
  }

  for (const note of notes) {
    const item = document.createElement("li");
    item.className = "note-item";

    const text = document.createElement("span");
    const id = document.createElement("span");
    id.className = "note-id";
    id.textContent = `#${note.id}`;
    text.append(id, note.text);

    const removeButton = document.createElement("button");
    removeButton.className = "note-remove";
    removeButton.type = "button";
    removeButton.dataset.noteId = note.id;
    removeButton.setAttribute("aria-label", `Eliminar nota ${note.id}`);
    removeButton.textContent = "×";

    item.append(text, removeButton);
    notesList.append(item);
  }
}

function appendCommandLog(name, args) {
  const input = currentCommandInput.replace(/\s+/g, " ").trim();
  const entry = JSON.stringify({ name, arguments: args });
  const line = input ? `${formatLanguageLog()} ${input} -> ${entry}` : entry;
  appendLogLine(line);
}

function appendUnrecognizedInput(input) {
  const normalizedInput = input.replace(/\s+/g, " ").trim();
  appendLogLine(`${formatLanguageLog()} ${normalizedInput} -> Sin comando reconocido`);
}

function formatLanguageLog() {
  return `[${currentTranscriptionLanguages.passed} -> ${currentTranscriptionLanguages.detected}]`;
}

function appendLogLine(line) {
  commandLog.value = commandLog.value ? `${commandLog.value}\n${line}` : line;
  commandLog.scrollTop = commandLog.scrollHeight;
}

function releaseStream() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
}

async function closeAudioContext() {
  if (audioContext && audioContext.state !== "closed") await audioContext.close();
  audioContext = null;
}

function fail(error, fallback) {
  console.error(error);
  const detail = error instanceof Error ? error.message : fallback;
  setState("error", detail || fallback);
  window.setTimeout(() => {
    if (state === "error" && whistle && needle) setState("ready", "Listo para intentar otra vez");
  }, 3500);
}

function ignoreSpaceTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target === recordButton) return false;
  return Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true']"));
}

recordButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  recordButton.setPointerCapture(event.pointerId);
  void beginRecording("pointer");
});
recordButton.addEventListener("pointerup", () => endRecording("pointer"));
recordButton.addEventListener("pointercancel", () => endRecording("pointer"));
window.addEventListener("pointerup", () => endRecording("pointer"));

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat || ignoreSpaceTarget(event.target)) return;
  event.preventDefault();
  void beginRecording("keyboard");
});
window.addEventListener("keyup", (event) => {
  if (event.code !== "Space" || ignoreSpaceTarget(event.target)) return;
  event.preventDefault();
  endRecording("keyboard");
});
window.addEventListener("blur", () => endRecording());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) endRecording();
});

for (const button of lightButtons) {
  button.addEventListener("click", () => {
    const room = button.dataset.room;
    if (room) setLight(room, !lights[room]);
  });
}

cancelTimerButton.addEventListener("click", cancelTimer);
notesList.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-note-id]") : null;
  if (button instanceof HTMLElement && button.dataset.noteId) removeNote(button.dataset.noteId);
});

window.addEventListener("beforeunload", () => {
  releaseStream();
  window.clearInterval(timerInterval);
  void whistle?.close();
  void needle?.close();
});

void loadModels();
