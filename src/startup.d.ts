interface Window {
  wavesStartup: {
    start(load: () => Promise<void | (() => void)>): void;
    ready(): void;
    fail(): void;
    dispose(): void;
  };
}
