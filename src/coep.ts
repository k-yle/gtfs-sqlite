export enum CoepStatus {
  OK,
  ERROR,
  NEEDS_RELOAD,
}

export async function checkCoepStatus(): Promise<CoepStatus> {
  try {
    if (window.crossOriginIsolated !== false) return CoepStatus.OK;
    if (!window.isSecureContext) return CoepStatus.ERROR;

    await navigator.serviceWorker.register(
      new URL('sw.worker.ts', import.meta.url),
    );

    return CoepStatus.NEEDS_RELOAD;
  } catch (ex) {
    console.error(ex);
    return CoepStatus.ERROR;
  }
}
