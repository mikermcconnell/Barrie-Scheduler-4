import type { DetourNotice, DetourValidationIssue, DetourValidationResult } from './detourTypes';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const issue = (code: string, message: string, path?: string): DetourValidationIssue => ({ code, message, ...(path ? { path } : {}) });

export const validateDetourNotice = (notice: DetourNotice): DetourValidationResult => {
    const errors: DetourValidationIssue[] = [];
    const warnings: DetourValidationIssue[] = [];
    if (!notice.title.trim()) errors.push(issue('title-required', 'Enter a public notice title.', 'title'));
    if (!notice.publicSummary.trim()) errors.push(issue('summary-required', 'Enter a short MyRide summary.', 'publicSummary'));
    if (!notice.publicDetails.trim()) errors.push(issue('details-required', 'Enter rider details.', 'publicDetails'));
    if (!DATE.test(notice.schedule.startDate) || !TIME.test(notice.schedule.startTime)) {
        errors.push(issue('schedule-start-invalid', 'Enter a valid start date and time.', 'schedule'));
    }
    if (notice.schedule.end.mode === 'fixed') {
        const end = notice.schedule.end;
        if (!DATE.test(end.date) || !TIME.test(end.time)) errors.push(issue('schedule-end-invalid', 'Enter a valid end date and time.', 'schedule.end'));
        else if (`${end.date}T${end.time}` <= `${notice.schedule.startDate}T${notice.schedule.startTime}`) {
            errors.push(issue('schedule-end-before-start', 'The end must be after the start.', 'schedule.end'));
        }
    }
    if (notice.schedule.recurrence.mode === 'weekly') {
        if (notice.schedule.recurrence.days.length === 0) errors.push(issue('recurrence-days-required', 'Select at least one recurring day.', 'schedule.recurrence.days'));
        if (!TIME.test(notice.schedule.recurrence.startTime) || !TIME.test(notice.schedule.recurrence.endTime)) {
            errors.push(issue('recurrence-time-invalid', 'Enter valid recurring operating hours.', 'schedule.recurrence'));
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
            if (!overlay.busSuitabilityConfirmed) errors.push(issue('bus-suitability-required', 'Confirm the replacement path is suitable for buses.', `${path}.busSuitabilityConfirmed`));
            if (overlay.detourGeometry.source === 'manual' && !overlay.detourGeometry.manualRoutingAcknowledged) errors.push(issue('manual-routing-unacknowledged', 'Acknowledge the manually routed section.', `${path}.detourGeometry`));
            const unreviewed = overlay.stopImpacts.filter(stop => !stop.reviewed);
            if (unreviewed.length > 0) errors.push(issue('stop-impacts-unreviewed', 'Review every suggested stop impact.', `${path}.stopImpacts`));
            overlay.stopImpacts.forEach((stop, stopIndex) => {
                if (stop.status === 'temporary' && (!stop.temporaryStopName?.trim() || !stop.temporaryStopPosition)) {
                    errors.push(issue('temporary-stop-incomplete', 'Temporary stops need a name and map location.', `${path}.stopImpacts.${stopIndex}`));
                }
                if (stop.status === 'closed' && !stop.replacementStopId && !stop.riderInstructions?.trim()) {
                    warnings.push(issue('closed-stop-no-alternative', 'Add a replacement stop or rider instructions for the closed stop.', `${path}.stopImpacts.${stopIndex}`));
                }
            });
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
