import { DeepFilterNet3Core } from "deepfilternet3-noise-filter";

const SAMPLE_RATE = 48000;

const $ = (id) => document.getElementById(id);

const dropZone = $("dropZone");
const fileInput = $("fileInput");
const levelSlider = $("levelSlider");
const levelValue = $("levelValue");
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

function handleFile(file) {
  selectedFile = file;
  dropZone.textContent = file.name;
  dropZone.classList.add("has-file");
  processBtn.disabled = false;
  errorEl.classList.remove("visible");
}

processBtn.addEventListener("click", () => processAudio());
resetBtn.addEventListener("click", () => {
  resultSection.classList.remove("visible");
  progressSection.classList.remove("visible");
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
  processBtn.disabled = false;
}

function setProgress(pct, label, detail) {
  progressBar.style.width = `${pct}%`;
  if (label) statusLabel.textContent = label;
  if (detail !== undefined) statusDetail.textContent = detail;
}

async function processAudio() {
  if (!selectedFile) return;

  processBtn.disabled = true;
  errorEl.classList.remove("visible");
  resultSection.classList.remove("visible");
  progressSection.classList.add("visible");
  progressBar.classList.remove("done");

  try {
    setProgress(5, "Decoding audio file…", "");

    const arrayBuffer = await selectedFile.arrayBuffer();
    const decodeCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
    await decodeCtx.close();

    const mono = mixToMono(audioBuffer);
    const duration = audioBuffer.duration;

    setProgress(15, "Initializing DeepFilterNet3…", "Loading WASM + model (~15 MB)");

    const core = new DeepFilterNet3Core({
      sampleRate: SAMPLE_RATE,
      noiseReductionLevel: parseInt(levelSlider.value),
      assetConfig: {
        cdnUrl: new URL("./model", window.location.href).toString(),
      },
    });
    await core.initialize();

    setProgress(30, "Processing audio…", `0:00 / ${formatTime(duration)}`);

    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const filterNode = await core.createAudioWorkletNode(ctx);

    const filtered = await processOffline(ctx, filterNode, mono, duration, (pct, time) => {
      const overall = 30 + pct * 0.65;
      setProgress(overall, "Processing audio…", `${formatTime(time)} / ${formatTime(duration)}`);
    });

    core.destroy();
    await ctx.close();

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

function processOffline(ctx, filterNode, samples, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const chunkSize = 128;
    const totalSamples = samples.length;
    const output = new Float32Array(totalSamples);
    let writePos = 0;
    let readPos = 0;

    const source = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, totalSamples, SAMPLE_RATE);
    buf.getChannelData(0).set(samples);
    source.buffer = buf;

    const recorder = ctx.createScriptProcessor(4096, 1, 1);
    recorder.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const remaining = totalSamples - writePos;
      const toCopy = Math.min(input.length, remaining);
      output.set(input.subarray(0, toCopy), writePos);
      writePos += toCopy;

      const elapsed = writePos / SAMPLE_RATE;
      onProgress(writePos / totalSamples, elapsed);

      if (writePos >= totalSamples) {
        source.stop();
        recorder.disconnect();
        filterNode.disconnect();
        resolve(output);
      }
    };

    source.connect(filterNode);
    filterNode.connect(recorder);
    recorder.connect(ctx.destination);

    source.start(0);
  });
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
