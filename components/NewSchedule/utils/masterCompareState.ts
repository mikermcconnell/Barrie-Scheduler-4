import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';

export interface MasterCompareScope {
    routeIdentity: string;
    editorSessionKey: number;
}

interface MasterCompareResultLike {
    content?: {
        northTable?: MasterRouteTable;
        southTable?: MasterRouteTable;
    };
}

export const createMasterCompareScope = (
    routeIdentity: string,
    editorSessionKey: number
): MasterCompareScope => ({
    routeIdentity,
    editorSessionKey,
});

export const shouldClearMasterCompare = (
    scope: MasterCompareScope | null,
    currentRouteIdentity: string | undefined,
    currentEditorSessionKey: number
): boolean => {
    if (!scope) return false;
    return (
        scope.routeIdentity !== currentRouteIdentity
        || scope.editorSessionKey !== currentEditorSessionKey
    );
};

export const extractMasterCompareBaseline = (
    result: MasterCompareResultLike | null | undefined
): MasterRouteTable[] | null => {
    const tables = [
        result?.content?.northTable,
        result?.content?.southTable,
    ].filter((table): table is MasterRouteTable => !!table);

    if (tables.length === 0) return null;
    return tables;
};
