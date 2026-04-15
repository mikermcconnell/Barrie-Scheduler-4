export const buildDuplicateDraftName = (name: string): string => {
    const trimmed = name.trim() || 'Untitled Draft';
    const numberedMatch = trimmed.match(/^(.*)\s+\(Copy\s+(\d+)\)$/i);
    if (numberedMatch) {
        const baseName = numberedMatch[1].trim();
        const copyNumber = Number(numberedMatch[2]);
        return `${baseName} (Copy ${copyNumber + 1})`;
    }

    const singleCopyMatch = trimmed.match(/^(.*)\s+\(Copy\)$/i);
    if (singleCopyMatch) {
        const baseName = singleCopyMatch[1].trim();
        return `${baseName} (Copy 2)`;
    }

    return `${trimmed} (Copy)`;
};
