async function loadBundledStopTimesText(): Promise<string> {
    if (import.meta.env.MODE === 'test') {
        const rawModule = await import('../../gtfs/stop_times.txt?raw');
        return rawModule.default;
    }

    const urlModule = await import('../../gtfs/stop_times.txt?url');
    const response = await fetch(urlModule.default);

    if (!response.ok) {
        throw new Error(`Failed to load bundled stop_times.txt (${response.status})`);
    }

    return response.text();
}

export const bundledStopTimesText = await loadBundledStopTimesText();
