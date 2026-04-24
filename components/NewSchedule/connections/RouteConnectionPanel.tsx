/**
 * RouteConnectionPanel
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ArrowRight, ArrowLeft, Check, Bus, ChevronDown, ChevronUp } from 'lucide-react';
import type {
  RouteConnectionConfig,
  RouteConnection,
  ConnectionLibrary,
  ConnectionTarget,
  ConnectionType,
  StopInfo,
} from '../../../utils/connections/connectionTypes';
import {
  buildRouteConnectionFromTarget,
  getBusConnectionAnchorLabel,
  getConnectionIntentLabel,
  getConnectionRuleSummary,
} from '../../../utils/connections/routeConnectionDefaults';

export interface OtherRouteOption {
  key: string;
  routeIdentity: string;
  routeLabel: string;
  direction: 'North' | 'South';
  stopCode: string;
  stopName: string;
}

export interface OtherRouteConnectionDraft {
  routeIdentity: string;
  routeLabel: string;
  direction: 'North' | 'South';
  currentStopCode: string;
  currentStopName: string;
  targetStopCode: string;
  targetStopName: string;
  connectionType: ConnectionType;
  bufferMinutes: number;
}

export type ExistingConnectionApplyScope = 'all_matching_routes' | 'current_route';

interface RouteConnectionPanelProps {
  config: RouteConnectionConfig | null;
  library: ConnectionLibrary | null;
  availableStops: StopInfo[];
  onUpdateConfig: (config: RouteConnectionConfig) => void;
  onAddConnection: (connection: Omit<RouteConnection, 'id'>) => void;
  onApplyExistingConnections?: (
    targetIds: string[],
    scope: ExistingConnectionApplyScope
  ) => Promise<void> | void;
  onCreateTarget?: () => void;
  otherRouteOptions?: OtherRouteOption[];
  onAddOtherRouteConnection?: (draft: OtherRouteConnectionDraft) => void;
}

export const RouteConnectionPanel: React.FC<RouteConnectionPanelProps> = ({
  config,
  library,
  availableStops,
  onUpdateConfig,
  onAddConnection,
  onApplyExistingConnections,
  onCreateTarget,
  otherRouteOptions = [],
  onAddOtherRouteConnection,
}) => {
  const [selectedExistingTargetIds, setSelectedExistingTargetIds] = useState<string[]>([]);
  const [selectedOtherRouteStopCode, setSelectedOtherRouteStopCode] = useState('');
  const [otherRouteConnectionType, setOtherRouteConnectionType] = useState<ConnectionType>('meet_departing');
  const [otherRouteBufferMinutes, setOtherRouteBufferMinutes] = useState(5);
  const [showOtherRoutesBuilder, setShowOtherRoutesBuilder] = useState(false);
  const [existingConnectionApplyScope, setExistingConnectionApplyScope] = useState<ExistingConnectionApplyScope>('all_matching_routes');
  const [isApplyingExistingConnections, setIsApplyingExistingConnections] = useState(false);

  useEffect(() => {
    if (availableStops.length === 0) {
      setSelectedOtherRouteStopCode('');
      return;
    }
    const hasSelectedStop = availableStops.some(stop => stop.code === selectedOtherRouteStopCode);
    if (!hasSelectedStop) {
      setSelectedOtherRouteStopCode(availableStops[0].code);
    }
  }, [availableStops, selectedOtherRouteStopCode]);

  const activeConfig: RouteConnectionConfig = config ?? { routeIdentity: '', connections: [] };
  const activeLibrary: ConnectionLibrary = library ?? { targets: [], updatedAt: '', updatedBy: '' };

  const connections = activeConfig.connections;
  const getTarget = (targetId: string): ConnectionTarget | undefined => activeLibrary.targets.find(t => t.id === targetId);
  const getTargetIntentLabel = (target?: Pick<ConnectionTarget, 'type' | 'icon' | 'routeIdentity' | 'name'>): string => {
    if (target?.type === 'route') {
      const routeLabel = target.routeIdentity?.replace(/-(Weekday|Saturday|Sunday)$/i, '').trim() || target.name || 'route';
      return routeLabel.toLowerCase().startsWith('route ') ? routeLabel : `Route ${routeLabel}`;
    }

    const normalizedName = target?.name?.trim().toLowerCase() || '';
    if (target?.icon === 'train' || normalizedName.includes('train') || normalizedName.includes('go')) return 'train';
    return target?.name || 'service';
  };
  const getTargetEventLabel = (target?: Pick<ConnectionTarget, 'defaultEventType'>): 'departure' | 'arrival' => (
    target?.defaultEventType === 'arrival' ? 'arrival' : 'departure'
  );
  const getRuleSelectorLabel = (
    connectionType: ConnectionType,
    target?: Pick<ConnectionTarget, 'defaultEventType' | 'type' | 'icon' | 'routeIdentity' | 'name'>,
  ): string => (
    `${getConnectionIntentLabel(connectionType, getTargetIntentLabel(target))} buffer`
  );
  const getConnectionChipLabel = (
    connectionType: ConnectionType,
    target?: Pick<ConnectionTarget, 'type' | 'icon' | 'routeIdentity' | 'name'>,
  ): string => (
    getConnectionIntentLabel(connectionType, getTargetIntentLabel(target))
  );
  const getOtherRouteOptionLabel = (connectionType: ConnectionType, routeLabel: string, bufferMinutes: number): string => (
    `${getConnectionIntentLabel(connectionType, `Route ${routeLabel}`)} • ${(
      connectionType === 'meet_departing'
        ? `${getBusConnectionAnchorLabel(connectionType)} ${Math.max(0, bufferMinutes || 0)} min before Route ${routeLabel} departs`
        : `${getBusConnectionAnchorLabel(connectionType)} ${Math.max(0, bufferMinutes || 0)} min after Route ${routeLabel} arrives`
    )}`
  );
  const getOtherRouteSelectLabel = (connectionType: ConnectionType): string => (
    connectionType === 'meet_departing'
      ? 'To other route'
      : 'From other route'
  );

  const handleToggleConnection = (connectionId: string) => {
    onUpdateConfig({
      ...activeConfig,
      connections: activeConfig.connections.map(c => (c.id === connectionId ? { ...c, enabled: !c.enabled } : c)),
    });
  };

  const handleDeleteConnection = (connectionId: string) => {
    onUpdateConfig({
      ...activeConfig,
      connections: activeConfig.connections.filter(c => c.id !== connectionId),
    });
  };

  const handleUpdateBuffer = (connectionId: string, buffer: number) => {
    onUpdateConfig({
      ...activeConfig,
      connections: activeConfig.connections.map(c => (c.id === connectionId ? { ...c, bufferMinutes: buffer } : c)),
    });
  };

  const handleUpdateStop = (connectionId: string, stopCode: string) => {
    const stopInfo = availableStops.find(s => s.code === stopCode);
    onUpdateConfig({
      ...activeConfig,
      connections: activeConfig.connections.map(c => (c.id === connectionId ? { ...c, stopCode, stopName: stopInfo?.name } : c)),
    });
  };

  const handleUpdateConnectionType = (connectionId: string, connectionType: ConnectionType) => {
    onUpdateConfig({
      ...activeConfig,
      connections: activeConfig.connections.map(c => (c.id === connectionId ? { ...c, connectionType } : c)),
    });
  };

  const routeConnections = useMemo(
    () => connections.filter(connection => getTarget(connection.targetId)?.type === 'route'),
    [connections, activeLibrary.targets],
  );
  const standardConnections = useMemo(
    () => connections.filter(connection => getTarget(connection.targetId)?.type !== 'route'),
    [connections, activeLibrary.targets],
  );
  const usedTargetIds = useMemo(() => new Set(connections.map(c => c.targetId)), [connections]);

  const existingTargetCards = useMemo(
    () =>
      activeLibrary.targets
        .filter(target => target.type !== 'route' && !usedTargetIds.has(target.id))
        .map((target, index) => ({
          target,
          candidate: buildRouteConnectionFromTarget(target, availableStops, connections.length + index + 1),
        }))
        .sort((a, b) => {
          const aStopCode = (a.candidate?.stopCode || a.target.stopCode || '').trim();
          const bStopCode = (b.candidate?.stopCode || b.target.stopCode || '').trim();
          const stopCompare = aStopCode.localeCompare(bStopCode, undefined, { numeric: true, sensitivity: 'base' });
          if (stopCompare !== 0) return stopCompare;
          return a.target.name.localeCompare(b.target.name, undefined, { sensitivity: 'base' });
        }),
    [availableStops, connections.length, activeLibrary.targets, usedTargetIds],
  );
  const visibleExistingTargetCards = useMemo(
    () => existingTargetCards.filter(entry => !!entry.candidate),
    [existingTargetCards],
  );

  const filteredOtherRouteOptions = useMemo(
    () =>
      otherRouteOptions
        .filter(option => option.stopCode === selectedOtherRouteStopCode)
        .sort((a, b) => {
          const routeCompare = a.routeLabel.localeCompare(b.routeLabel, undefined, { numeric: true, sensitivity: 'base' });
          if (routeCompare !== 0) return routeCompare;
          return a.direction.localeCompare(b.direction, undefined, { sensitivity: 'base' });
        }),
    [otherRouteOptions, selectedOtherRouteStopCode],
  );

  const existingOtherRouteKeys = useMemo(() => {
    const keys = new Set<string>();
    routeConnections.forEach(connection => {
      const target = getTarget(connection.targetId);
      if (!target?.routeIdentity || !target.direction) return;
      keys.add(`${target.routeIdentity}::${target.direction}::${connection.stopCode}`);
    });
    return keys;
  }, [routeConnections]);

  if (!config || !library) {
    return <div className="p-4 text-center text-gray-500">Loading configuration...</div>;
  }

  const toggleExistingTarget = (targetId: string, disabled: boolean) => {
    if (disabled) return;
    setSelectedExistingTargetIds(current =>
      current.includes(targetId) ? current.filter(id => id !== targetId) : [...current, targetId],
    );
  };

  const handleApplyExistingConnections = async () => {
    setIsApplyingExistingConnections(true);
    try {
      if (onApplyExistingConnections) {
        await onApplyExistingConnections(selectedExistingTargetIds, existingConnectionApplyScope);
      } else {
        const selectedCards = visibleExistingTargetCards.filter(
          entry => selectedExistingTargetIds.includes(entry.target.id) && entry.candidate,
        );
        selectedCards.forEach(entry => {
          if (entry.candidate) onAddConnection(entry.candidate);
        });
      }
      setSelectedExistingTargetIds([]);
    } finally {
      setIsApplyingExistingConnections(false);
    }
  };

  const handleAddOtherRoute = (option: OtherRouteOption) => {
    if (!onAddOtherRouteConnection) return;
    const currentStop = availableStops.find(stop => stop.code === selectedOtherRouteStopCode);
    if (!currentStop) return;
    onAddOtherRouteConnection({
      routeIdentity: option.routeIdentity,
      routeLabel: option.routeLabel,
      direction: option.direction,
      currentStopCode: currentStop.code,
      currentStopName: currentStop.name,
      targetStopCode: option.stopCode,
      targetStopName: option.stopName,
      connectionType: otherRouteConnectionType,
      bufferMinutes: Math.max(0, otherRouteBufferMinutes || 0),
    });
  };

  const visibleConnections = otherRouteOptions.length > 0 ? standardConnections : connections;

  return (
    <div className="divide-y divide-gray-100">
      {visibleConnections.length > 0 && (
        <div className="p-3 space-y-2">
          {visibleConnections.map(connection => {
            const target = getTarget(connection.targetId);
            if (!target) return null;
            return (
              <div
                key={connection.id}
                className={`border rounded-lg overflow-hidden ${connection.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}
              >
                <div className="px-3 py-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={connection.enabled}
                    onChange={() => handleToggleConnection(connection.id)}
                    className="w-4 h-4 rounded text-blue-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{target.name}</span>
                      {connection.connectionType === 'meet_departing' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded"><ArrowRight className="w-3 h-3" />{getConnectionChipLabel(connection.connectionType, target)}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded"><ArrowLeft className="w-3 h-3" />{getConnectionChipLabel(connection.connectionType, target)}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                      <span>at {connection.stopName}</span><span>•</span><span>{getConnectionRuleSummary(connection.connectionType, connection.bufferMinutes, getTargetEventLabel(target))}</span>
                    </div>
                  </div>
                  <button onClick={() => handleDeleteConnection(connection.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
                {connection.enabled && (
                  <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">Connection stop:</label>
                      <select value={connection.stopCode} onChange={e => handleUpdateStop(connection.id, e.target.value)} className="text-xs border border-gray-200 rounded px-2 py-1">
                        {availableStops.map(stop => <option key={stop.code} value={stop.code}>{stop.name} (#{stop.code})</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">{getRuleSelectorLabel(connection.connectionType, target)}:</label>
                      <input type="number" min={0} max={30} value={connection.bufferMinutes} onChange={e => handleUpdateBuffer(connection.id, parseInt(e.target.value) || 0)} className="w-14 text-xs border border-gray-200 rounded px-2 py-1" />
                      <span className="text-xs text-gray-500">min</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="p-3 space-y-3">
        <button
          onClick={onCreateTarget}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Create new connection
        </button>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-medium text-gray-900">Use existing connections</h4>
              <p className="text-xs text-gray-500">Select one or more existing connections, then apply them to this route.</p>
            </div>
            <span className="text-xs text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full">{visibleExistingTargetCards.length}</span>
          </div>

          {otherRouteOptions.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowOtherRoutesBuilder(current => !current)}
                className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${showOtherRoutesBuilder ? 'border-blue-200 bg-blue-50/70' : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="rounded-full bg-blue-100 p-1 text-blue-600">
                        <Bus className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-sm font-medium text-gray-900 truncate">Other routes</p>
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">{routeConnections.length} added</span>
                    </div>
                    <div className="mt-1 space-y-1 text-xs text-gray-500">
                      <p>Connect this route to another route that also serves one of its stops.</p>
                      <p>{showOtherRoutesBuilder ? 'Hide route-to-route options' : 'Open route-to-route options'}</p>
                    </div>
                  </div>
                  <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500">
                    {showOtherRoutesBuilder ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </span>
                </div>
              </button>

              {showOtherRoutesBuilder && (
                <div className="rounded-lg border border-blue-200 bg-white p-3 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium uppercase tracking-wide text-gray-500">This route stop</label>
                      <select value={selectedOtherRouteStopCode} onChange={e => setSelectedOtherRouteStopCode(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                        {availableStops.map(stop => <option key={stop.code} value={stop.code}>{stop.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Connection direction</label>
                      <select value={otherRouteConnectionType} onChange={e => setOtherRouteConnectionType(e.target.value as ConnectionType)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                        <option value="meet_departing">{getOtherRouteSelectLabel('meet_departing')}</option>
                        <option value="feed_arriving">{getOtherRouteSelectLabel('feed_arriving')}</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Minutes</label>
                    <input type="number" min={0} max={30} value={otherRouteBufferMinutes} onChange={e => setOtherRouteBufferMinutes(parseInt(e.target.value) || 0)} className="w-20 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900" />
                    <span className="text-xs text-gray-500">Default is 5 min</span>
                  </div>

                  {filteredOtherRouteOptions.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">No other routes serve this stop yet.</div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {filteredOtherRouteOptions.map(option => {
                        const isAdded = existingOtherRouteKeys.has(`${option.routeIdentity}::${option.direction}::${selectedOtherRouteStopCode}`);
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => handleAddOtherRoute(option)}
                            disabled={isAdded}
                            className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${isAdded ? 'cursor-not-allowed border-gray-200 bg-white text-gray-400' : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50'}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Bus className="w-4 h-4 text-blue-500" />
                                  <p className="text-sm font-medium text-gray-900 truncate">Route {option.routeLabel}</p>
                                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">{option.direction}</span>
                                </div>
                                <div className="mt-1 space-y-1 text-xs text-gray-500">
                                  <p>{option.stopName}</p>
                                  <p>{getOtherRouteOptionLabel(otherRouteConnectionType, option.routeLabel, otherRouteBufferMinutes)}</p>
                                </div>
                              </div>
                              <span className={`mt-0.5 inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold ${isAdded ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-700'}`}>{isAdded ? 'Added' : 'Add route'}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {routeConnections.length > 0 && (
                    <div className="space-y-2 border-t border-gray-200 pt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Added other routes</p>
                      {routeConnections.map(connection => {
                        const target = getTarget(connection.targetId);
                        if (!target) return null;
                        return (
                          <div key={connection.id} className={`rounded-lg border ${connection.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                            <div className="flex items-start gap-2 px-3 py-3">
                              <input type="checkbox" checked={connection.enabled} onChange={() => handleToggleConnection(connection.id)} className="mt-0.5 h-4 w-4 rounded text-blue-600" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-gray-900">Route {target.routeIdentity?.replace(/-(Weekday|Saturday|Sunday)$/i, '') || target.name}</span>
                                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">{target.direction || 'Route'}</span>
                                </div>
                                <p className="mt-1 text-xs text-gray-500">Stop: {connection.stopName || target.stopName || '—'}</p>
                                {connection.enabled && (
                                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
                                    <div className="space-y-1">
                                      <label className="text-xs text-gray-500">Connection direction</label>
                                      <select value={connection.connectionType} onChange={e => handleUpdateConnectionType(connection.id, e.target.value as ConnectionType)} className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm">
                                        <option value="meet_departing">{getOtherRouteSelectLabel('meet_departing')}</option>
                                        <option value="feed_arriving">{getOtherRouteSelectLabel('feed_arriving')}</option>
                                      </select>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-xs text-gray-500">Minutes</label>
                                      <input type="number" min={0} max={30} value={connection.bufferMinutes} onChange={e => handleUpdateBuffer(connection.id, parseInt(e.target.value) || 0)} className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm" />
                                    </div>
                                  </div>
                                )}
                              </div>
                              <button onClick={() => handleDeleteConnection(connection.id)} className="p-1 text-gray-400 hover:text-red-500" aria-label={`Delete ${target.name}`}><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {visibleExistingTargetCards.length === 0 ? (
            otherRouteOptions.length > 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">
                {existingTargetCards.length === 0
                  ? 'No saved connections are available yet. You can still use Other routes above.'
                  : 'No saved connections match stops on this route. You can still use Other routes above.'}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">
                {existingTargetCards.length === 0
                  ? 'No existing connections are available yet.'
                  : 'No saved connections match stops on this route.'}
              </div>
            )
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2">
                {visibleExistingTargetCards.map(({ target, candidate }) => {
                  const isSelected = selectedExistingTargetIds.includes(target.id);
                  const ruleSummary = candidate ? getConnectionRuleSummary(candidate.connectionType, candidate.bufferMinutes, getTargetEventLabel(target)) : 'No matching stop found on this route';
                  return (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => toggleExistingTarget(target.id, false)}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{target.name}</p>
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${target.defaultEventType === 'arrival' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{getConnectionChipLabel(candidate.connectionType, target)}</span>
                          </div>
                          <div className="mt-1 space-y-1 text-xs text-gray-500">
                            <p className="truncate">Stop {candidate?.stopCode || target.stopCode || '—'} • {target.location || target.stopName || 'Connection target'}</p>
                            <p>{ruleSummary}</p>
                            {candidate?.stopName && <p>Attach at {candidate.stopName}</p>}
                          </div>
                        </div>
                        <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border ${isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-transparent'}`}><Check className="w-3.5 h-3.5" /></span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-end">
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
                  {onApplyExistingConnections && (
                    <div className="space-y-1">
                      <label className="text-xs text-gray-500">Apply to</label>
                      <select
                        value={existingConnectionApplyScope}
                        onChange={e => setExistingConnectionApplyScope(e.target.value as ExistingConnectionApplyScope)}
                        disabled={isApplyingExistingConnections}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 sm:w-64"
                      >
                        <option value="all_matching_routes">All matching routes in this draft</option>
                        <option value="current_route">This route only</option>
                      </select>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleApplyExistingConnections}
                    disabled={selectedExistingTargetIds.length === 0 || isApplyingExistingConnections}
                    className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isApplyingExistingConnections ? 'Applying…' : `Apply existing connection${selectedExistingTargetIds.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RouteConnectionPanel;
