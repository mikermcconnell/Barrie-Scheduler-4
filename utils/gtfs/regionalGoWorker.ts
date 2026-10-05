import { parseRegionalGoZip } from './regionalGoParser';

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    try {
        self.postMessage({ feed: parseRegionalGoZip(event.data) });
    } catch (error) {
        // Fixed, useful client error; never forward downloaded feed text or internals.
        self.postMessage({ error: error instanceof Error && error.message.startsWith('GO schedule data is invalid')
            ? error.message : 'GO schedule data is invalid (ZIP processing failed). Please try again.' });
    }
};
