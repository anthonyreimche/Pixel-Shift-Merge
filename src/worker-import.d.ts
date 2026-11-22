// Vite's inline worker import: the worker's code is bundled into the module,
// and the default export starts it from a blob URL.
declare module "*?worker&inline" {
  const InlineWorker: new (options?: { name?: string }) => Worker;
  export default InlineWorker;
}
