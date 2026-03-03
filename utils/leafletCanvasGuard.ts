/**
 * Suppresses known Leaflet Canvas unmount race condition errors.
 *
 * When a map component unmounts while Leaflet is mid-redraw, the internal
 * canvas context becomes null, producing "Cannot read properties of null
 * (reading 'clearRect')" errors. These are harmless — the component is
 * already gone — but they pollute the console and can trigger error
 * monitoring alerts.
 *
 * Call once at app startup.
 */
export function installLeafletCanvasGuard(): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    const msg = event.message || '';
    const stack = event.error?.stack || '';

    const isCanvasNull =
      msg.includes('clearRect') ||
      msg.includes("Cannot read properties of null");

    const isLeafletStack =
      stack.includes('Canvas') ||
      stack.includes('_redraw') ||
      stack.includes('leaflet');

    if (isCanvasNull && isLeafletStack) {
      event.preventDefault();
      console.debug('[leaflet-canvas-guard] Suppressed Leaflet canvas unmount error');
    }
  });
}
