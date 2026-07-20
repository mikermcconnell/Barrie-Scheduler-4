import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
    RouteConceptPlannerWorkspace,
    type RouteConceptPlannerServices,
} from '../../components/Analytics/RouteConceptPlannerWorkspace';
import { RouteConceptPersistenceConflictError } from '../../utils/route-concept-planner/routeConceptPlannerPersistence';
import type { RouteConceptProject } from '../../utils/route-concept-planner';
import type { RouteConceptGtfsPatternCandidate } from '../../utils/route-concept-planner/routeConceptPlannerGtfsAdapter';

const runtime = [{ planningPeriod: 'all-day' as const, sampleSize: 20, segmentRuntimeMinutes: [12], totalRuntimeMinutes: 12 }];
const gtfsPatterns: RouteConceptGtfsPatternCandidate[] = [
    {
        id: '400-out', routeId: '400', routeShortName: '400', routeLongName: 'RVH–Park Place', serviceId: 'Weekday', dayType: 'weekday', dayTypeLabel: 'Weekday', directionId: 0, tripHeadsign: 'Park Place', tripCount: 24,
        firstDepartureMinutes: 360, lastDepartureMinutes: 1320, medianHeadwayMinutes: 30, blockCount: 2, scheduledRuntimes: runtime,
        stops: [
            { id: 'rvh', gtfsStopId: 'rvh', name: 'RVH', lat: 44.415, lng: -79.66, sequence: 1 },
            { id: 'park-place', gtfsStopId: 'park-place', name: 'Park Place', lat: 44.338, lng: -79.69, sequence: 2 },
        ],
        shapePoints: [{ lat: 44.415, lng: -79.66, sequence: 1 }, { lat: 44.338, lng: -79.69, sequence: 2 }],
    },
    {
        id: '400-in', routeId: '400', routeShortName: '400', routeLongName: 'RVH–Park Place', serviceId: 'Weekday', dayType: 'weekday', dayTypeLabel: 'Weekday', directionId: 1, tripHeadsign: 'RVH', tripCount: 24,
        firstDepartureMinutes: 360, lastDepartureMinutes: 1320, medianHeadwayMinutes: 30, blockCount: 2, scheduledRuntimes: runtime,
        stops: [
            { id: 'park-place-return', gtfsStopId: 'park-place', name: 'Park Place', lat: 44.338, lng: -79.69, sequence: 1 },
            { id: 'rvh-return', gtfsStopId: 'rvh', name: 'RVH', lat: 44.415, lng: -79.66, sequence: 2 },
        ],
        shapePoints: [{ lat: 44.338, lng: -79.69, sequence: 1 }, { lat: 44.415, lng: -79.66, sequence: 2 }],
    },
];

let savedProject: RouteConceptProject | null = null;

function cloneProject(project: RouteConceptProject): RouteConceptProject {
    return structuredClone(project);
}

const services: RouteConceptPlannerServices = {
    loadGtfsPatterns: async () => gtfsPatterns,
    searchPlaces: async () => [{ id: 'city-hall', name: 'City Hall', label: '70 Collier Street, Barrie', lat: 44.389, lng: -79.69 }],
    listSavedProjects: async () => savedProject ? [{
        id: savedProject.id,
        name: savedProject.name,
        status: savedProject.status,
        revision: savedProject.revision,
        selectedAlternativeId: savedProject.selectedAlternativeId,
        preferredAlternativeId: savedProject.preferredAlternativeId,
        alternativeOrder: savedProject.alternativeOrder,
        alternativeCount: savedProject.alternatives.length,
        createdAt: savedProject.createdAt,
        updatedAt: savedProject.updatedAt,
        updatedBy: savedProject.updatedBy,
    }] : [],
    loadProject: async (_teamId, projectId) => savedProject?.id === projectId ? cloneProject(savedProject) : null,
    saveProject: async (_teamId, userId, project, expectedRevision) => {
        if (savedProject && savedProject.id === project.id && savedProject.revision !== expectedRevision) {
            throw new RouteConceptPersistenceConflictError(project.id, expectedRevision, savedProject.revision);
        }
        savedProject = { ...cloneProject(project), status: 'local-saved', revision: expectedRevision + 1, updatedBy: userId, updatedAt: new Date().toISOString() };
        return cloneProject(savedProject);
    },
    saveProjectAsCopy: async (_teamId, userId, project) => {
        savedProject = { ...cloneProject(project), id: `${project.id}-copy`, name: `${project.name} copy`, status: 'local-saved', revision: 1, updatedBy: userId, updatedAt: new Date().toISOString() };
        return cloneProject(savedProject);
    },
};

function Harness() {
    const [externalSaveCount, setExternalSaveCount] = useState(0);

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    if (!savedProject) return;
                    savedProject = { ...savedProject, revision: savedProject.revision + 1, updatedAt: new Date().toISOString(), updatedBy: 'other-planner' };
                    setExternalSaveCount((count) => count + 1);
                }}
                className="fixed right-3 top-3 z-[100] rounded-lg bg-fuchsia-700 px-3 py-2 text-xs font-bold text-white"
            >
                Simulate external save
            </button>
            <span className="sr-only" role="status">External saves simulated: {externalSaveCount}</span>
            <RouteConceptPlannerWorkspace onBack={() => undefined} userId="browser-user" teamId="team-a" services={services} />
        </>
    );
}

createRoot(document.getElementById('root')!).render(<Harness />);
