import type { DetourNotice, DetourValidationIssue, DetourValidationResult } from './detourTypes';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const issue = (code: string, message: string, path?: string): DetourValidationIssue => ({ code, message, ...(path ? { path } : {}) });
const sameCoordinate = (first: { latitude: number; longitude: number } | undefined, second: { latitude: number; longitude: number } | undefined) => Boolean(first && second
    && Math.abs(first.latitude - second.latitude) < 0.000001
    && Math.abs(first.longitude - second.longitude) < 0.000001);

export const validateDetourNotice = (notice: DetourNotice): DetourValidationResult => {
    const errors: DetourValidationIssue[] = [];
    const warnings: DetourValidationIssue[] = [];
    const temporaryStopPositions = new Map<string, { latitude: number; longitude: number }>();
    const conflictingTemporaryStopCodes = new Set<string>();
    if (!notice.title.trim()) errors.push(issue('title-required', 'Enter a public notice title.', 'title'));
    if (!notice.publicDetails.trim()) errors.push(issue('details-required', 'Enter rider details.', 'publicDetails'));
    if (!DATE.test(notice.schedule.startDate)) {
        errors.push(issue('schedule-start-date-invalid', 'Enter a valid start date.', 'schedule.startDate'));
    }
    if (notice.schedule.startTime && !TIME.test(notice.schedule.startTime)) {
        errors.push(issue('schedule-start-time-invalid', 'Enter a valid start time or leave it blank.', 'schedule.startTime'));
    }
    if (notice.schedule.end.mode === 'fixed') {
        const end = notice.schedule.end;
        if (!DATE.test(end.date)) errors.push(issue('schedule-end-date-invalid', 'Enter a valid end date.', 'schedule.end.date'));
        if (end.time && !TIME.test(end.time)) errors.push(issue('schedule-end-time-invalid', 'Enter a valid end time or leave it blank.', 'schedule.end.time'));
        if (DATE.test(notice.schedule.startDate) && (!notice.schedule.startTime || TIME.test(notice.schedule.startTime))
            && DATE.test(end.date) && (!end.time || TIME.test(end.time))
            && `${end.date}T${end.time || '23:59'}` <= `${notice.schedule.startDate}T${notice.schedule.startTime || '00:00'}`) {
            errors.push(issue('schedule-end-before-start', 'The end must be after the start.', 'schedule.end'));
        }
    }
    if (notice.schedule.recurrence.mode === 'weekly') {
        if (notice.schedule.recurrence.days.length === 0) errors.push(issue('recurrence-days-required', 'Select at least one recurring day.', 'schedule.recurrence.days'));
        const { startTime, endTime } = notice.schedule.recurrence;
        if (Boolean(startTime) !== Boolean(endTime)) {
            errors.push(issue('recurrence-time-pair-required', 'Enter both recurring times or leave both blank.', 'schedule.recurrence'));
        } else if ((startTime && !TIME.test(startTime)) || (endTime && !TIME.test(endTime))) {
            errors.push(issue('recurrence-time-invalid', 'Enter valid recurring operating hours or leave them blank.', 'schedule.recurrence'));
        }
    }

    if (notice.type === 'route-detour' && notice.overlays.length === 0) {
        errors.push(issue('route-required', 'Add at least one affected route and direction.', 'overlays'));
    }
    notice.overlays.forEach((overlay, index) => {
        const path = `overlays.${index}`;
        if (notice.type === 'route-detour') {
            if (!overlay.routeSnapshot.routeId || !overlay.routeSnapshot.directionLabel.trim()) errors.push(issue('route-direction-required', 'Confirm the route and direction.', path));
            if (!overlay.closureStart || !overlay.closureEnd) errors.push(issue('closure-anchors-required', 'Mark where the closure starts and ends.', `${path}.closure`));
            if (overlay.detourGeometry.coordinates.length < 2) errors.push(issue('detour-path-required', 'Draw the replacement path.', `${path}.detourGeometry`));
            if (overlay.closureStart && overlay.closureEnd && overlay.detourGeometry.coordinates.length >= 2) {
                const detourStartsAtJunction = sameCoordinate(overlay.detourGeometry.coordinates[0], overlay.closureStart.coordinate);
                const detourEndsAtJunction = sameCoordinate(overlay.detourGeometry.coordinates.at(-1), overlay.closureEnd.coordinate);
                const closureStartsAtJunction = overlay.closureGeometry.coordinates.length < 2 || sameCoordinate(overlay.closureGeometry.coordinates[0], overlay.closureStart.coordinate);
                const closureEndsAtJunction = overlay.closureGeometry.coordinates.length < 2 || sameCoordinate(overlay.closureGeometry.coordinates.at(-1), overlay.closureEnd.coordinate);
                if (!detourStartsAtJunction || !detourEndsAtJunction || !closureStartsAtJunction || !closureEndsAtJunction) {
                    errors.push(issue('junctions-disconnected', 'Repair the diversion and rejoin junctions so every route line meets cleanly.', `${path}.closure`));
                }
            }
            if (!overlay.busSuitabilityConfirmed) errors.push(issue('bus-suitability-required', 'Confirm the replacement path is suitable for buses.', `${path}.busSuitabilityConfirmed`));
            if (overlay.detourGeometry.source === 'manual' && !overlay.detourGeometry.manualRoutingAcknowledged) errors.push(issue('manual-routing-unacknowledged', 'Acknowledge the manually routed section.', `${path}.detourGeometry`));
            if (overlay.closureGeometry.source === 'manual' && !overlay.closureGeometry.manualRoutingAcknowledged) errors.push(issue('closure-routing-unacknowledged', 'Acknowledge the edited closed section.', `${path}.closureGeometry`));
            const unreviewed = overlay.stopImpacts.filter(stop => !stop.reviewed);
            if (unreviewed.length > 0) errors.push(issue('stop-impacts-unreviewed', 'Review every suggested stop impact.', `${path}.stopImpacts`));
            overlay.stopImpacts.forEach((stop, stopIndex) => {
                if (stop.status === 'temporary' && (!stop.temporaryStopName?.trim() || !stop.temporaryStopPosition)) {
                    errors.push(issue('temporary-stop-incomplete', 'Temporary stops need a name and map location.', `${path}.stopImpacts.${stopIndex}`));
                }
                if (stop.status === 'temporary' && !stop.temporaryStopCode?.trim()) {
                    warnings.push(issue('temporary-stop-code-recommended', 'Add a stop code so the temporary-stop sheet has a specific title.', `${path}.stopImpacts.${stopIndex}`));
                }
                if (stop.status === 'temporary' && stop.temporaryStopCode?.trim() && stop.temporaryStopPosition) {
                    const code = stop.temporaryStopCode.trim().toUpperCase();
                    const previous = temporaryStopPositions.get(code);
                    const differs = previous
                        && (Math.abs(previous.latitude - stop.temporaryStopPosition.latitude) > 0.00025
                            || Math.abs(previous.longitude - stop.temporaryStopPosition.longitude) > 0.00025);
                    if (differs && !conflictingTemporaryStopCodes.has(code)) {
                        errors.push(issue('temporary-stop-code-location-conflict', `Temporary stop ${code} is mapped in conflicting locations.`, `${path}.stopImpacts.${stopIndex}`));
                        conflictingTemporaryStopCodes.add(code);
                    } else if (!previous) {
                        temporaryStopPositions.set(code, stop.temporaryStopPosition);
                    }
                }
                if (stop.status === 'closed' && !stop.replacementStopId && !stop.riderInstructions?.trim()) {
                    warnings.push(issue('closed-stop-no-alternative', 'Add a replacement stop or rider instructions for the closed stop.', `${path}.stopImpacts.${stopIndex}`));
                }
            });
            const publicStreetLabels = (overlay.streetLabels ?? []).filter(label => label.confirmed && label.visible && label.streetName.trim());
            if (!publicStreetLabels.some(label => label.path === 'closure')) {
                warnings.push(issue('closure-street-label-missing', 'Add the affected street so the public map can say where service is unavailable.', `${path}.streetLabels`));
            }
            if (!publicStreetLabels.some(label => label.path === 'detour')) {
                warnings.push(issue('detour-street-label-missing', 'Confirm at least one detour street label for the replacement path.', `${path}.streetLabels`));
            }
            if (overlay.labelCollisionAcknowledged === false) warnings.push(issue('label-collision', 'Resolve or acknowledge overlapping map labels.', path));
        }
    });

    if (notice.type === 'stop-closure') {
        if (!notice.stopClosure?.closedStop) errors.push(issue('closed-stop-required', 'Select the closed stop.', 'stopClosure.closedStop'));
        if (!notice.stopClosure?.replacementStop) warnings.push(issue('replacement-stop-missing', 'Add a replacement stop or explain why none is available.', 'stopClosure.replacementStop'));
        if (!notice.stopClosure?.instructions.trim()) errors.push(issue('stop-instructions-required', 'Enter walking or replacement-stop instructions.', 'stopClosure.instructions'));
        if (notice.stopClosure?.walkingGeometry?.source === 'manual' && !notice.stopClosure.walkingGeometry.manualRoutingAcknowledged) {
            errors.push(issue('walking-route-unacknowledged', 'Acknowledge the manually drawn walking route.', 'stopClosure.walkingGeometry'));
        }
    }
    return { errors, warnings, canExport: errors.length === 0 };
};
