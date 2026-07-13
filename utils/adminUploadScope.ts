import type { SavedFile } from './services/dataService';

export function filterUploadsForTeam(files: SavedFile[], teamId?: string): SavedFile[] {
    if (!teamId) return [];
    return files.filter(file => file.resolvedTeamId === teamId);
}
