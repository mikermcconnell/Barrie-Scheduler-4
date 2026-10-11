import { stableStringify } from './masterAdapter';

export const serializeOperationsPlanningInput = (value: unknown): string => JSON.stringify(value, null, 2);
export const serializeOperationsPlanningProposal = (value: unknown): string => JSON.stringify(value, null, 2);
export const canonicalOperationsPlanningJson = (value: unknown): string => stableStringify(value);

export const downloadJson = (filename: string, value: unknown): void => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
};
