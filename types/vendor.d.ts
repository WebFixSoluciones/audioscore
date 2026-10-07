declare module "verovio/wasm" {
  const createModule: () => Promise<unknown>;
  export default createModule;
}
declare module "verovio/esm" {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    getPageCount(): number;
    renderToSVG(page: number, options?: Record<string, unknown>): string;
    getMEI(options?: Record<string, unknown>): string;
    destroy(): void;
  }
}
