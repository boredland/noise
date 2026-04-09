import { DeepFilterNet3Core } from "deepfilternet3-noise-filter";
import lamejs from "lamejs";
import * as Mp4Muxer from "mp4-muxer";

const swReady =
  "serviceWorker" in navigator
    ? navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready)
    : Promise.resolve();

const SAMPLE_RATE = 48000;
const PREVIEW_SECONDS = 60;
const MODEL_URL = new URL("./model", window.location.href).toString();

const $ = (id) => document.getElementById(id);

const isChromium = !!window.chrome;
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
if (!isChromium && !isSafari) {
  $("browserBanner").style.display = "block";
}
if (typeof AudioEncoder === "undefined") {
  formatSelect.querySelector('[value="m4a"]').disabled = true;
  formatSelect.querySelector('[value="m4a"]').textContent = "M4A (AAC) — not supported in this browser";
}

const dropZone = $("dropZone");
const fileInput = $("fileInput");
const levelSlider = $("levelSlider");
const levelValue = $("levelValue");
const previewBtn = $("previewBtn");
const processBtn = $("processBtn");
const progressSection = $("progressSection");
const statusLabel = $("statusLabel");
const statusDetail = $("statusDetail");
const progressBar = $("progressBar");
const resultSection = $("resultSection");
const originalAudio = $("originalAudio");
const filteredAudio = $("filteredAudio");
const downloadBtn = $("downloadBtn");
const resetBtn = $("resetBtn");
const errorEl = $("error");

const normalizeCheck = $("normalizeCheck");
const eqCheck = $("eqCheck");
const voiceWarning = $("voiceWarning");
const formatSelect = $("formatSelect");

let selectedFile = null;
let filteredBlobUrl = null;
let originalBlobUrl = null;
let decodedMono = null;
let previewState = null;
let lastMeasuredSpeed = 0;

function onSettingsChange() {
  if (selectedFile && resultSection.classList.contains("visible")) {
    previewBtn.disabled = false;
    processBtn.disabled = false;
  }
}

levelSlider.addEventListener("input", () => {
  levelValue.textContent = levelSlider.value;
  onSettingsChange();
});
normalizeCheck.addEventListener("change", onSettingsChange);
eqCheck.addEventListener("change", onSettingsChange);
formatSelect.addEventListener("change", onSettingsChange);

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () =>
  dropZone.classList.remove("dragover"),
);
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});
$("demoBtn").addEventListener("click", async () => {
  $("demoBtn").disabled = true;
  const response = await fetch("./demo.wav");
  const blob = await response.blob();
  handleFile(new File([blob], "demo_noisy_speech.wav", { type: "audio/wav" }));
});

async function handleFile(file) {
  selectedFile = file;
  decodedMono = null;
  dropZone.textContent = file.name;
  dropZone.classList.add("has-file");
  errorEl.classList.remove("visible");

  $("controlsSection").style.display = "";
  previewBtn.disabled = true;
  processBtn.disabled = true;
  levelSlider.disabled = true;
  statusLabel.textContent = "Analyzing audio…";
  statusDetail.textContent = "";
  progressBar.style.width = "0%";
  progressBar.classList.remove("done");
  progressBar.classList.add("indeterminate");
  progressSection.classList.add("visible");

  try {
    const mono = await decodeFile();
    const suggested = estimateNoiseLevel(mono);
    levelSlider.value = suggested;
    levelValue.textContent = suggested;

    const isSpeech = detectSpeech(mono);
    if (!isSpeech) {
      normalizeCheck.checked = false;
      eqCheck.checked = false;
      voiceWarning.style.display = "";
    } else {
      normalizeCheck.checked = true;
      eqCheck.checked = true;
      voiceWarning.style.display = "none";
    }

    levelSlider.disabled = false;
    previewBtn.disabled = false;
    processBtn.disabled = false;
    progressBar.classList.remove("indeterminate");
    progressSection.classList.remove("visible");
  } catch (err) {
    progressBar.classList.remove("indeterminate");
    console.error(err);
    showError(`Failed to analyze audio: ${err.message}`);
  }
}

previewBtn.addEventListener("click", () => togglePreview());
processBtn.addEventListener("click", () => processAudio());
resetBtn.addEventListener("click", () => {
  stopPreview();
  resultSection.classList.remove("visible");
  progressSection.classList.remove("visible");
  previewBtn.disabled = false;
  processBtn.disabled = false;
  revokeUrls();
});

downloadBtn.addEventListener("click", () => {
  if (!filteredBlobUrl) return;
  const a = document.createElement("a");
  a.href = filteredBlobUrl;
  const baseName = selectedFile.name.replace(/\.[^.]+$/, "");
  const fmt = resolveFormat();
  a.download = `${baseName}_filtered.${FORMAT_EXT[fmt]}`;
  a.click();
});

function revokeUrls() {
  if (filteredBlobUrl) URL.revokeObjectURL(filteredBlobUrl);
  if (originalBlobUrl) URL.revokeObjectURL(originalBlobUrl);
  filteredBlobUrl = null;
  originalBlobUrl = null;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add("visible");
  progressSection.classList.remove("visible");
  previewBtn.disabled = false;
  processBtn.disabled = false;
}

function setProgress(pct, label, detail) {
  progressBar.style.width = `${pct}%`;
  if (label) statusLabel.textContent = label;
  if (detail !== undefined) statusDetail.textContent = detail;
}

async function decodeFile() {
  if (decodedMono) return decodedMono;
  const arrayBuffer = await selectedFile.arrayBuffer();
  const decodeCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();
  decodedMono = mixToMono(audioBuffer);
  return decodedMono;
}

const coreReady = (async () => {
  await swReady;
  const core = new DeepFilterNet3Core({
    sampleRate: SAMPLE_RATE,
    noiseReductionLevel: 50,
    assetConfig: { cdnUrl: MODEL_URL },
  });
  await core.initialize();
  return core;
})();

async function getInitializedCore() {
  const core = await coreReady;
  core.setSuppressionLevel(parseInt(levelSlider.value));
  return core;
}

async function renderOffline(samples, onProgress, onStatusChange) {
  onStatusChange?.("Initializing DeepFilterNet3…");
  const core = await getInitializedCore();
  onStatusChange?.("Processing audio…");
  const duration = samples.length / SAMPLE_RATE;

  const offlineCtx = new OfflineAudioContext(1, samples.length, SAMPLE_RATE);
  const filterNode = await core.createAudioWorkletNode(offlineCtx);

  const source = offlineCtx.createBufferSource();
  const buf = offlineCtx.createBuffer(1, samples.length, SAMPLE_RATE);
  buf.getChannelData(0).set(samples);
  source.buffer = buf;

  source.connect(filterNode);
  filterNode.connect(offlineCtx.destination);

  const startWall = performance.now();
  let estimateTimer = null;

  const supportsCheckpoints = typeof offlineCtx.suspend === "function";
  if (supportsCheckpoints) {
    const checkpointInterval = 2;
    const checkpoints = Math.floor(duration / checkpointInterval);
    for (let i = 1; i <= checkpoints; i++) {
      const t = i * checkpointInterval;
      offlineCtx.suspend(t).then(() => {
        const pct = Math.round((t / duration) * 100);
        const elapsedWall = (performance.now() - startWall) / 1000;
        const speed = t / elapsedWall;
        lastMeasuredSpeed = speed;
        const remaining = (duration - t) / speed;
        onProgress(pct, `${pct}% — ~${formatTime(remaining)} remaining`);
        offlineCtx.resume();
      });
    }
  } else {
    const speed = lastMeasuredSpeed || 0.5;
    const estimatedTotal = duration / speed;
    estimateTimer = setInterval(() => {
      const elapsed = (performance.now() - startWall) / 1000;
      const pct = Math.min(95, Math.round((elapsed / estimatedTotal) * 100));
      const remaining = Math.max(0, estimatedTotal - elapsed);
      onProgress(pct, `~${pct}% — ~${formatTime(remaining)} remaining`);
    }, 500);
  }

  source.start(0);
  const renderedBuffer = await offlineCtx.startRendering();
  if (estimateTimer) clearInterval(estimateTimer);

  const elapsedTotal = (performance.now() - startWall) / 1000;
  if (duration > 0) lastMeasuredSpeed = duration / elapsedTotal;
  return renderedBuffer;
}

function detectSpeech(samples) {
  // Use bandpass energy ratio: speech concentrates energy in 300-3400Hz.
  // Apply simple Goertzel-like energy estimation on a few key bands.
  const windowSize = 2048;
  const numWindows = Math.min(20, Math.floor(samples.length / windowSize));

  let speechBandTotal = 0;
  let fullBandTotal = 0;

  for (let w = 0; w < numWindows; w++) {
    const offset = Math.floor((w / numWindows) * (samples.length - windowSize));

    // Measure energy in specific frequency bands using Goertzel
    for (let freq = 50; freq <= 8000; freq += 50) {
      const k = Math.round(freq * windowSize / SAMPLE_RATE);
      const omega = (2 * Math.PI * k) / windowSize;
      const coeff = 2 * Math.cos(omega);
      let s0 = 0, s1 = 0, s2 = 0;
      for (let n = 0; n < windowSize; n++) {
        s0 = samples[offset + n] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
      fullBandTotal += power;
      if (freq >= 300 && freq <= 3400) speechBandTotal += power;
    }
  }

  return fullBandTotal > 0 && (speechBandTotal / fullBandTotal) > 0.4;
}

async function applyVoiceOptimization(samples) {
  const doNormalize = normalizeCheck.checked;
  const doEq = eqCheck.checked;

  if (!doNormalize && !doEq) return samples;

  const offlineCtx = new OfflineAudioContext(1, samples.length, SAMPLE_RATE);

  const buf = offlineCtx.createBuffer(1, samples.length, SAMPLE_RATE);
  buf.getChannelData(0).set(samples);
  const source = offlineCtx.createBufferSource();
  source.buffer = buf;

  let chain = source;

  if (doEq) {
    const highpass = offlineCtx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;
    highpass.Q.value = 0.7;
    chain.connect(highpass);
    chain = highpass;

    const presence = offlineCtx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 3000;
    presence.Q.value = 1.0;
    presence.gain.value = 3;
    chain.connect(presence);
    chain = presence;
  }

  if (doNormalize) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
    }
    const gain = offlineCtx.createGain();
    gain.gain.value = peak > 0 ? 0.71 / peak : 1;
    chain.connect(gain);
    chain = gain;
  }

  chain.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

let previewAbort = null;

async function togglePreview() {
  if (previewState || previewAbort) {
    stopPreview();
    return;
  }

  if (!selectedFile) return;

  previewAbort = new AbortController();
  previewBtn.textContent = "Stop preview";
  processBtn.disabled = true;
  progressSection.classList.add("visible");
  progressBar.classList.remove("done");
  errorEl.classList.remove("visible");

  try {
    setProgress(0, "Decoding audio file…", "");
    const mono = await decodeFile();

    const previewSamples = mono.length > PREVIEW_SECONDS * SAMPLE_RATE
      ? mono.slice(0, PREVIEW_SECONDS * SAMPLE_RATE)
      : mono;

    setProgress(0, "Preparing…", "");

    const renderedBuffer = await renderOffline(previewSamples, (pct, detail) => {
      setProgress(pct, "Rendering preview…", detail);
    }, (status) => setProgress(0, status, ""));

    if (previewAbort?.signal.aborted) return;

    const previewDuration = previewSamples.length / SAMPLE_RATE;

    setProgress(95, "Optimizing voice…", "");
    const optimized = await applyVoiceOptimization(renderedBuffer.getChannelData(0));

    revokeUrls();
    filteredBlobUrl = URL.createObjectURL(encodeWav(optimized, SAMPLE_RATE));
    originalBlobUrl = URL.createObjectURL(encodeWav(previewSamples, SAMPLE_RATE));
    originalAudio.src = originalBlobUrl;
    filteredAudio.src = filteredBlobUrl;
    downloadBtn.style.display = "none";
    resultSection.classList.add("visible");

    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const playBuf = ctx.createBuffer(1, optimized.length, SAMPLE_RATE);
    playBuf.getChannelData(0).set(optimized);
    const source = ctx.createBufferSource();
    source.buffer = playBuf;
    source.connect(ctx.destination);

    const startTime = ctx.currentTime;
    source.start(0);

    const tickProgress = () => {
      if (!previewState) return;
      const elapsed = ctx.currentTime - startTime;
      const pct = Math.min(100, (elapsed / previewDuration) * 100);
      setProgress(pct, "Preview playing…", `${formatTime(elapsed)} / ${formatTime(previewDuration)}`);
      previewState.raf = requestAnimationFrame(tickProgress);
    };

    previewState = { ctx, source, raf: null };
    tickProgress();

    source.onended = () => stopPreview();
  } catch (err) {
    if (previewAbort?.signal.aborted) return;
    console.error(err);
    stopPreview();
    showError(`Preview failed: ${err.message}`);
  }
}

function stopPreview() {
  if (previewAbort) {
    previewAbort.abort();
    previewAbort = null;
  }
  if (previewState) {
    if (previewState.raf) cancelAnimationFrame(previewState.raf);
    try { previewState.source.stop(); } catch {}
    previewState.ctx.close();
    previewState = null;
  }
  previewBtn.textContent = "Preview (first 60s)";
  previewBtn.disabled = !selectedFile;
  processBtn.disabled = !selectedFile;
  progressSection.classList.remove("visible");
}

async function processAudio() {
  if (!selectedFile) return;

  stopPreview();
  previewBtn.disabled = true;
  processBtn.disabled = true;
  errorEl.classList.remove("visible");
  resultSection.classList.remove("visible");
  progressSection.classList.add("visible");
  progressBar.classList.remove("done");

  try {
    setProgress(0, "Decoding audio file…", "");
    const mono = await decodeFile();

    setProgress(0, "Preparing…", "");

    const renderedBuffer = await renderOffline(mono, (pct, detail) => {
      setProgress(pct, "Processing audio…", detail);
    }, (status) => setProgress(0, status, ""));

    setProgress(90, "Optimizing voice…", "");
    const optimized = await applyVoiceOptimization(renderedBuffer.getChannelData(0));

    setProgress(95, `Encoding ${resolveFormat().toUpperCase()}…`, "");
    const outputBlob = await encodeAudio(optimized, SAMPLE_RATE);

    revokeUrls();
    filteredBlobUrl = URL.createObjectURL(outputBlob);
    originalBlobUrl = URL.createObjectURL(selectedFile);
    originalAudio.src = originalBlobUrl;
    filteredAudio.src = filteredBlobUrl;

    progressBar.classList.add("done");
    setProgress(100, "Done!", "");
    downloadBtn.style.display = "";
    resultSection.classList.add("visible");
  } catch (err) {
    console.error(err);
    showError(`Processing failed: ${err.message}`);
  }
}

function estimateNoiseLevel(samples) {
  const windowSize = Math.floor(SAMPLE_RATE * 0.05);
  const numWindows = Math.floor(samples.length / windowSize);
  const rmsValues = new Float32Array(numWindows);

  for (let w = 0; w < numWindows; w++) {
    let sum = 0;
    const offset = w * windowSize;
    for (let i = 0; i < windowSize; i++) {
      const s = samples[offset + i];
      sum += s * s;
    }
    rmsValues[w] = Math.sqrt(sum / windowSize);
  }

  const sorted = Array.from(rmsValues).sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(numWindows * 0.1)];
  const signalLevel = sorted[Math.floor(numWindows * 0.9)];

  if (noiseFloor === 0 || signalLevel === 0) return 50;

  const snrDb = 20 * Math.log10(signalLevel / noiseFloor);
  return Math.round(Math.max(5, Math.min(95, 100 - snrDb * 2.5)));
}

function mixToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0).slice();
  }
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  const channels = audioBuffer.numberOfChannels;
  for (let ch = 0; ch < channels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] / channels;
    }
  }
  return mono;
}

const FORMAT_EXT = { wav: "wav", mp3: "mp3", m4a: "m4a" };
const FORMAT_MIME = { wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4" };

function resolveFormat() {
  const choice = formatSelect.value;
  if (choice !== "auto") return choice;
  if (!selectedFile) return "wav";
  const ext = selectedFile.name.split(".").pop().toLowerCase();
  if (ext === "mp3") return "mp3";
  if (ext === "m4a" || ext === "aac" || ext === "mp4") return "m4a";
  return "wav";
}

async function encodeAudio(samples, sampleRate) {
  const fmt = resolveFormat();
  if (fmt === "mp3") return encodeMp3(samples, sampleRate);
  if (fmt === "m4a") return encodeM4a(samples, sampleRate);
  return encodeWav(samples, sampleRate);
}

function encodeMp3(samples, sampleRate) {
  const mp3enc = new lamejs.Mp3Encoder(1, sampleRate, 192);
  const blockSize = 1152;
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    int16[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
  }

  const chunks = [];
  for (let i = 0; i < int16.length; i += blockSize) {
    const block = int16.subarray(i, i + blockSize);
    const buf = mp3enc.encodeBuffer(block);
    if (buf.length > 0) chunks.push(buf);
  }
  const end = mp3enc.flush();
  if (end.length > 0) chunks.push(end);

  return new Blob(chunks, { type: "audio/mpeg" });
}

async function encodeM4a(samples, sampleRate) {
  if (typeof AudioEncoder === "undefined") {
    return encodeWav(samples, sampleRate);
  }

  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    int16[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
  }

  const target = new Mp4Muxer.ArrayBufferTarget();
  const muxer = new Mp4Muxer.Muxer({
    target,
    audio: { codec: "aac", sampleRate, numberOfChannels: 1 },
    fastStart: "in-memory",
  });

  const chunks = [];
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => console.error("AudioEncoder error:", e),
  });

  encoder.configure({
    codec: "mp4a.40.2",
    sampleRate,
    numberOfChannels: 1,
    bitrate: 192000,
  });

  const frameSize = 1024;
  for (let i = 0; i < samples.length; i += frameSize) {
    const end = Math.min(i + frameSize, samples.length);
    const frameData = new Float32Array(end - i);
    frameData.set(samples.subarray(i, end));
    const audioData = new AudioData({
      format: "f32",
      sampleRate,
      numberOfFrames: frameData.length,
      numberOfChannels: 1,
      timestamp: (i / sampleRate) * 1_000_000,
      data: frameData,
    });
    encoder.encode(audioData);
    audioData.close();
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  return new Blob([target.buffer], { type: "audio/mp4" });
}

function encodeWav(samples, sampleRate) {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
