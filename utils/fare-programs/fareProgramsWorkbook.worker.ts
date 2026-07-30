import {
    extractFareProgramTransactions,
    type FareProgramTransactionResult,
} from './fareProgramsWorkbook';

interface FareProgramsWorkbookWorkerRequest {
    buffer: ArrayBuffer;
    fareType: string;
}

type FareProgramsWorkbookWorkerResponse =
    | { ok: true; result: FareProgramTransactionResult }
    | { ok: false; error: string };

const workerScope = self as unknown as {
    onmessage: ((event: MessageEvent<FareProgramsWorkbookWorkerRequest>) => void) | null;
    postMessage: (message: FareProgramsWorkbookWorkerResponse) => void;
};

workerScope.onmessage = (event) => {
    try {
        const result = extractFareProgramTransactions(event.data.buffer, event.data.fareType);
        workerScope.postMessage({ ok: true, result });
    } catch (cause) {
        workerScope.postMessage({
            ok: false,
            error: cause instanceof Error ? cause.message : 'Could not read the selected workbook.',
        });
    }
};
