# Glass Lab validation

Open View → Glass Lab (experimental) in the desktop app. Its controls are a mock-up and do not control playback. The shader refracts only the lab's procedural scene, built-in test pattern, or the accessible current cover, not the application's DOM. Album loading requires a readable image (including CORS permission). The drawElement check is only a feature-symbol probe, not a functional HTML-in-Canvas test.

`node --test scripts/glass-lab/contrast.test.mjs` checks the specified text/scrim colors on the worst-case white backdrop, not a screenshot or every app state.

For a headless WGSL/pipeline validation with the Dawn null backend:

```
npm install --no-save --ignore-scripts webgpu
node scripts/glass-lab/validate-shader.mjs
```

The null backend checks validation, not actual GPU pixels, driver support or performance. The report measures CPU submission and, if timestamp-query is supported, GPU time for the entire lab render pass (background plus glass). The GPU time includes the procedural background, horizontal and vertical half-resolution blur, and the final glass pass; unsupported GPU timings are explicitly unavailable. The four-second measurement stops if the window is hidden. At rest, no frame loop runs.

The fork's Windows test workflow is read-only and uploads an artifact, not a release. It uses a separate installer identity and removes upstream update/repair paths. It intentionally does not include the upstream maintenance installer; existing release workflows are not adapted for the test package and should not be used to publish it.
