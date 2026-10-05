import React from 'react';
import {createRoot} from 'react-dom/client';
import {RegionalTransitConnections} from '../../../../components/connections/RegionalTransitConnections';
import {schedules} from './fixture';
createRoot(document.getElementById('root')!).render(<><div className="proof-shell">Browser verification · fixture bus masters / real public GO GTFS</div><div className="regional-master-browser"><RegionalTransitConnections schedules={schedules as any} readTeamId="browser-fixture" dayTypeForDate={date => date === '2026-10-12' ? 'No Service' : new Date(`${date}T12:00:00`).getDay() === 0 ? 'Sunday' : new Date(`${date}T12:00:00`).getDay() === 6 ? 'Saturday' : 'Weekday'} /></div></>);
