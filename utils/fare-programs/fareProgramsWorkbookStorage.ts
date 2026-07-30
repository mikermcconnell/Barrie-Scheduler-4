const DATABASE_NAME = 'scheduler4-fare-programs';
const DATABASE_VERSION = 1;
const WORKBOOK_STORE = 'workbooks';
const HIGH_SCHOOL_WORKBOOK_KEY = 'high-school-pass-source';

interface StoredFareProgramsWorkbook {
    key: string;
    name: string;
    type: string;
    lastModified: number;
    savedAt: number;
    blob: Blob;
}

function getIndexedDb(factory?: IDBFactory): IDBFactory | null {
    if (factory) return factory;
    return typeof indexedDB === 'undefined' ? null : indexedDB;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
    });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage transaction was aborted.'));
        transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed.'));
    });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(WORKBOOK_STORE)) {
                request.result.createObjectStore(WORKBOOK_STORE, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
        request.onblocked = () => reject(new Error('Browser storage is blocked by another open app window.'));
    });
}

async function withWorkbookStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
    factory?: IDBFactory,
): Promise<T | null> {
    const indexedDb = getIndexedDb(factory);
    if (!indexedDb) return null;

    const database = await openDatabase(indexedDb);
    try {
        const transaction = database.transaction(WORKBOOK_STORE, mode);
        const request = operation(transaction.objectStore(WORKBOOK_STORE));
        const [result] = await Promise.all([
            requestResult(request),
            transactionComplete(transaction),
        ]);
        return result;
    } finally {
        database.close();
    }
}

export async function saveFareProgramsWorkbook(
    file: File,
    factory?: IDBFactory,
): Promise<boolean> {
    const record: StoredFareProgramsWorkbook = {
        key: HIGH_SCHOOL_WORKBOOK_KEY,
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        savedAt: Date.now(),
        blob: file,
    };
    const result = await withWorkbookStore('readwrite', (store) => store.put(record), factory);
    return result !== null;
}

export async function loadFareProgramsWorkbook(factory?: IDBFactory): Promise<File | null> {
    const record = await withWorkbookStore<StoredFareProgramsWorkbook | undefined>(
        'readonly',
        (store) => store.get(HIGH_SCHOOL_WORKBOOK_KEY),
        factory,
    );
    if (!record) return null;
    return new File([record.blob], record.name, {
        type: record.type,
        lastModified: record.lastModified,
    });
}

export async function removeFareProgramsWorkbook(factory?: IDBFactory): Promise<boolean> {
    const result = await withWorkbookStore(
        'readwrite',
        (store) => store.delete(HIGH_SCHOOL_WORKBOOK_KEY),
        factory,
    );
    return result !== null;
}
