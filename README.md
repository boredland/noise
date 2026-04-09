# Noise

Browser-based audio noise reduction powered by [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet). Runs entirely client-side via WebAssembly — no uploads, no server.

**[Try it live](https://noise.jonas-strassel.de/)**

## Features

- Drag & drop any audio file
- Auto-suggested noise reduction level based on SNR analysis
- Real-time preview of the first 60 seconds
- Offline processing for the full file (faster than real-time)
- Download the filtered result as WAV
- Model assets cached via Service Worker after first load (~17 MB)
- Respects browser light/dark mode

## Browser compatibility

Works best in **Chrome** and **Safari**. Firefox is significantly slower for WASM workloads (~3x), resulting in much longer processing times. See [Firefox Bug 1539865](https://bugzilla.mozilla.org/show_bug.cgi?id=1539865) and [onnxruntime#10134](https://github.com/microsoft/onnxruntime/issues/10134) for details.

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
