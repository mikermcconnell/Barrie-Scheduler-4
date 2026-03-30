/**
 * RouteConnectionPanel
 *
 * Manages per-route connection configurations.
 * Allows users to select which targets to connect to and configure buffers.
 */

import React, { useState } from 'react';
import {
    Plus,
    Trash2,
    GripVertical,
    ArrowRight,
    ArrowLeft,
    Clock,
    AlertTriangle
} from 'lucide-react';
import type {
    RouteConnectionConfig,
    RouteConnection,
    ConnectionLibrary,
    ConnectionTarget,
    ConnectionType,
    StopInfo
} from '../../../utils/connections/connectionTypes';
import { formatConnectionTime } from '../../../utils/connections/connectionTypes';

interface RouteConnectionPanelProps {
    config: RouteConnectionConfig | null;
    library: ConnectionLibrary | null;
    availableStops: StopInfo[];
    onUpdateConfig: (config: RouteConnectionConfig) => void;
    onAddConnection: (connection: Omit<RouteConnection, 'id'>) => void;
}

export const RouteConnectionPanel: React.FC<RouteConnectionPanelProps> = ({
    config,
    library,
    availableStops,
    onUpdateConfig,
    onAddConnection
}) => {
    const [showAddForm, setShowAddForm] = useState(false);
    const [newConnection, setNewConnection] = useState<{
        targetId: string;
        connectionType: ConnectionType;
        bufferMinutes: number;
        stopCode: string;
    }>({
        targetId: '',
        connectionType: 'meet_departing',
        bufferMinutes: 5,
        stopCode: ''
    });

    if (!config || !library) {
        return (
            <div className="p-4 text-center text-gray-500">
                Loading configuration...
            </div>
        );
    }

    const connections = config.connections;

    // Get target by ID
    const getTarget = (targetId: string): ConnectionTarget | undefined => {
        return library.targets.find(t => t.id === targetId);
    };

    const getDefaultConnectionTypeForTarget = (targetId: string): ConnectionType => {
        const target = getTarget(targetId);
        return target?.defaultEventType === 'arrival' ? 'feed_arriving' : 'meet_departing';
    };

    // Toggle connection enabled
    const handleToggleConnection = (connectionId: string) => {
        onUpdateConfig({
            ...config,
            connections: config.connections.map(c =>
                c.id === connectionId ? { ...c, enabled: !c.enabled } : c
            )
        });
    };

    // Delete connection
    const handleDeleteConnection = (connectionId: string) => {
        onUpdateConfig({
            ...config,
            connections: config.connections.filter(c => c.id !== connectionId)
        });
    };

    // Update connection buffer
    const handleUpdateBuffer = (connectionId: string, buffer: number) => {
        onUpdateConfig({
            ...config,
            connections: config.connections.map(c =>
                c.id === connectionId ? { ...c, bufferMinutes: buffer } : c
            )
        });
    };

    // Update connection stop
    const handleUpdateStop = (connectionId: string, stopCode: string) => {
        const stopInfo = availableStops.find(s => s.code === stopCode);
        onUpdateConfig({
            ...config,
            connections: config.connections.map(c =>
                c.id === connectionId ? { ...c, stopCode, stopName: stopInfo?.name } : c
            )
        });
    };

    // Add new connection
    const handleAddConnection = () => {
        if (!newConnection.targetId || !newConnection.stopCode) return;

        const stopInfo = availableStops.find(s => s.code === newConnection.stopCode);
        onAddConnection({
            targetId: newConnection.targetId,
            connectionType: newConnection.connectionType,
            bufferMinutes: newConnection.bufferMinutes,
            stopCode: newConnection.stopCode,
            stopName: stopInfo?.name,
            priority: connections.length + 1,
            enabled: true
        });

        // Reset form
        setNewConnection({
            targetId: '',
            connectionType: 'meet_departing',
            bufferMinutes: 5,
            stopCode: ''
        });
        setShowAddForm(false);
    };

    // Available targets (not already added)
    const usedTargetIds = new Set(connections.map(c => c.targetId));
    const availableTargets = library.targets.filter(t => !usedTargetIds.has(t.id));

    return (
        <div className="divide-y divide-gray-100">
            {/* Connection list */}
            {connections.length === 0 ? (
                <div className="p-8 text-center">
                    <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">No connections configured</p>
                    <p className="text-xs text-gray-400 mt-1">
                        Add connections from your library to optimize this route
                    </p>
                </div>
            ) : (
                <div className="p-3 space-y-2">
                    {connections.map((connection, index) => {
                        const target = getTarget(connection.targetId);
                        if (!target) return null;

                        return (
                            <div
                                key={connection.id}
                                className={`border rounded-lg overflow-hidden ${
                                    connection.enabled
                                        ? 'border-gray-200 bg-white'
                                        : 'border-gray-100 bg-gray-50 opacity-60'
                                }`}
                            >
                                {/* Connection header */}
                                <div className="px-3 py-2 flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={connection.enabled}
                                        onChange={() => handleToggleConnection(connection.id)}
                                        className="w-4 h-4 rounded text-blue-600"
                                    />

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-gray-900 truncate">
                                                {target.name}
                                            </span>
                                            {connection.connectionType === 'meet_departing' ? (
                                                <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                                    <ArrowRight className="w-3 h-3" />
                                                    meet
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                                                    <ArrowLeft className="w-3 h-3" />
                                                    feed
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                                            <span>at {connection.stopName}</span>
                                            <span>•</span>
                                            <span>{connection.bufferMinutes} min buffer</span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => handleDeleteConnection(connection.id)}
                                        className="p-1 text-gray-400 hover:text-red-500"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Connection config (expanded when enabled) */}
                                {connection.enabled && (
                                    <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <label className="text-xs text-gray-500">Stop:</label>
                                            <select
                                                value={connection.stopCode}
                                                onChange={(e) => handleUpdateStop(connection.id, e.target.value)}
                                                className="text-xs border border-gray-200 rounded px-2 py-1"
                                            >
                                                {availableStops.map(stop => (
                                                    <option key={stop.code} value={stop.code}>
                                                        {stop.name} (#{stop.code})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <label className="text-xs text-gray-500">Buffer:</label>
                                            <input
                                                type="number"
                                                min={0}
                                                max={30}
                                                value={connection.bufferMinutes}
                                                onChange={(e) => handleUpdateBuffer(connection.id, parseInt(e.target.value) || 0)}
                                                className="w-14 text-xs border border-gray-200 rounded px-2 py-1"
                                            />
                                            <span className="text-xs text-gray-500">min</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add connection form */}
            {showAddForm ? (
                <div className="p-3 bg-blue-50">
                    <h4 className="text-sm font-medium text-gray-900 mb-3">Add Connection</h4>

                    {availableTargets.length === 0 ? (
                        <div className="flex items-center gap-2 text-sm text-amber-600">
                            <AlertTriangle className="w-4 h-4" />
                            <span>All targets have been added. Create more in the library.</span>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {/* Target select */}
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Target</label>
                                <select
                                    value={newConnection.targetId}
                                    onChange={(e) => {
                                        const nextTargetId = e.target.value;
                                        setNewConnection({
                                            ...newConnection,
                                            targetId: nextTargetId,
                                            connectionType: nextTargetId
                                                ? getDefaultConnectionTypeForTarget(nextTargetId)
                                                : 'meet_departing'
                                        });
                                    }}
                                    className="w-full text-sm border border-gray-200 rounded px-2 py-1.5"
                                >
                                    <option value="">Select a target...</option>
                                    {availableTargets.map(target => (
                                        <option key={target.id} value={target.id}>
                                            {target.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Connection type */}
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Type</label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setNewConnection({ ...newConnection, connectionType: 'meet_departing' })}
                                        className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded text-sm ${
                                            newConnection.connectionType === 'meet_departing'
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-white border border-gray-200 text-gray-700'
                                        }`}
                                    >
                                        <ArrowRight className="w-3 h-3" />
                                        Meet Departing
                                    </button>
                                    <button
                                        onClick={() => setNewConnection({ ...newConnection, connectionType: 'feed_arriving' })}
                                        className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded text-sm ${
                                            newConnection.connectionType === 'feed_arriving'
                                                ? 'bg-purple-600 text-white'
                                                : 'bg-white border border-gray-200 text-gray-700'
                                        }`}
                                    >
                                        <ArrowLeft className="w-3 h-3" />
                                        Feed Arriving
                                    </button>
                                </div>
                            </div>

                            {/* Stop select */}
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">At Stop</label>
                                <select
                                    value={newConnection.stopCode}
                                    onChange={(e) => setNewConnection({ ...newConnection, stopCode: e.target.value })}
                                    className="w-full text-sm border border-gray-200 rounded px-2 py-1.5"
                                >
                                    <option value="">Select stop...</option>
                                    {availableStops.map(stop => (
                                        <option key={stop.code} value={stop.code}>
                                            {stop.name} (#{stop.code})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Buffer */}
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">
                                    Buffer (minutes {newConnection.connectionType === 'meet_departing' ? 'before' : 'after'})
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    max={30}
                                    value={newConnection.bufferMinutes}
                                    onChange={(e) => setNewConnection({ ...newConnection, bufferMinutes: parseInt(e.target.value) || 0 })}
                                    className="w-20 text-sm border border-gray-200 rounded px-2 py-1.5"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-2">
                                <button
                                    onClick={handleAddConnection}
                                    disabled={!newConnection.targetId || !newConnection.stopCode}
                                    className="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Add Connection
                                </button>
                                <button
                                    onClick={() => setShowAddForm(false)}
                                    className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded text-sm hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="p-3">
                    <button
                        onClick={() => setShowAddForm(true)}
                        disabled={library.targets.length === 0}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus className="w-4 h-4" />
                        Add Connection
                    </button>
                </div>
            )}
        </div>
    );
};

export default RouteConnectionPanel;
