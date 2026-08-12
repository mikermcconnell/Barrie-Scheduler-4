import { describe, expect, it } from 'vitest';
import { createDetourNotice, createDetourRouteOverlay } from '../utils/detours/detourFactory';
import { deriveDetourState } from '../utils/detours/detourSchedule';
import { validateDetourNotice } from '../utils/detours/detourValidation';
import { normalizeDetourOverlayJunctions } from '../utils/detours/detourAuthoring';
import type { DetourRouteOverlay } from '../utils/detours/detourTypes';

const overlay = (): DetourRouteOverlay => ({
    id: 'route-8a-north',
    routeSnapshot: {
        importedAt: '2026-07-16T12:00:00.000Z', routeId: '8A', routeShortName: '8A',
        routeColor: '#E31B23', directionLabel: 'Northbound', isLoop: false, originalGeometry: [], stops: [],
    },
    closureStart: { segmentIndex: 0, fraction: 0.2, coordinate: { latitude: 44.38, longitude: -79.69 } },
    closureEnd: { segmentIndex: 0, fraction: 0.8, coordinate: { latitude: 44.39, longitude: -79.68 } },
    closureWaypoints: [],
    closureGeometry: { coordinates: [], source: 'gtfs', manualRoutingAcknowledged: false },
    detourWaypoints: [{ latitude: 44.38, longitude: -79.69 }, { latitude: 44.39, longitude: -79.68 }],
    detourGeometry: {
        coordinates: [{ latitude: 44.38, longitude: -79.69 }, { latitude: 44.39, longitude: -79.68 }],
        source: 'road-snapped', manualRoutingAcknowledged: false,
    },
    labels: [],
    stopImpacts: [], busSuitabilityConfirmed: true,
    createdAt: new Date('2026-07-16T12:00:00Z'), updatedAt: new Date('2026-07-16T12:00:00Z'),
});

describe('detour domain', () => {
    it('creates a Toronto-scoped draft with stable defaults', () => {
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a', now: new Date('2026-07-16T16:30:00Z') });
        expect(notice.schedule).toMatchObject({ timeZone: 'America/Toronto', startDate: '2026-07-16', startTime: '' });
        expect(notice.status).toBe('draft');
        expect(notice.revision).toBe(0);
        const emptyOverlay = createDetourRouteOverlay('8a-north', overlay().routeSnapshot, notice.createdAt);
        expect(emptyOverlay).toMatchObject({ closureStart: null, closureEnd: null, closureWaypoints: [], detourWaypoints: [], labels: [], busSuitabilityConfirmed: false });
    });

    it('separates export blockers from advisories', () => {
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a' });
        Object.assign(notice, { title: 'Route 8A detour', publicSummary: 'Temporary routing', publicDetails: 'Use temporary stops.' });
        const route = overlay();
        route.stopImpacts.push({ id: 'stop-1', status: 'closed', reviewed: true });
        notice.overlays = [route];
        const result = validateDetourNotice(notice);
        expect(result.errors).toHaveLength(0);
        expect(result.warnings.map(item => item.code)).toContain('closed-stop-no-alternative');
        expect(result.canExport).toBe(true);
    });

    it('normalizes legacy path endpoints to shared diversion and rejoin junctions', () => {
        const route = overlay();
        route.routeSnapshot.originalGeometry = [
            { latitude: 44.38, longitude: -79.70 },
            { latitude: 44.39, longitude: -79.67 },
        ];
        route.closureGeometry.coordinates = [
            { latitude: 44.381, longitude: -79.691 },
            { latitude: 44.389, longitude: -79.679 },
        ];
        route.detourWaypoints = [
            { latitude: 44.382, longitude: -79.692 },
            { latitude: 44.388, longitude: -79.678 },
        ];
        route.detourGeometry.coordinates = [...route.detourWaypoints];

        const normalized = normalizeDetourOverlayJunctions(route);
        expect(normalized.closureGeometry.coordinates[0]).toEqual(route.closureStart?.coordinate);
        expect(normalized.closureGeometry.coordinates.at(-1)).toEqual(route.closureEnd?.coordinate);
        expect(normalized.detourWaypoints[0]).toEqual(route.closureStart?.coordinate);
        expect(normalized.detourGeometry.coordinates.at(-1)).toEqual(route.closureEnd?.coordinate);
    });

    it('allows date-only effective schedules and validates partial recurring hours', () => {
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a' });
        Object.assign(notice, { title: 'Detour', publicDetails: 'Details' });
        notice.overlays = [overlay()];
        notice.schedule.end = { mode: 'fixed', date: notice.schedule.startDate, time: '' };
        expect(validateDetourNotice(notice).errors).toEqual([]);

        notice.schedule.recurrence = { mode: 'weekly', days: ['monday'], startTime: '08:00', endTime: '' };
        expect(validateDetourNotice(notice).errors.map(item => item.code)).toContain('recurrence-time-pair-required');
    });

    it('blocks unreviewed impacts and unconfirmed manual routing', () => {
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a' });
        Object.assign(notice, { title: 'Detour', publicSummary: 'Summary', publicDetails: 'Details' });
        const route = overlay();
        route.detourGeometry.source = 'manual';
        route.stopImpacts.push({ id: 'stop-1', status: 'closed', reviewed: false });
        notice.overlays = [route];
        const result = validateDetourNotice(notice);
        expect(result.errors.map(item => item.code)).toEqual(expect.arrayContaining([
            'manual-routing-unacknowledged', 'stop-impacts-unreviewed',
        ]));
        expect(result.canExport).toBe(false);
    });

    it('warns for uncoded temporary sheets and blocks one code mapped to conflicting locations', () => {
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a' });
        Object.assign(notice, { title: 'Detour', publicDetails: 'Details' });
        const first = overlay();
        first.stopImpacts = [{
            id: 'temporary-uncoded', status: 'temporary', reviewed: true,
            temporaryStopName: 'Unsigned temporary stop', temporaryStopPosition: { latitude: 44.38, longitude: -79.69 },
        }];
        const second = overlay();
        second.id = 'route-100';
        first.stopImpacts.push({
            id: 'temporary-1420-a', status: 'temporary', reviewed: true, temporaryStopCode: '1420',
            temporaryStopName: 'Codrington at Puget', temporaryStopPosition: { latitude: 44.38, longitude: -79.69 },
        });
        second.stopImpacts = [{
            id: 'temporary-1420-b', status: 'temporary', reviewed: true, temporaryStopCode: '1420',
            temporaryStopName: 'Codrington at Puget', temporaryStopPosition: { latitude: 44.39, longitude: -79.68 },
        }];
        notice.overlays = [first, second];

        const result = validateDetourNotice(notice);
        expect(result.warnings.map(item => item.code)).toContain('temporary-stop-code-recommended');
        expect(result.errors.map(item => item.code)).toContain('temporary-stop-code-location-conflict');
        expect(result.canExport).toBe(false);
    });

    it('blocks export until an edited closed section is reviewed', () => {
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a' });
        Object.assign(notice, { title: 'Detour', publicDetails: 'Details' });
        const route = overlay();
        route.closureGeometry.source = 'manual';
        route.closureGeometry.manualRoutingAcknowledged = false;
        notice.overlays = [route];

        expect(validateDetourNotice(notice).errors.map(item => item.code)).toContain('closure-routing-unacknowledged');
        route.closureGeometry.manualRoutingAcknowledged = true;
        expect(validateDetourNotice(notice).errors.map(item => item.code)).not.toContain('closure-routing-unacknowledged');
    });

    it('blocks export when legacy route geometries do not meet at shared junctions', () => {
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a' });
        Object.assign(notice, { title: 'Detour', publicDetails: 'Details' });
        const route = overlay();
        route.detourGeometry.coordinates[0] = { latitude: 44.381, longitude: -79.691 };
        notice.overlays = [route];
        expect(validateDetourNotice(notice).errors.map(item => item.code)).toContain('junctions-disconnected');

        notice.overlays = [normalizeDetourOverlayJunctions(route)];
        expect(validateDetourNotice(notice).errors.map(item => item.code)).not.toContain('junctions-disconnected');
    });

    it('does not apply route-detour gates to a stop-closure context overlay', () => {
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a', type: 'stop-closure' });
        Object.assign(notice, { title: 'Stop closed', publicSummary: 'Use the next stop', publicDetails: 'Follow the signed path.' });
        const context = overlay();
        context.closureStart = null;
        context.closureEnd = null;
        context.detourGeometry.coordinates = [];
        context.busSuitabilityConfirmed = false;
        notice.overlays = [context];
        const stop = { stopId: '101', name: 'Downtown Terminal', position: { latitude: 44.38, longitude: -79.69 }, sequence: 1 };
        notice.stopClosure = { closedStop: stop, replacementStop: { ...stop, stopId: '102' }, instructions: 'Use stop 102.' };
        expect(validateDetourNotice(notice).errors).toEqual([]);
    });

    it('derives upcoming, active, expired, and update-needed without changing recurrence windows', () => {
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a' });
        notice.status = 'posted';
        notice.revision = 3;
        notice.schedule.startDate = '2026-07-20';
        notice.schedule.startTime = '08:00';
        notice.schedule.end = { mode: 'fixed', date: '2026-07-22', time: '18:00' };
        notice.publications = [{
            id: 'pub-1', noticeId: notice.id, revision: 2,
            exportedAt: new Date(), exportedBy: 'user-a', postedAt: new Date(), postedBy: 'user-a',
            myRideUrl: 'https://example.com', filenames: { pdf: 'notice.pdf', png: 'notice.png' },
        }];
        expect(deriveDetourState(notice, new Date('2026-07-20T11:00:00Z')).lifecycle).toBe('upcoming');
        expect(deriveDetourState(notice, new Date('2026-07-20T13:00:00Z'))).toMatchObject({ lifecycle: 'active', updateNeeded: true });
        expect(deriveDetourState(notice, new Date('2026-07-23T00:00:00Z')).lifecycle).toBe('expired');
    });

    it('treats blank times as the full selected date', () => {
        const notice = createDetourNotice({ teamId: 'team-a', userId: 'user-a' });
        notice.status = 'posted';
        notice.schedule.startDate = '2026-07-20';
        notice.schedule.startTime = '';
        notice.schedule.end = { mode: 'fixed', date: '2026-07-20', time: '' };
        expect(deriveDetourState(notice, new Date('2026-07-20T04:00:00Z')).lifecycle).toBe('active');
        expect(deriveDetourState(notice, new Date('2026-07-21T04:00:00Z')).lifecycle).toBe('expired');
    });
});
