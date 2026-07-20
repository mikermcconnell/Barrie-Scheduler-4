import {
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    type DocumentData,
    type DocumentReference,
} from 'firebase/firestore';

import { db } from '../firebase';
import {
    ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION,
    type ConceptStop,
    type RouteConceptAlternative,
    type RouteConceptPattern,
    type RouteConceptPoint,
    type RouteConceptProject,
    type RouteConceptProjectStatus,
    type RouteConceptSegmentRuntimeEvidence,
    type RouteConceptSegmentRuntimeOverride,
    type RouteConceptServiceAssumptions,
} from './routeConceptPlannerTypes';

const PROJECTS_COLLECTION = 'routeConceptPlannerProjects';
const ALTERNATIVES_COLLECTION = 'alternatives';
const PATTERNS_COLLECTION = 'patterns';

export type RouteConceptConflictResolution = 'reload' | 'save-as-copy';

export class RouteConceptPersistenceConflictError extends Error {
    readonly code = 'revision-conflict';
    readonly resolutions: RouteConceptConflictResolution[] = ['reload', 'save-as-copy'];

    constructor(
        readonly projectId: string,
        readonly expectedRevision: number,
        readonly actualRevision: number | null,
    ) {
        super(`Route concept project ${projectId} changed since it was loaded.`);
        this.name = 'RouteConceptPersistenceConflictError';
    }
}

export class RouteConceptPersistenceValidationError extends Error {
    readonly code = 'invalid-project-data';

    constructor(message: string) {
        super(message);
        this.name = 'RouteConceptPersistenceValidationError';
    }
}

export interface RouteConceptSavedProjectSummary {
    id: string;
    name: string;
    status: RouteConceptProjectStatus;
    revision: number;
    selectedAlternativeId: string;
    preferredAlternativeId?: string;
    alternativeOrder: string[];
    alternativeCount: number;
    createdAt: string;
    updatedAt: string;
    updatedBy?: string;
}

type StoredAlternativePayload = Omit<RouteConceptAlternative, 'patterns'>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const allowed = new Set(keys);
    return Object.keys(value).every((key) => allowed.has(key));
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
    return Number.isInteger(value) && isFiniteNumber(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(isString);
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
    return typeof value === 'string' && values.includes(value as T);
}

function optionalString(value: unknown): value is string | undefined {
    return value === undefined || isString(value);
}

function timestampToIso(value: unknown): string | null {
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (isRecord(value) && typeof value.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    }
    return null;
}

function stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(stripUndefinedDeep) as T;
    }
    if (isRecord(value)) {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return value;
        const output: Record<string, unknown> = {};
        Object.entries(value).forEach(([key, entry]) => {
            if (entry !== undefined) output[key] = stripUndefinedDeep(entry);
        });
        return output as T;
    }
    return value;
}

function isPoint(value: unknown): value is RouteConceptPoint {
    return isRecord(value) && hasOnlyKeys(value, ['id', 'lat', 'lng', 'sequence', 'afterStopId', 'beforeStopId', 'segmentSequence']) &&
        isString(value.id) && isFiniteNumber(value.lat) && value.lat >= -90 && value.lat <= 90 &&
        isFiniteNumber(value.lng) && value.lng >= -180 && value.lng <= 180 &&
        isFiniteNumber(value.sequence) && optionalString(value.afterStopId) && optionalString(value.beforeStopId) &&
        (value.segmentSequence === undefined || isFiniteNumber(value.segmentSequence));
}

function isStop(value: unknown): value is ConceptStop {
    return isRecord(value) && hasOnlyKeys(value, ['id', 'name', 'lat', 'lng', 'sequence', 'role', 'source', 'stopCode', 'notes']) &&
        isString(value.id) && isString(value.name) && isFiniteNumber(value.lat) && value.lat >= -90 && value.lat <= 90 &&
        isFiniteNumber(value.lng) && value.lng >= -180 && value.lng <= 180 && isFiniteNumber(value.sequence) &&
        isEnum(value.role, ['regular', 'timed', 'start-terminal', 'end-terminal', 'turnaround']) &&
        isEnum(value.source, ['custom', 'gtfs']) && optionalString(value.stopCode) && optionalString(value.notes);
}

function isRuntimeEvidence(value: unknown): value is RouteConceptSegmentRuntimeEvidence {
    return isRecord(value) && hasOnlyKeys(value, [
        'id', 'fromStopId', 'toStopId', 'runtimeMinutes', 'source', 'pathFingerprint', 'dayType',
        'planningPeriod', 'sampleSize', 'distanceKm', 'updatedAt', 'fallbackReason',
    ]) && isString(value.id) && isString(value.fromStopId) && isString(value.toStopId) &&
        isFiniteNumber(value.runtimeMinutes) && value.runtimeMinutes >= 0 &&
        isEnum(value.source, ['gtfs', 'mapbox', 'fallback']) && optionalString(value.pathFingerprint) &&
        (value.dayType === undefined || isEnum(value.dayType, ['weekday', 'saturday', 'sunday'])) &&
        (value.planningPeriod === undefined || isEnum(value.planningPeriod, ['all-day', 'am-peak', 'midday', 'pm-peak', 'evening'])) &&
        (value.sampleSize === undefined || isNonNegativeInteger(value.sampleSize)) &&
        (value.distanceKm === undefined || (isFiniteNumber(value.distanceKm) && value.distanceKm >= 0)) &&
        optionalString(value.updatedAt) && optionalString(value.fallbackReason);
}

function isRuntimeOverride(value: unknown): value is RouteConceptSegmentRuntimeOverride {
    return isRecord(value) && hasOnlyKeys(value, ['runtimeMinutes', 'confirmed', 'pathFingerprint', 'notes', 'updatedAt']) &&
        isFiniteNumber(value.runtimeMinutes) && value.runtimeMinutes >= 0 &&
        typeof value.confirmed === 'boolean' && optionalString(value.pathFingerprint) && optionalString(value.notes) &&
        isString(value.updatedAt);
}

function isStringRecord(value: unknown): value is Record<string, string> {
    return isRecord(value) && Object.values(value).every(isString);
}

function isOverrideRecord(value: unknown): value is Record<string, RouteConceptSegmentRuntimeOverride> {
    return isRecord(value) && Object.values(value).every(isRuntimeOverride);
}

function isPattern(value: unknown): value is RouteConceptPattern {
    if (!isRecord(value) || !hasOnlyKeys(value, [
        'id', 'name', 'role', 'alignment', 'stops', 'segmentFingerprints', 'runtimeEvidence',
        'runtimeOverrides', 'source', 'notes', 'createdAt', 'updatedAt',
    ]) || !isString(value.id) || !isString(value.name) ||
        !isEnum(value.role, ['outbound', 'inbound', 'loop', 'out-and-back']) ||
        !Array.isArray(value.alignment) || !value.alignment.every(isPoint) ||
        !Array.isArray(value.stops) || !value.stops.every(isStop) ||
        (value.segmentFingerprints !== undefined && !isStringRecord(value.segmentFingerprints)) ||
        !Array.isArray(value.runtimeEvidence) || !value.runtimeEvidence.every(isRuntimeEvidence) ||
        !isOverrideRecord(value.runtimeOverrides) || !isString(value.notes) ||
        !isString(value.createdAt) || !isString(value.updatedAt)) return false;

    if (value.source === undefined) return true;
    return isRecord(value.source) && hasOnlyKeys(value.source, [
        'type', 'routeId', 'routeShortName', 'serviceId', 'directionId', 'shapeId', 'feedVersion', 'importedAt',
    ]) && isEnum(value.source.type, ['blank', 'gtfs']) &&
        optionalString(value.source.routeId) && optionalString(value.source.routeShortName) &&
        optionalString(value.source.serviceId) &&
        (value.source.directionId === undefined || isFiniteNumber(value.source.directionId)) &&
        optionalString(value.source.shapeId) && optionalString(value.source.feedVersion) &&
        optionalString(value.source.importedAt);
}

function isService(value: unknown): value is RouteConceptServiceAssumptions {
    return isRecord(value) && hasOnlyKeys(value, [
        'firstDepartureMinutes', 'lastDepartureMinutes', 'frequencyMinutes', 'testedBuses',
        'startTerminalLayoverMinutes', 'endTerminalLayoverMinutes', 'intermediateStopDwellSeconds',
        'dayType', 'planningPeriod',
    ]) && isFiniteNumber(value.firstDepartureMinutes) &&
        isFiniteNumber(value.lastDepartureMinutes) && isFiniteNumber(value.frequencyMinutes) &&
        value.frequencyMinutes > 0 &&
        (value.testedBuses === undefined || (isNonNegativeInteger(value.testedBuses) && value.testedBuses > 0)) &&
        isFiniteNumber(value.startTerminalLayoverMinutes) && isFiniteNumber(value.endTerminalLayoverMinutes) &&
        isFiniteNumber(value.intermediateStopDwellSeconds) &&
        isEnum(value.dayType, ['weekday', 'saturday', 'sunday']) &&
        isEnum(value.planningPeriod, ['all-day', 'am-peak', 'midday', 'pm-peak', 'evening']);
}

function isStoredAlternative(value: unknown): value is StoredAlternativePayload {
    return isRecord(value) && hasOnlyKeys(value, [
        'id', 'name', 'status', 'structure', 'patternOrder', 'service', 'notes', 'createdAt', 'updatedAt',
    ]) && isString(value.id) && isString(value.name) &&
        isEnum(value.status, ['draft', 'review']) &&
        isEnum(value.structure, ['bidirectional', 'loop', 'out-and-back']) &&
        isStringArray(value.patternOrder) && isService(value.service) && isString(value.notes) &&
        isString(value.createdAt) && isString(value.updatedAt);
}

function validateRootSummary(teamId: string, projectId: string, value: unknown): RouteConceptSavedProjectSummary {
    if (!isRecord(value) || value.id !== projectId || value.schemaVersion !== ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION ||
        value.teamId !== teamId || !isString(value.name) ||
        !isEnum(value.status, ['local-draft', 'local-saved', 'archived']) ||
        !isNonNegativeInteger(value.revision) || !isString(value.selectedAlternativeId) ||
        !optionalString(value.preferredAlternativeId) || !isStringArray(value.alternativeOrder) ||
        !isNonNegativeInteger(value.alternativeCount) || value.alternativeCount !== value.alternativeOrder.length ||
        !isString(value.updatedBy)) {
        throw new RouteConceptPersistenceValidationError(`Project ${projectId} has invalid metadata.`);
    }
    const createdAt = timestampToIso(value.createdAt);
    const updatedAt = timestampToIso(value.updatedAt);
    if (!createdAt || !updatedAt) {
        throw new RouteConceptPersistenceValidationError(`Project ${projectId} has invalid timestamps.`);
    }
    return {
        id: projectId,
        name: value.name,
        status: value.status,
        revision: value.revision,
        selectedAlternativeId: value.selectedAlternativeId,
        preferredAlternativeId: value.preferredAlternativeId,
        alternativeOrder: [...value.alternativeOrder],
        alternativeCount: value.alternativeCount,
        createdAt,
        updatedAt,
        updatedBy: value.updatedBy,
    };
}

function validateProjectForSave(project: RouteConceptProject): void {
    if (project.schemaVersion !== ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION || !project.id.trim() || !project.name.trim() ||
        !isNonNegativeInteger(project.revision) || !isStringArray(project.alternativeOrder) ||
        !Array.isArray(project.alternatives) || project.alternatives.length !== project.alternativeOrder.length ||
        project.alternatives.length > 50 || new Set(project.alternativeOrder).size !== project.alternativeOrder.length) {
        throw new RouteConceptPersistenceValidationError('The route concept project is not valid for saving.');
    }
    const byId = new Map(project.alternatives.map((alternative) => [alternative.id, alternative]));
    if (project.alternativeOrder.some((id) => !byId.has(id)) ||
        (project.alternatives.length > 0 && !byId.has(project.selectedAlternativeId)) ||
        (project.preferredAlternativeId !== undefined && !byId.has(project.preferredAlternativeId))) {
        throw new RouteConceptPersistenceValidationError('Alternative ordering or selection is invalid.');
    }
    for (const alternative of project.alternatives) {
        const { patterns: _patterns, ...payload } = alternative;
        if (!isStoredAlternative(payload) || !Array.isArray(alternative.patterns) ||
            alternative.patterns.length !== alternative.patternOrder.length ||
            new Set(alternative.patternOrder).size !== alternative.patternOrder.length ||
            alternative.patternOrder.some((id) => !alternative.patterns.some((pattern) => pattern.id === id)) ||
            !alternative.patterns.every(isPattern)) {
            throw new RouteConceptPersistenceValidationError(`Alternative ${alternative.id} is invalid.`);
        }
    }
}

function projectRef(teamId: string, projectId: string): DocumentReference<DocumentData> {
    return doc(db, 'teams', teamId, PROJECTS_COLLECTION, projectId);
}

function alternativesRef(teamId: string, projectId: string) {
    return collection(db, 'teams', teamId, PROJECTS_COLLECTION, projectId, ALTERNATIVES_COLLECTION);
}

function alternativeRef(teamId: string, projectId: string, alternativeId: string): DocumentReference<DocumentData> {
    return doc(db, 'teams', teamId, PROJECTS_COLLECTION, projectId, ALTERNATIVES_COLLECTION, alternativeId);
}

function patternsRef(teamId: string, projectId: string, alternativeId: string) {
    return collection(db, 'teams', teamId, PROJECTS_COLLECTION, projectId, ALTERNATIVES_COLLECTION, alternativeId, PATTERNS_COLLECTION);
}

function patternRef(teamId: string, projectId: string, alternativeId: string, patternId: string): DocumentReference<DocumentData> {
    return doc(db, 'teams', teamId, PROJECTS_COLLECTION, projectId, ALTERNATIVES_COLLECTION, alternativeId, PATTERNS_COLLECTION, patternId);
}

async function listExistingChildRefs(teamId: string, projectId: string) {
    const alternativeSnapshot = await getDocs(alternativesRef(teamId, projectId));
    const patternSnapshots = await Promise.all(alternativeSnapshot.docs.map(async (alternativeDoc) => ({
        alternativeId: alternativeDoc.id,
        snapshot: await getDocs(patternsRef(teamId, projectId, alternativeDoc.id)),
    })));
    return {
        alternatives: alternativeSnapshot.docs.map((entry) => entry.ref),
        patterns: patternSnapshots.flatMap(({ snapshot }) => snapshot.docs.map((entry) => entry.ref)),
    };
}

export async function listRouteConceptSavedProjects(teamId: string): Promise<RouteConceptSavedProjectSummary[]> {
    const snapshot = await getDocs(query(
        collection(db, 'teams', teamId, PROJECTS_COLLECTION),
        orderBy('updatedAt', 'desc'),
    ));
    return snapshot.docs.map((entry) => validateRootSummary(teamId, entry.id, entry.data()));
}

async function loadProjectOnce(teamId: string, projectId: string): Promise<RouteConceptProject | null> {
    const rootSnapshot = await getDoc(projectRef(teamId, projectId));
    if (!rootSnapshot.exists()) return null;
    const summary = validateRootSummary(teamId, rootSnapshot.id, rootSnapshot.data());
    const alternativeSnapshot = await getDocs(alternativesRef(teamId, projectId));
    const alternativesUnordered = await Promise.all(alternativeSnapshot.docs.map(async (alternativeDoc) => {
        const wrapper = alternativeDoc.data();
        if (!isRecord(wrapper) || wrapper.id !== alternativeDoc.id || wrapper.teamId !== teamId ||
            wrapper.projectId !== projectId || wrapper.schemaVersion !== ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION ||
            !isString(wrapper.updatedBy) || !timestampToIso(wrapper.updatedAt) || !isStoredAlternative(wrapper.payload)) {
            throw new RouteConceptPersistenceValidationError(`Alternative ${alternativeDoc.id} has invalid data.`);
        }
        const patternSnapshot = await getDocs(patternsRef(teamId, projectId, alternativeDoc.id));
        const patternsUnordered = patternSnapshot.docs.map((patternDoc) => {
            const patternWrapper = patternDoc.data();
            if (!isRecord(patternWrapper) || patternWrapper.id !== patternDoc.id || patternWrapper.teamId !== teamId ||
                patternWrapper.projectId !== projectId || patternWrapper.alternativeId !== alternativeDoc.id ||
                patternWrapper.schemaVersion !== ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION ||
                !isString(patternWrapper.updatedBy) || !timestampToIso(patternWrapper.updatedAt) || !isPattern(patternWrapper.payload)) {
                throw new RouteConceptPersistenceValidationError(`Pattern ${patternDoc.id} has invalid data.`);
            }
            return patternWrapper.payload;
        });
        const patternById = new Map(patternsUnordered.map((pattern) => [pattern.id, pattern]));
        if (wrapper.payload.patternOrder.some((id) => !patternById.has(id)) ||
            patternById.size !== wrapper.payload.patternOrder.length) {
            throw new RouteConceptPersistenceValidationError(`Alternative ${alternativeDoc.id} has inconsistent pattern order.`);
        }
        return {
            ...wrapper.payload,
            patterns: wrapper.payload.patternOrder.map((id) => patternById.get(id)).filter(isPattern),
        };
    }));
    const alternativeById = new Map(alternativesUnordered.map((alternative) => [alternative.id, alternative]));
    if (summary.alternativeOrder.some((id) => !alternativeById.has(id)) ||
        alternativeById.size !== summary.alternativeOrder.length ||
        (alternativeById.size > 0 && !alternativeById.has(summary.selectedAlternativeId)) ||
        (summary.preferredAlternativeId !== undefined && !alternativeById.has(summary.preferredAlternativeId))) {
        throw new RouteConceptPersistenceValidationError(`Project ${projectId} has inconsistent alternative order.`);
    }

    // Refuse a mixed read if another planner saved while the child documents loaded.
    const finalRoot = await getDoc(projectRef(teamId, projectId));
    if (!finalRoot.exists()) return null;
    const finalSummary = validateRootSummary(teamId, finalRoot.id, finalRoot.data());
    if (finalSummary.revision !== summary.revision) {
        throw new RouteConceptPersistenceConflictError(projectId, summary.revision, finalSummary.revision);
    }

    return {
        id: summary.id,
        name: summary.name,
        status: summary.status,
        schemaVersion: ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION,
        revision: summary.revision,
        selectedAlternativeId: summary.selectedAlternativeId,
        preferredAlternativeId: summary.preferredAlternativeId,
        alternativeOrder: summary.alternativeOrder,
        alternatives: summary.alternativeOrder.map((id) => alternativeById.get(id)).filter((value): value is RouteConceptAlternative => value !== undefined),
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        updatedBy: summary.updatedBy,
    };
}

export async function loadRouteConceptProject(teamId: string, projectId: string): Promise<RouteConceptProject | null> {
    try {
        return await loadProjectOnce(teamId, projectId);
    } catch (error) {
        if (error instanceof RouteConceptPersistenceConflictError) return loadProjectOnce(teamId, projectId);
        throw error;
    }
}

export async function saveRouteConceptProject(
    teamId: string,
    userId: string,
    project: RouteConceptProject,
    expectedRevision: number,
): Promise<RouteConceptProject> {
    validateProjectForSave(project);
    if (!teamId.trim() || !userId.trim() || !isNonNegativeInteger(expectedRevision) || project.revision !== expectedRevision) {
        throw new RouteConceptPersistenceValidationError('Team, user, and expected revision are required.');
    }

    const existing = await listExistingChildRefs(teamId, project.id);
    const now = new Date().toISOString();
    const nextRevision = expectedRevision + 1;
    await runTransaction(db, async (transaction) => {
        const rootReference = projectRef(teamId, project.id);
        const rootSnapshot = await transaction.get(rootReference);
        let createdAt: unknown = serverTimestamp();
        let createdBy = userId;
        let actualRevision: number | null = null;
        if (rootSnapshot.exists()) {
            const current = rootSnapshot.data();
            actualRevision = isRecord(current) && isNonNegativeInteger(current.revision) ? current.revision : null;
            createdAt = isRecord(current) ? current.createdAt : createdAt;
            createdBy = isRecord(current) && isString(current.createdBy) ? current.createdBy : createdBy;
        }
        if ((rootSnapshot.exists() && actualRevision !== expectedRevision) ||
            (!rootSnapshot.exists() && expectedRevision !== 0)) {
            throw new RouteConceptPersistenceConflictError(project.id, expectedRevision, actualRevision);
        }

        transaction.set(rootReference, stripUndefinedDeep({
            id: project.id,
            teamId,
            schemaVersion: ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION,
            revision: nextRevision,
            name: project.name.trim(),
            status: project.status === 'archived' ? 'archived' : 'local-saved',
            selectedAlternativeId: project.selectedAlternativeId,
            preferredAlternativeId: project.preferredAlternativeId,
            alternativeOrder: project.alternativeOrder,
            alternativeCount: project.alternatives.length,
            createdAt,
            createdBy,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
        }));

        const nextAlternativePaths = new Set<string>();
        const nextPatternPaths = new Set<string>();
        for (const alternative of project.alternatives) {
            const { patterns, ...payload } = alternative;
            const ref = alternativeRef(teamId, project.id, alternative.id);
            nextAlternativePaths.add(ref.path);
            transaction.set(ref, stripUndefinedDeep({
                id: alternative.id,
                teamId,
                projectId: project.id,
                schemaVersion: ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION,
                payload,
                updatedAt: serverTimestamp(),
                updatedBy: userId,
            }));
            for (const pattern of patterns) {
                const ref = patternRef(teamId, project.id, alternative.id, pattern.id);
                nextPatternPaths.add(ref.path);
                transaction.set(ref, stripUndefinedDeep({
                    id: pattern.id,
                    teamId,
                    projectId: project.id,
                    alternativeId: alternative.id,
                    schemaVersion: ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION,
                    payload: pattern,
                    updatedAt: serverTimestamp(),
                    updatedBy: userId,
                }));
            }
        }
        existing.patterns.forEach((ref) => {
            if (!nextPatternPaths.has(ref.path)) transaction.delete(ref);
        });
        existing.alternatives.forEach((ref) => {
            if (!nextAlternativePaths.has(ref.path)) transaction.delete(ref);
        });
    });

    return {
        ...project,
        name: project.name.trim(),
        status: project.status === 'archived' ? 'archived' : 'local-saved',
        revision: nextRevision,
        updatedAt: now,
        updatedBy: userId,
    };
}

export async function saveRouteConceptProjectAsCopy(
    teamId: string,
    userId: string,
    project: RouteConceptProject,
    copyProjectId?: string,
): Promise<RouteConceptProject> {
    const id = copyProjectId?.trim() || doc(collection(db, 'teams', teamId, PROJECTS_COLLECTION)).id;
    const now = new Date().toISOString();
    return saveRouteConceptProject(teamId, userId, {
        ...project,
        id,
        name: `${project.name.trim()} copy`,
        status: 'local-draft',
        revision: 0,
        createdAt: now,
        updatedAt: now,
        updatedBy: userId,
    }, 0);
}
