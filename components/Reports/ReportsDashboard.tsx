import React from 'react';
import { PublicTimetable } from './PublicTimetable';
import { parseTimetablePublisherHash } from '../../utils/reports/timetableNavigation';

interface ReportsDashboardProps {
    onClose: () => void;
}

export const ReportsDashboard: React.FC<ReportsDashboardProps> = ({ onClose }) => {
    const initialSelection = parseTimetablePublisherHash();
    return (
        <PublicTimetable
            onBack={onClose}
            initialRouteNumber={initialSelection.routeNumber}
        />
    );
};
