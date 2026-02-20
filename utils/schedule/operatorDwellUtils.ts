import type {
  DailySummary,
  DwellIncident,
  OperatorDwellSummary,
  OperatorDwellMetrics,
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

    byOperator.push({
      operatorId,
      moderateCount,
      highCount,
      totalIncidents: opIncidents.length,
      totalTrackedDwellSeconds,
      avgTrackedDwellSeconds: opIncidents.length > 0
        ? totalTrackedDwellSeconds / opIncidents.length
        : 0,
    });
  }

  byOperator.sort((a, b) =>
    b.totalIncidents - a.totalIncidents || b.totalTrackedDwellSeconds - a.totalTrackedDwellSeconds
  );

  const totalTrackedSeconds = incidents.reduce((s, i) => s + i.trackedDwellSeconds, 0);

  return {
    incidents,
    byOperator,
    totalIncidents: incidents.length,
    totalTrackedDwellMinutes: Math.round(totalTrackedSeconds / 60 * 10) / 10,
  };
}
