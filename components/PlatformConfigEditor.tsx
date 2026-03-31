/**
 * Platform Config Editor
 *
 * Modal for team admins to manage hub/platform configuration.
 * Edits stored in Firestore via platformConfigService.
 */

import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, RotateCcw } from 'lucide-react';
import { useToast } from './contexts/ToastContext';
import {
    buildDefaultPlatformConfig,
    getPlatformConfig,
    getPlatformConfigErrorMessage,
    savePlatformConfig,
} from '../utils/platform/platformConfigService';
import { HUBS, type HubConfig, type PlatformAssignment } from '../utils/platform/platformConfig';

interface PlatformConfigEditorProps {
    teamId: string;
    userId: string;
    onClose: () => void;
    onSaved: () => void;
}

export const PlatformConfigEditor: React.FC<PlatformConfigEditorProps> = ({
    teamId,
    userId,
    onClose,
    onSaved
}) => {
    const toast = useToast();
    const [hubs, setHubs] = useState<HubConfig[]>([]);
    const [selectedHubIndex, setSelectedHubIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [loadWarning, setLoadWarning] = useState<string | null>(null);

    // Load config on mount
    useEffect(() => {
        (async () => {
            try {
                const existing = await getPlatformConfig(teamId);
                if (existing && existing.hubs.length > 0) {
                    setHubs(JSON.parse(JSON.stringify(existing.hubs)));
                    setLoadWarning(null);
                } else {
                    const defaults = buildDefaultPlatformConfig();
                    setHubs(JSON.parse(JSON.stringify(defaults.hubs)));
                    setLoadWarning(null);
                }
            } catch (error) {
                console.error('Error loading platform config:', error);
                const defaults = buildDefaultPlatformConfig();
                setHubs(JSON.parse(JSON.stringify(defaults.hubs)));
                setLoadWarning(getPlatformConfigErrorMessage(error, 'load'));
            } finally {
                setLoading(false);
            }
        })();
    }, [teamId]);

    const selectedHub = hubs[selectedHubIndex] || null;

    // Validation
    function validate(): string[] {
        const errs: string[] = [];
        const hubNames = new Set<string>();

        for (const hub of hubs) {
            if (!hub.name.trim()) {
                errs.push('All hubs must have a name');
            }
            if (hubNames.has(hub.name.toLowerCase())) {
                errs.push(`Duplicate hub name: "${hub.name}"`);
            }
            hubNames.add(hub.name.toLowerCase());

            if (hub.stopCodes.length === 0 && hub.stopNamePatterns.length === 0) {
                errs.push(`Hub "${hub.name}" needs at least one stop code or name pattern`);
            }

            const platformIds = new Set<string>();
            for (const p of hub.platforms) {
                if (!p.platformId.trim()) {
                    errs.push(`Hub "${hub.name}" has a platform with no ID`);
                }
                if (platformIds.has(p.platformId)) {
                    errs.push(`Hub "${hub.name}" has duplicate platform ID: "${p.platformId}"`);
                }
                platformIds.add(p.platformId);

                if ((p.capacity || 1) < 1) {
                    errs.push(`Platform "${p.platformId}" capacity must be >= 1`);
                }
            }
        }

        return errs;
    }

    // Save handler
    async function handleSave() {
        const validationErrors = validate();
        if (validationErrors.length > 0) {
            setErrors(validationErrors);
            return;
        }
        setErrors([]);
        setSaving(true);
        try {
            await savePlatformConfig(teamId, { hubs }, userId);
            toast?.success('Platform configuration saved');
            onSaved();
        } catch (error) {
            console.error('Error saving platform config:', error);
            setErrors([getPlatformConfigErrorMessage(error, 'save')]);
        } finally {
            setSaving(false);
        }
    }

    // Reset to defaults
    async function handleResetDefaults() {
        setHubs(JSON.parse(JSON.stringify(HUBS)));
        setSelectedHubIndex(0);
        setErrors([]);
        setLoadWarning(null);
    }

    // Hub mutations
    function addHub() {
        const newHub: HubConfig = {
            name: `New Hub ${hubs.length + 1}`,
            stopCodes: [],
            stopNamePatterns: [],
            platforms: []
        };
        setHubs([...hubs, newHub]);
        setSelectedHubIndex(hubs.length);
    }

    function deleteHub(index: number) {
        const next = hubs.filter((_, i) => i !== index);
        setHubs(next);
        setSelectedHubIndex(next.length === 0 ? 0 : Math.min(selectedHubIndex, next.length - 1));
    }

    function updateHub(index: number, updates: Partial<HubConfig>) {
        setHubs(hubs.map((h, i) => i === index ? { ...h, ...updates } : h));
    }

    // Platform mutations
    function addPlatform() {
        if (!selectedHub) return;
        const newPlatform: PlatformAssignment = {
            platformId: `P${selectedHub.platforms.length + 1}`,
            routes: [],
            capacity: 1
        };
        updateHub(selectedHubIndex, {
            platforms: [...selectedHub.platforms, newPlatform]
        });
    }

    function updatePlatform(pIndex: number, updates: Partial<PlatformAssignment>) {
        if (!selectedHub) return;
        const newPlatforms = selectedHub.platforms.map((p, i) =>
            i === pIndex ? { ...p, ...updates } : p
        );
        updateHub(selectedHubIndex, { platforms: newPlatforms });
    }

    function deletePlatform(pIndex: number) {
        if (!selectedHub) return;
        updateHub(selectedHubIndex, {
            platforms: selectedHub.platforms.filter((_, i) => i !== pIndex)
        });
    }

    if (loading) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                <div className="bg-white rounded-xl p-8 shadow-xl">
                    <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
                    <p className="text-sm text-gray-500 mt-3">Loading configuration...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="bg-white rounded-xl shadow-xl w-[900px] max-h-[85vh] flex flex-col"
                onClick={e => e.stopPropagation()}>

                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">Platform Configuration</h2>
                    <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* Hub List (left sidebar) */}
                    <div className="w-56 border-r border-gray-200 flex flex-col">
                        <div className="p-3 border-b border-gray-100">
                            <button
                                onClick={addHub}
                                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                            >
                                <Plus size={14} /> Add Hub
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {hubs.map((hub, i) => (
                                <div
                                    key={i}
                                    className={`flex items-center justify-between px-3 py-2 cursor-pointer text-sm transition-colors ${
                                        i === selectedHubIndex
                                            ? 'bg-blue-50 text-blue-900 font-medium'
                                            : 'text-gray-700 hover:bg-gray-50'
                                    }`}
                                    onClick={() => setSelectedHubIndex(i)}
                                >
                                    <span className="truncate">{hub.name || '(unnamed)'}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteHub(i); }}
                                        className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors"
                                        title="Delete hub"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Hub Editor (right side) */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-5">
                        {selectedHub ? (
                            <>
                                {/* Hub name */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Hub Name</label>
                                    <input
                                        type="text"
                                        value={selectedHub.name}
                                        onChange={e => updateHub(selectedHubIndex, { name: e.target.value })}
                                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>

                                {/* Stop codes */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Stop Codes <span className="text-gray-400">(comma-separated)</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={selectedHub.stopCodes.join(', ')}
                                        onChange={e => updateHub(selectedHubIndex, {
                                            stopCodes: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                        })}
                                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="e.g., 777, 778"
                                    />
                                </div>

                                {/* Stop name patterns */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Stop Name Patterns <span className="text-gray-400">(comma-separated, lowercase)</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={selectedHub.stopNamePatterns.join(', ')}
                                        onChange={e => updateHub(selectedHubIndex, {
                                            stopNamePatterns: e.target.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
                                        })}
                                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="e.g., park place"
                                    />
                                </div>

                                {/* Platforms table */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-sm font-bold text-gray-800">Platforms</h3>
                                        <button
                                            onClick={addPlatform}
                                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                                        >
                                            <Plus size={12} /> Add Platform
                                        </button>
                                    </div>

                                    {selectedHub.platforms.length === 0 ? (
                                        <p className="text-xs text-gray-400 italic py-4 text-center">No platforms defined</p>
                                    ) : (
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="text-xs text-gray-500 border-b border-gray-200">
                                                    <th className="text-left py-1.5 px-2 font-medium">Platform ID</th>
                                                    <th className="text-left py-1.5 px-2 font-medium">Routes</th>
                                                    <th className="text-left py-1.5 px-2 font-medium w-20">Capacity</th>
                                                    <th className="w-10" />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedHub.platforms.map((platform, pIdx) => (
                                                    <tr key={pIdx} className="border-b border-gray-100">
                                                        <td className="py-1.5 px-2">
                                                            <input
                                                                type="text"
                                                                value={platform.platformId}
                                                                onChange={e => updatePlatform(pIdx, { platformId: e.target.value })}
                                                                className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                            />
                                                        </td>
                                                        <td className="py-1.5 px-2">
                                                            <input
                                                                type="text"
                                                                value={platform.routes.join(', ')}
                                                                onChange={e => updatePlatform(pIdx, {
                                                                    routes: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                                                })}
                                                                className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                placeholder="e.g., 8A, 12B"
                                                            />
                                                        </td>
                                                        <td className="py-1.5 px-2">
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                value={platform.capacity || 1}
                                                                onChange={e => updatePlatform(pIdx, { capacity: parseInt(e.target.value) || 1 })}
                                                                className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                            />
                                                        </td>
                                                        <td className="py-1.5 px-2 text-center">
                                                            <button
                                                                onClick={() => deletePlatform(pIdx)}
                                                                className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors"
                                                                title="Delete platform"
                                                            >
                                                                <Trash2 size={12} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                                Select a hub from the left panel
                            </div>
                        )}
                    </div>
                </div>

                {loadWarning && (
                    <div className="px-6 py-2 bg-amber-50 border-t border-amber-200">
                        <p className="text-xs text-amber-800">{loadWarning}</p>
                    </div>
                )}

                {/* Error messages */}
                {errors.length > 0 && (
                    <div className="px-6 py-2 bg-red-50 border-t border-red-200">
                        {errors.map((err, i) => (
                            <p key={i} className="text-xs text-red-700">{err}</p>
                        ))}
                    </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                    <button
                        onClick={handleResetDefaults}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-md transition-colors"
                    >
                        <RotateCcw size={14} /> Reset to Defaults
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            {saving ? 'Saving...' : 'Save Configuration'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PlatformConfigEditor;
