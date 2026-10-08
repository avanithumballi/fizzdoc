// Types for modules that ship without their own, or that are aliased in vite.config.ts.

// 'ort-webgpu' is ONNX Runtime's WebGPU build, aliased in vite.config.ts (the package name itself is
// pointed at the CPU build for Audio to Text). Same API as the package.
declare module 'ort-webgpu' {
  export * from 'onnxruntime-web';
}

// gifenc ships without types; these are the parts Fizzdoc uses.
declare module 'gifenc' {
  type Palette = number[][];
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number },
  ): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
