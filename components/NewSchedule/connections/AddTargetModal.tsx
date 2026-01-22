/**
 * AddTargetModal
 *
 * Modal for adding manual connection targets (GO trains, College bells).
 */

import React, { useState } from 'react';
import {
    X,
    Plus,
    Train,
    Clock,
    Trash2,
    AlertCircle
} from 'lucide-react';
import type {
    ConnectionTarget,
    ConnectionTime,
    ConnectionTargetType
} from '../../../utils/connectionTypes';
import {
    generateConnectionId,
    parseConnectionTime,
    formatConnectionTime
} from '../../../utils/connectionTypes';
import type { DayType } from '../../../utils/masterScheduleParser';

interface AddTargetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (target: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>) => void;
    dayType: DayType;
}

export const AddTargetModal: React.FC<AddTargetModalProps> = ({
    isOpen,
    onClose,
    onAdd,
    dayType
}) => {
    const [name, setName] = useState('');
    const [location, setLocation] = useState('');
    const [icon, setIcon] = useState<'train' | 'clock'>('train');
    const [times, setTimes] = useState<ConnectionTime[]>([]);
    const [newTimeStr, setNewTimeStr] = useState('');
    const [newTimeLabel, setNewTimeLabel] = useState('');
    const [error, setError] = useState('');

    if (!isOpen) return null;

    // Add a new time
    const handleAddTime = () => {
        const minutes = parseConnectionTime(newTimeStr);
        if (minutes === 0 && newTimeStr !== '12:00 AM' && newTimeStr !== '00:00') {
            setError('Invalid time format. Use HH:MM AM/PM or HH:MM');
            return;
        }

        // Check for duplicate
        if (times.some(t => t.time === minutes)) {
            setError('This time already exists');
            return;
        }

        const newTime: ConnectionTime = {
            id: generateConnectionId(),
            time: minutes,
            label: newTimeLabel || undefined,
            daysActive: [dayType], // Default to current day type
            enabled: true
        };

        setTimes([...times, newTime].sort((a, b) => a.time - b.time));
        setNewTimeStr('');
        setNewTimeLabel('');
        setError('');
    };

    // Remove a time
    const handleRemoveTime = (timeId: string) => {
        setTimes(times.filter(t => t.id !== timeId));
    };

    // Toggle day for a time
    const handleToggleDay = (timeId: string, day: DayType) => {
        setTimes(times.map(t => {
            if (t.id !== timeId) return t;
            const daysActive = t.daysActive.includes(day)
                ? t.daysActive.filter(d => d !== day)
                : [...t.daysActive, day];
            return { ...t, daysActive };
        }));
    };

    // Submit
    const handleSubmit = () => {
        if (!name.trim()) {
            setError('Name is required');
            return;
        }

        if (times.length === 0) {
            setError('Add at least one time');
            return;
        }

        onAdd({
            name: name.trim(),
            type: 'manual' as ConnectionTargetType,
            location: location.trim() || undefined,
            icon,
            times,
            color: icon === 'train' ? 'green' : 'teal'
        });

        // Reset form
        setName('');
        setLocation('');
        setIcon('train');
        setTimes([]);
        setError('');
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">
                        Add Connection Target
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                    {/* Error message */}
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    {/* Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Name *
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., GO Train to Toronto"
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* Location */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Location
                        </label>
                        <input
                            type="text"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            placeholder="e.g., Allandale Waterfront GO Station"
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* Icon/Type */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Type
                        </label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setIcon('train')}
                                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border ${
                                    icon === 'train'
                                        ? 'border-green-500 bg-green-50 text-green-700'
                                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                <Train className="w-4 h-4" />
                                GO Train
                            </button>
                            <button
                                onClick={() => setIcon('clock')}
                                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border ${
                                    icon === 'clock'
                                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                <Clock className="w-4 h-4" />
                                Bell/Schedule
                            </button>
                        </div>
                    </div>

                    {/* Times */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Times *
                        </label>

                        {/* Add time form */}
                        <div className="flex gap-2 mb-3">
                            <input
                                type="text"
                                value={newTimeStr}
                                onChange={(e) => setNewTimeStr(e.target.value)}
                                placeholder="7:15 AM"
                                className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <input
                                type="text"
                                value={newTimeLabel}
                                onChange={(e) => setNewTimeLabel(e.target.value)}
                                placeholder="Label (optional)"
                                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <button
                                onClick={handleAddTime}
                                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Time list */}
                        {times.length === 0 ? (
                            <div className="text-sm text-gray-500 text-center py-4 bg-gray-50 rounded-lg">
                                No times added yet
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                {times.map(time => (
                                    <div
                                        key={time.id}
                                        className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg"
                                    >
                                        <span className="font-mono text-sm font-medium text-gray-900 w-20">
                                            {formatConnectionTime(time.time)}
                                        </span>
                                        <span className="text-sm text-gray-500 flex-1 truncate">
                                            {time.label || '-'}
                                        </span>
                                        {/* Day toggles */}
                                        <div className="flex gap-1">
                                            {(['Weekday', 'Saturday', 'Sunday'] as DayType[]).map(day => (
                                                <button
                                                    key={day}
                                                    onClick={() => handleToggleDay(time.id, day)}
                                                    className={`px-1.5 py-0.5 text-xs rounded ${
                                                        time.daysActive.includes(day)
                                                            ? 'bg-blue-100 text-blue-700'
                                                            : 'bg-gray-200 text-gray-400'
                                                    }`}
                                                >
                                                    {day.slice(0, 3)}
                                                </button>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => handleRemoveTime(time.id)}
                                            className="p-1 text-gray-400 hover:text-red-500"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Add Target
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddTargetModal;
