import type {
  DailySummary,
  DwellIncident,
  OperatorDwellSummary,
  OperatorDwellMetrics,
  DailyCascadeMetrics,
  DwellCascade,
  CascadeStopImpact,
  TerminalRecoveryStats,
} from '../performanceDataTypes';

/** Flatten dwell incidents across multiple days and re-aggregate by operator.
 *  Single source of truth for the dashboard module, report, and exporter. */
export function aggregateDwellAcrossDays(days: DailySummary[]): OperatorDwellMetrics {
  const incidents: DwellIncident[] = days.flatMap(d => d.byOperatorDwell?.incidents ?? []);

  if (incidents.length === 0) {
    return { incidents: [], byOperator: [], totalIncidents: 0, totalTrackedDwellMinutes: 0 };
  }

  const opMap = new Map<string, DwellIncident[]>();
  for (const inc of incidents) {
    const arr = opMap.get(inc.operatorId);
    if (arr) arr.push(inc);
    else opMap.set(inc.operatorId, [inc]);
  }

  // Sum stop visits and service hours across daily per-operator summaries
  const opVisitsMap = new Map<string, number>();
  const opHoursMap = new Map<string, number>();
  for (const d of days) {
    for (const op of d.byOperatorDwell?.byOperator ?? []) {
      opVisitsMap.set(op.operatorId, (opVisitsMap.get(op.operatorId) ?? 0) + (op.stopVisitCount ?? 0));
      opHoursMap.set(op.operatorId, (opHoursMap.get(op.operatorId) ?? 0) + (op.serviceHours ?? 0));
    }
  }

  const byOperator: OperatorDwellSummary[] = [];
  for (const [operatorId, opIncidents] of opMap) {
    let moderateCount = 0;
    let highCount = 0;
    let totalTrackedDwellSeconds = 0;

    for (const inc of opIncidents) {
      if (inc.severity === 'moderate') moderateCount++;
      else highCount++;
      totalTrackedDwellSeconds += inc.trackedDwellSeconds;
    }

    const visits = opVisitsMap.get(operatorId) ?? 0;
    const hours = opHoursMap.get(operatorId) ?? 0;

    byOperator.push({
      operatorId,
      moderateCount,
      highCount,
      totalIncidents: opIncidents.length,
      totalTrackedDwellSeconds,
      avgTrackedDwellSeconds: opIncidents.length > 0
        ? totalTrackedDwellSeconds / opIncidents.length
        : 0,
      stopVisitCount: visits,
      serviceHours: Math.round(hours * 100) / 100,
      incidentsPer1kVisits: visits > 0
        ? Math.round(opIncidents.length / visits * 1000 * 100) / 100
        : undefined,
      incidentsPer100ServiceHours: hours > 0
        ? Math.round(opIncidents.length / hours * 100 * 100) / 100
        : undefined,
    });
  }

  byOperator.sort((a, b) =>
    b.totalTrackedDwellSeconds - a.totalTrackedDwellSeconds || b.totalIncidents - a.totalIncidents
  );

  const totalTrackedSeconds = incidents.reduce((s, i) => s + i.trackedDwellSeconds, 0);
  const totalStopVisits = [...opVisitsMap.values()].reduce((s, v) => s + v, 0);
  const totalServiceHours = Math.round([...opHoursMap.values()].reduce((s, v) => s + v, 0) * 100) / 100;

  return {
    incidents,
    byOperator,
    totalIncidents: incidents.length,
    totalTrackedDwellMinutes: Math.round(totalTrackedSeconds / 60 * 10) / 10,
    totalStopVisits,
    totalServiceHours,
    incidentsPer1kVisits: totalStopVisits > 0
      ? Math.round(incidents.length / totalStopVisits * 1000 * 100) / 100
      : undefined,
    incidentsPer100ServiceHours: totalServiceHours > 0
      ? Math.round(incidents.length / totalServiceHours * 100 * 100) / 100
      : undefined,
  };
}

/** Flatten cascade metrics across multiple days and re-aggregate summaries. */
export function aggregateCascadeAcrossDays(days: DailySummary[]): DailyCascadeMetrics {
  const cascades: DwellCascade[] = days.flatMap(d => d.byCascade?.cascades ?? []);

  if (cascades.length === 0) {
    return {
      cascades: [],
      byStop: [],
      byTerminal: [],
      totalCascaded: 0,
      totalNonCascaded: 0,
      avgBlastRadius: 0,
      totalBlastRadius: 0,
    };
  }

  // Re-aggregate byStop across all days
  const stopMap = new Map<string, DwellCascade[]>();
  for (const c of cascades) {
    const key = `${c.stopId}||${c.stopName}||${c.routeId}`;
    const arr = stopMap.get(key);
    if (arr) arr.push(c);
    else stopMap.set(key, [c]);
  }

  const byStop: CascadeStopImpact[] = [];
  for (const [, group] of stopMap) {
    const first = group[0];
    const cascaded = group.filter(c => c.blastRadius > 0);
    const nonCascaded = group.length - cascaded.length;
    const totalBlast = group.reduce((s, c) => s + c.blastRadius, 0);
    const totalDwell = group.reduce((s, c) => s + c.trackedDwellSeconds, 0);
    const totalLate = cascaded.reduce((s, c) => s + c.totalLateSeconds, 0);

    byStop.push({
      stopName: first.stopName,
      stopId: first.stopId,
      routeId: first.routeId,
      incidentCount: group.length,
      totalTrackedDwellSeconds: totalDwell,
      totalBlastRadius: totalBlast,
      avgBlastRadius: cascaded.length > 0 ? totalBlast / cascaded.length : 0,
      cascadedCount: cascaded.length,
      nonCascadedCount: nonCascaded,
      avgTotalLateSeconds: cascaded.length > 0 ? totalLate / cascaded.length : 0,
    });
  }
  byStop.sort((a, b) => b.totalBlastRadius - a.totalBlastRadius || b.cascadedCount - a.cascadedCount);

  // Re-aggregate byTerminal: flatten daily terminal stats and merge by key
  const termMap = new Map<string, TerminalRecoveryStats[]>();
  for (const d of days) {
    for (const t of d.byCascade?.byTerminal ?? []) {
      const key = `${t.stopId}||${t.stopName}||${t.routeId}`;
      const arr = termMap.get(key);
      if (arr) arr.push(t);
      else termMap.set(key, [t]);
    }
  }

  const byTerminal: TerminalRecoveryStats[] = [];
  for (const [, group] of termMap) {
    const first = group[0];
    const totalIncidents = group.reduce((s, t) => s + t.incidentCount, 0);
    const totalAbsorbed = group.reduce((s, t) => s + t.absorbedCount, 0);
    const totalCascaded = group.reduce((s, t) => s + t.cascadedCount, 0);
    const totalRecovery = group.reduce((s, t) => s + t.avgScheduledRecoverySeconds * t.incidentCount, 0);
    const totalObsRecovery = group.reduce((s, t) => s + (t.avgObservedRecoverySeconds ?? t.avgScheduledRecoverySeconds) * t.incidentCount, 0);
    const totalExcess = group.reduce((s, t) => s + t.avgExcessLateSeconds * t.incidentCount, 0);

    byTerminal.push({
      stopName: first.stopName,
      stopId: first.stopId,
      routeId: first.routeId,
      incidentCount: totalIncidents,
      absorbedCount: totalAbsorbed,
      cascadedCount: totalCascaded,
      avgScheduledRecoverySeconds: totalIncidents > 0 ? totalRecovery / totalIncidents : 0,
      avgObservedRecoverySeconds: totalIncidents > 0 ? totalObsRecovery / totalIncidents : undefined,
      avgExcessLateSeconds: totalIncidents > 0 ? totalExcess / totalIncidents : 0,
      sufficientRecovery: totalAbsorbed >= totalIncidents * 0.75,
    });
  }
  byTerminal.sort((a, b) => b.cascadedCount - a.cascadedCount || a.absorbedCount - b.absorbedCount);

  const cascadedOnly = cascades.filter(c => c.blastRadius > 0);
  const totalBlast = cascades.reduce((s, c) => s + c.blastRadius, 0);

  return {
    cascades,
    byStop,
    byTerminal,
    totalCascaded: cascadedOnly.length,
    totalNonCascaded: cascades.length - cascadedOnly.length,
    avgBlastRadius: cascadedOnly.length > 0
      ? totalBlast / cascadedOnly.length
      : 0,
    totalBlastRadius: totalBlast,
  };
}
