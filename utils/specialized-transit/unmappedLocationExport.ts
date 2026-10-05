import type { SpecializedTransitDatasetV1 } from './types';

export interface SpecializedTransitUnmappedResearchRow {
  id: string;
  displayName: string;
  aliases: string[];
  endpointTouches: number;
}

export function getSpecializedTransitUnmappedResearchRows(
  dataset: SpecializedTransitDatasetV1,
): SpecializedTransitUnmappedResearchRow[] {
  const activityByLocation = new Map<string, number>();
  for (const month of Object.values(dataset.months)) {
    for (const bucket of month.activityBuckets) {
      activityByLocation.set(
        bucket.locationId,
        (activityByLocation.get(bucket.locationId) ?? 0) + bucket.pickups + bucket.dropoffs,
      );
    }
  }

  return Object.values(dataset.locations)
    .filter(location => location.status === 'unmapped')
    .map(location => ({
      id: location.id,
      displayName: location.displayName,
      aliases: [...new Set(location.aliases)].sort((a, b) => a.localeCompare(b)),
      endpointTouches: activityByLocation.get(location.id) ?? 0,
    }))
    .sort((a, b) => b.endpointTouches - a.endpointTouches
      || a.displayName.localeCompare(b.displayName));
}

export function buildSpecializedTransitUnmappedResearchText(
  dataset: SpecializedTransitDatasetV1,
): string {
  const rows = getSpecializedTransitUnmappedResearchRows(dataset);
  const months = Object.keys(dataset.months).sort();
  const lines = [
    'Specialized Transit unmapped-location research list',
    `Months: ${months.join(', ') || 'none'}`,
    `Unmapped locations: ${rows.length}`,
    'Priority metric: total pickup plus drop-off endpoint touches across saved months',
    '',
  ];

  rows.forEach((row, index) => {
    const alternateAliases = row.aliases.filter(alias => alias !== row.displayName);
    lines.push(
      `${index + 1}. ${row.displayName} | ${row.endpointTouches} endpoint touches | ID ${row.id}`
      + (alternateAliases.length > 0 ? ` | Aliases: ${alternateAliases.join('; ')}` : ''),
    );
  });
  return lines.join('\n');
}
