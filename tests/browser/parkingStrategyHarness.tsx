import React from 'react';
import { createRoot } from 'react-dom/client';
import { ParkingStrategyWorkspaceContent, parkingStrategyServices, type ParkingStrategyServices } from '../../components/Parking/ParkingStrategyWorkspace';
import { parkingStrategyFixture } from '../fixtures/parkingStrategyFixture';
import { buildParkingLocoMobiHistorySnapshot } from '../../utils/parking/parkingLocoMobiAggregation';

const fixture = parkingStrategyFixture();
let history = fixture.history;
let locations = fixture.locations;
// Browser-only fixture stores: these functions never call Firestore or Storage.
const services: ParkingStrategyServices = {
  ...parkingStrategyServices,
  loadHistory: async () => structuredClone(history),
  loadSettings: async () => structuredClone(fixture.settings),
  loadLocations: async () => structuredClone(locations),
  saveHistory: async (_teamId, _userId, parsed, expectedRevision) => {
    if (expectedRevision !== history.manifest.revision) throw new Error('Fixture history revision changed.');
    const snapshot = buildParkingLocoMobiHistorySnapshot(parsed);
    history = { snapshot, manifest: { ...history.manifest, revision: history.manifest.revision + 1, coverage: snapshot.coverage, reconciliation: snapshot.reconciliation, importFingerprint: `fixture-${history.manifest.revision + 1}` } };
    return structuredClone(history);
  },
  saveLocations: async (_teamId, userId, links, expectedRevision) => {
    if (expectedRevision !== locations.revision) throw new Error('Fixture mapping revision changed.');
    locations = { revision: locations.revision + 1, links: structuredClone(links), updatedAt: new Date().toISOString(), updatedBy: userId };
    return structuredClone(locations);
  },
};
if (!window.location.hash.startsWith('#parking/strategy')) window.location.hash = '#parking/strategy';
createRoot(document.getElementById('root')!).render(<><div style={{ padding: 8, textAlign: 'center', background: '#fff3cd', fontSize: 12 }}>Browser verification fixture · changes stay in this page · no production data writes</div><ParkingStrategyWorkspaceContent teamId="browser-team" userId="browser-planner" canEdit services={services} /></>);
