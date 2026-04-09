# Noise

Browser-based audio noise reduction powered by [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet). Runs entirely client-side via WebAssembly — no uploads, no server. Your audio files never leave your device.

**[Try it live](https://noise.jonas-strassel.de/)**

## Features

- Drag & drop any audio file or try the built-in demo
- Auto-suggested noise reduction level based on SNR analysis
- Speech detection with automatic voice optimization (EQ + loudness normalization)
- Preview the first 60 seconds with before/after comparison
- Offline processing for the full file (faster than real-time)
- Multiple output formats: WAV, MP3, M4A (AAC), OGG (Opus)
- "Same as input" format auto-detection
- Progress reporting with time estimates
- Model assets cached via Service Worker after first load (~17 MB)
- Respects browser light/dark mode

## Browser compatibility

Works best in **Chrome** and **Safari**. Firefox is significantly slower for WASM workloads (~3x), resulting in much longer processing times. See [Firefox Bug 1539865](https://bugzilla.mozilla.org/show_bug.cgi?id=1539865) and [onnxruntime#10134](https://github.com/microsoft/onnxruntime/issues/10134) for details.

M4A and OGG output formats require the [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder) (Chrome/Safari only).

## Development

```sh
npm install
npm run dev
```

## Deployment

Pushes to `main` automatically deploy to GitHub Pages via the included workflow.

## Credits

- [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) by Hendrik Schröter
- [deepfilternet3-noise-filter](https://www.npmjs.com/package/deepfilternet3-noise-filter) WASM/AudioWorklet wrapper by Mezon
- [@breezystack/lamejs](https://www.npmjs.com/package/@breezystack/lamejs) MP3 encoding
- [mp4-muxer](https://www.npmjs.com/package/mp4-muxer) / [webm-muxer](https://www.npmjs.com/package/webm-muxer) by Vanilagy
