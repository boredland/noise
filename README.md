# DeepFilter Web

Browser-based audio noise reduction powered by [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet). Runs entirely client-side via WebAssembly — no uploads, no server.

**[Try it live](https://boredland.github.io/deepfilter-web/)**

## Features

- Drag & drop any audio file
- Auto-suggested noise reduction level based on SNR analysis
- Real-time preview of the first 60 seconds
- Offline processing for the full file (faster than real-time)
- Download the filtered result as WAV
- Model assets cached via Service Worker after first load (~17 MB)
- Respects browser light/dark mode

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
