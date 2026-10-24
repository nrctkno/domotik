import { createWhistle } from "../vendor/cactus-needle/dist/browser/index.js";

const MODEL_SHA256 = "b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb";
const MAX_RECORDING_MS = 30_000;
const modelUrl = new URL("../models/whistle.cact", import.meta.url).href;

const recordButton = query("#recordButton");
const statusText = query("#statusText");
const transcript = query("#transcript");

let state = "loading";
let whistle = null;
let mediaRecorder = null;
let mediaStream = null;
let audioContext = null;
let recordingTimeout = 0;
let audioChunks = [];
let activeInput = null;
let pressSequence = 0;

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

async function loadModel() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    fail(new Error("Este navegador no permite grabar audio"), "Micrófono no compatible");
    return;
  }

  try {
    whistle = await createWhistle({
      model: modelUrl,
      modelSha256: MODEL_SHA256,
      cache: true,
    });
    setState("ready", "Listo para escuchar");
  } catch (error) {
    fail(error, "No se pudo cargar el modelo");
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

    recordingTimeout = window.setTimeout(() => void endRecording(), MAX_RECORDING_MS);
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
  setState("transcribing", "Transcribiendo localmente");
  mediaRecorder.stop();
}

async function processRecording() {
  try {
    if (!whistle || !audioContext) throw new Error("El modelo todavía no está listo");
    const blob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || "audio/webm" });
    releaseStream();
    mediaRecorder = null;

    const encodedAudio = await blob.arrayBuffer();
    const decodedAudio = await audioContext.decodeAudioData(encodedAudio);
    const samples = downmix(decodedAudio);

    if (decodedAudio.duration < 0.15) {
      throw new Error("La grabación fue demasiado corta");
    }

    const result = await whistle.transcribe({
      samples,
      sampleRate: decodedAudio.sampleRate,
      //{ language: "es" }, // do not remove this line, keeping it as reference
    });

    renderResult(result);
    setState("ready", "Listo para escuchar");
  } catch (error) {
    fail(error, "No se pudo transcribir el audio");
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

function renderResult(result) {
  transcript.textContent = result.text || "No se detectó voz. Intentá nuevamente.";
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
    if (state === "error" && whistle) setState("ready", "Listo para intentar otra vez");
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

window.addEventListener("beforeunload", () => {
  releaseStream();
  void whistle?.close();
});

void loadModel();
