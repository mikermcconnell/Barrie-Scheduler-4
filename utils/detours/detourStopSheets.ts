import type { DetourCoordinate, DetourNotice } from './detourTypes';
import type { DetourRouteCopyInput } from './detourCopy';

export type DetourStopSheetKind = 'closed' | 'temporary';

export const DETOUR_NOTICE_COLORS = {
  master: '#07557F',
  closed: '#BF1E2D',
  temporary: '#066839',
} as const;

export interface DetourStopSheet {
  id: string;
  kind: DetourStopSheetKind;
  stopCode?: string;
  stopName: string;
  position: DetourCoordinate;
  routes: DetourRouteCopyInput[];
}

interface MutableStopSheet extends DetourStopSheet {
  routeKeys: Set<string>;
}

function normalized(value?: string): string {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function naturalStopCompare(first: DetourStopSheet, second: DetourStopSheet): number {
  return (first.stopCode || first.stopName).localeCompare(second.stopCode || second.stopName, 'en-CA', {
    numeric: true,
    sensitivity: 'base',
  });
}

function routeKey(route: DetourRouteCopyInput): string {
  return `${route.routeShortName.trim().toUpperCase()}|${normalized(route.directionLabel).toUpperCase()}`;
}

/**
 * Builds the physical stop sheets from reviewed route impacts. These pages are
 * derived from the notice so they cannot drift away from the master detour.
 */
export function buildDetourStopSheets(notice: DetourNotice): DetourStopSheet[] {
  const sheets = new Map<string, MutableStopSheet>();

  notice.overlays.forEach((overlay) => {
    const route: DetourRouteCopyInput = {
      routeShortName: normalized(overlay.routeSnapshot.routeShortName),
      directionLabel: normalized(overlay.routeSnapshot.directionLabel) || undefined,
    };
    const currentRouteKey = routeKey(route);

    overlay.stopImpacts.forEach((impact) => {
      if (!impact.reviewed || (impact.status !== 'closed' && impact.status !== 'temporary')) return;

      const kind = impact.status;
      const stopCode = normalized(kind === 'closed' ? impact.sourceStop?.stopCode : impact.temporaryStopCode);
      const stopName = normalized(kind === 'closed' ? impact.sourceStop?.name : impact.temporaryStopName);
      const position = kind === 'closed' ? impact.sourceStop?.position : impact.temporaryStopPosition;
      if (!stopName || !position) return;

      const sourceIdentity = kind === 'closed'
        ? `${normalized(overlay.routeSnapshot.feedId) || 'default'}:${impact.sourceStop?.stopId ?? impact.id}`
        : stopCode
          ? `code:${stopCode.toUpperCase()}`
          : `${overlay.id}:${impact.id}`;
      const key = `${kind}:${sourceIdentity}`;
      const existing = sheets.get(key);
      if (existing) {
        if (!existing.routeKeys.has(currentRouteKey)) {
          existing.routes.push(route);
          existing.routeKeys.add(currentRouteKey);
        }
        return;
      }

      sheets.set(key, {
        id: key,
        kind,
        stopCode: stopCode || undefined,
        stopName,
        position,
        routes: [route],
        routeKeys: new Set([currentRouteKey]),
      });
    });
  });

  const result = [...sheets.values()].map(({ routeKeys: _routeKeys, ...sheet }) => ({
    ...sheet,
    routes: [...sheet.routes].sort((first, second) => routeKey(first).localeCompare(routeKey(second), 'en-CA', { numeric: true })),
  }));
  return [
    ...result.filter(sheet => sheet.kind === 'closed').sort(naturalStopCompare),
    ...result.filter(sheet => sheet.kind === 'temporary').sort(naturalStopCompare),
  ];
}

export function routeDirectionSuffix(direction?: string): string {
  const value = normalized(direction).toUpperCase();
  if (/^(N|NB|NORTHBOUND)$/.test(value)) return 'NB';
  if (/^(S|SB|SOUTHBOUND)$/.test(value)) return 'SB';
  if (/^(E|EB|EASTBOUND)$/.test(value)) return 'EB';
  if (/^(W|WB|WESTBOUND)$/.test(value)) return 'WB';
  return '';
}

export function formatDetourPublicationRoute(route: DetourRouteCopyInput): string {
  const shortName = normalized(route.routeShortName);
  const suffix = routeDirectionSuffix(route.directionLabel);
  return suffix && !shortName.toUpperCase().endsWith(`-${suffix}`) ? `${shortName}-${suffix}` : shortName;
}

export function formatDetourStopSheetRoutes(routes: DetourRouteCopyInput[]): string {
  const labels = [...new Set(routes.map(formatDetourPublicationRoute).filter(Boolean))];
  const joined = labels.length <= 1
    ? labels[0] ?? ''
    : labels.length === 2
      ? `${labels[0]} & ${labels[1]}`
      : `${labels.slice(0, -1).join(', ')}, & ${labels.at(-1)}`;
  return `${labels.length === 1 ? 'Route' : 'Routes'} ${joined}`.trim();
}

export function formatDetourStopSheetTitle(sheet: DetourStopSheet): string {
  if (sheet.kind === 'temporary') return `TEMPORARY STOP${sheet.stopCode ? ` ${sheet.stopCode}` : ''}`;
  return 'STOP CLOSURE NOTICE';
}

export function formatDetourStopSheetSubtitle(sheet: DetourStopSheet): string {
  if (sheet.kind === 'temporary') return formatDetourStopSheetRoutes(sheet.routes);
  return `${sheet.stopCode ? `Stop ${sheet.stopCode} - ` : ''}${sheet.stopName}`;
}
