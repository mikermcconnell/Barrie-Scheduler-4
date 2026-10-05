import Dexie, { type Table } from 'dexie';
import { assertProject, clone, type Project } from './domain';

interface StoredProject { id: string; revision: number; project: Project; previous?: Project }
class StudioDatabase extends Dexie { projects!: Table<StoredProject, string>; constructor() { super('street-design-studio-v1'); this.version(1).stores({ projects: 'id' }); } }
const database = new StudioDatabase();
export async function loadProject(id: string): Promise<{ project: Project; storageRevision: number } | null> { const row = await database.projects.get(id); if (!row) return null; assertProject(row.project); return { project: clone(row.project), storageRevision: row.revision }; }
export async function saveProject(project: Project, expectedRevision: number): Promise<number> {
  assertProject(project);
  return database.transaction('rw', database.projects, async () => {
    const current = await database.projects.get(project.id);
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error('Another tab saved a newer version. Export a backup or reload before saving.');
    const revision = expectedRevision + 1;
    await database.projects.put({ id: project.id, revision, project: clone(project), previous: current?.project });
    return revision;
  });
}
