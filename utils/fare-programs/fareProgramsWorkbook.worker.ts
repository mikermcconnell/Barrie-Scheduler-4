import {
    extractFareProgramExactOrigins,
    extractFareProgramTransactions,
    type FareProgramExactOriginResult,
    type FareProgramTransactionResult,
} from './fareProgramsWorkbook';

interface FareProgramsWorkbookWorkerRequest {
    buffer: ArrayBuffer;
    fareType: string;
    mode?: 'transactions' | 'exact-origins';
}

type FareProgramsWorkbookWorkerResponse =
    | { ok: true; result: FareProgramTransactionResult | FareProgramExactOriginResult }
    | { ok: false; error: string };

const workerScope = self as unknown as {
    onmessage: ((event: MessageEvent<FareProgramsWorkbookWorkerRequest>) => void) | null;
    postMessage: (message: FareProgramsWorkbookWorkerResponse) => void;
};

workerScope.onmessage = (event) => {
    try {
        const result = event.data.mode === 'exact-origins'
            ? extractFareProgramExactOrigins(event.data.buffer, event.data.fareType)
            : extractFareProgramTransactions(event.data.buffer, event.data.fareType);
        workerScope.postMessage({ ok: true, result });
    } catch (cause) {
        workerScope.postMessage({
            ok: false,
            error: cause instanceof Error ? cause.message : 'Could not read the selected workbook.',
        });
    }
};
