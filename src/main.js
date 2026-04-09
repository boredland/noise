import { DeepFilterNet3Core } from "deepfilternet3-noise-filter";

const swReady =
  "serviceWorker" in navigator
    ? navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready)
    : Promise.resolve();

const SAMPLE_RATE = 48000;
const PREVIEW_SECONDS = 60;

const $ = (id) => document.getElementById(id);

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

let selectedFile = null;
let filteredBlobUrl = null;
let decodedMono = null;
let previewState = null;

levelSlider.addEventListener("input", () => {
  levelValue.textContent = levelSlider.value;
});

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
  progressSection.classList.add("visible");

  try {
    const mono = await decodeFile();
    const suggested = estimateNoiseLevel(mono);
    levelSlider.value = suggested;
    levelValue.textContent = suggested;
    levelSlider.disabled = false;
    previewBtn.disabled = false;
    processBtn.disabled = false;
    progressSection.classList.remove("visible");
  } catch {}
}

previewBtn.addEventListener("click", () => togglePreview());
processBtn.addEventListener("click", () => processAudio());
resetBtn.addEventListener("click", () => {
  stopPreview();
  resultSection.classList.remove("visible");
  progressSection.classList.remove("visible");
  previewBtn.disabled = false;
  processBtn.disabled = false;
  if (filteredBlobUrl) URL.revokeObjectURL(filteredBlobUrl);
  filteredBlobUrl = null;
});

downloadBtn.addEventListener("click", () => {
  if (!filteredBlobUrl) return;
  const a = document.createElement("a");
  a.href = filteredBlobUrl;
  const baseName = selectedFile.name.replace(/\.[^.]+$/, "");
  a.download = `${baseName}_filtered.wav`;
  a.click();
});

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

function createCore() {
  return new DeepFilterNet3Core({
    sampleRate: SAMPLE_RATE,
    noiseReductionLevel: parseInt(levelSlider.value),
    assetConfig: {
      cdnUrl: new URL("./model", window.location.href).toString(),
    },
  });
}

async function togglePreview() {
  if (previewState) {
    stopPreview();
    return;
  }

  if (!selectedFile) return;

  previewBtn.textContent = "Stop preview";
  processBtn.disabled = true;
  progressSection.classList.add("visible");
  progressBar.classList.remove("done");
  errorEl.classList.remove("visible");

  try {
    setProgress(10, "Decoding audio file…", "");
    const mono = await decodeFile();

    setProgress(30, "Initializing DeepFilterNet3…", "Loading WASM + model (~15 MB)");
    await swReady;
    const core = createCore();
    await core.initialize();

    setProgress(50, "Starting preview…", "Playing first 60s through filter");

    const previewSamples = mono.length > PREVIEW_SECONDS * SAMPLE_RATE
      ? mono.slice(0, PREVIEW_SECONDS * SAMPLE_RATE)
      : mono;

    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const filterNode = await core.createAudioWorkletNode(ctx);

    const source = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, previewSamples.length, SAMPLE_RATE);
    buf.getChannelData(0).set(previewSamples);
    source.buffer = buf;

    source.connect(filterNode);
    filterNode.connect(ctx.destination);

    const startTime = ctx.currentTime;
    source.start(0);

    const previewDuration = previewSamples.length / SAMPLE_RATE;

    const tickProgress = () => {
      if (!previewState) return;
      const elapsed = ctx.currentTime - startTime;
      const pct = Math.min(100, (elapsed / previewDuration) * 100);
      setProgress(pct, "Preview playing…", `${formatTime(elapsed)} / ${formatTime(previewDuration)}`);
      previewState.raf = requestAnimationFrame(tickProgress);
    };

    previewState = { ctx, source, core, raf: null };
    tickProgress();

    source.onended = () => stopPreview();
  } catch (err) {
    console.error(err);
    stopPreview();
    showError(`Preview failed: ${err.message}`);
  }
}

function stopPreview() {
  if (previewState) {
    if (previewState.raf) cancelAnimationFrame(previewState.raf);
    try { previewState.source.stop(); } catch {}
    previewState.core.destroy();
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
    setProgress(5, "Decoding audio file…", "");
    const mono = await decodeFile();

    setProgress(15, "Initializing DeepFilterNet3…", "Loading WASM + model (~15 MB)");
    await swReady;
    const core = createCore();
    await core.initialize();

    setProgress(30, "Processing audio…", "0%");

    const duration = mono.length / SAMPLE_RATE;
    const offlineCtx = new OfflineAudioContext(1, mono.length, SAMPLE_RATE);
    const filterNode = await core.createAudioWorkletNode(offlineCtx);

    const source = offlineCtx.createBufferSource();
    const buf = offlineCtx.createBuffer(1, mono.length, SAMPLE_RATE);
    buf.getChannelData(0).set(mono);
    source.buffer = buf;

    source.connect(filterNode);
    filterNode.connect(offlineCtx.destination);

    const CHECKPOINT_INTERVAL = 5;
    const checkpoints = Math.floor(duration / CHECKPOINT_INTERVAL);
    for (let i = 1; i <= checkpoints; i++) {
      const t = i * CHECKPOINT_INTERVAL;
      offlineCtx.suspend(t).then(() => {
        const pct = Math.round((t / duration) * 100);
        setProgress(30 + pct * 0.65, "Processing audio…", `${pct}%`);
        offlineCtx.resume();
      });
    }

    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const filtered = renderedBuffer.getChannelData(0);

    core.destroy();

    setProgress(98, "Encoding WAV…", "");
    const wavBlob = encodeWav(filtered, SAMPLE_RATE);

    if (filteredBlobUrl) URL.revokeObjectURL(filteredBlobUrl);
    filteredBlobUrl = URL.createObjectURL(wavBlob);

    const originalUrl = URL.createObjectURL(selectedFile);
    originalAudio.src = originalUrl;
    filteredAudio.src = filteredBlobUrl;

    progressBar.classList.add("done");
    setProgress(100, "Done!", "");
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

  // Low SNR (noisy) -> high reduction, high SNR (clean) -> low reduction
  // SNR ~5dB  -> 90 (very noisy)
  // SNR ~15dB -> 60 (moderate)
  // SNR ~30dB -> 20 (fairly clean)
  // SNR ~40dB+-> 10 (very clean)
  const level = Math.round(Math.max(5, Math.min(95, 100 - snrDb * 2.5)));
  return level;
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
