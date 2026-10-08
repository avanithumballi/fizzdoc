// 'ort-webgpu' is ONNX Runtime's WebGPU build, aliased in vite.config.ts (the package name itself is
// pointed at the CPU build for Audio to Text). Same API as the package.
declare module 'ort-webgpu' {
  export * from 'onnxruntime-web';
}
