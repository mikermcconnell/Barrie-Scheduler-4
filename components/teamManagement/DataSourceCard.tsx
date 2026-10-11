import React, { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';
import type { Team, TeamWithMembers } from '../../utils/masterScheduleTypes';
import { updateTeamDataSourceTeamIds } from '../../utils/services/teamService';
import { isPermissionDeniedError } from './accessErrors';

interface DataSourceCardProps {
    team: TeamWithMembers;
    teamOptions: Team[];
    canEdit: boolean;
    onSaved: () => Promise<void>;
}

export const DataSourceCard: React.FC<DataSourceCardProps> = ({ team, teamOptions, canEdit, onSaved }) => {
    const toast = useToast();
    const queryClient = useQueryClient();
    const [transitAppSourceId, setTransitAppSourceId] = useState('');
    const [performanceSourceId, setPerformanceSourceId] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setTransitAppSourceId(team.dataSourceTeamIds?.transitApp ?? '');
        setPerformanceSourceId(team.dataSourceTeamIds?.performance ?? '');
    }, [team.id, team.dataSourceTeamIds?.transitApp, team.dataSourceTeamIds?.performance]);

    const sourceOptions = teamOptions.filter(option => option.id !== team.id);

    const handleSave = async (): Promise<void> => {
        if (!canEdit) return;

        setSaving(true);
        try {
            await updateTeamDataSourceTeamIds(team.id, {
                transitApp: transitAppSourceId || undefined,
                performance: performanceSourceId || undefined,
            });
            await Promise.all([
                onSaved(),
                queryClient.invalidateQueries({ queryKey: ['performanceMetadata'] }),
                queryClient.invalidateQueries({ queryKey: ['performanceOverview'] }),
                queryClient.invalidateQueries({ queryKey: ['performanceData'] }),
            ]);
            toast?.success('Data sources saved');
        } catch (error) {
            console.error('Error saving data sources:', error);
            toast?.error(isPermissionDeniedError(error)
                ? 'Permission denied while saving data sources. Refresh your admin session and try again.'
                : 'Failed to save data sources');
        } finally {
            setSaving(false);
        }
    };

    const renderSelect = (label: string, value: string, onChange: (next: string) => void): React.ReactNode => (
        <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</label>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                disabled={!canEdit || saving}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 disabled:bg-gray-100 disabled:text-gray-500"
            >
                <option value="">Use {team.name}&apos;s own data</option>
                {sourceOptions.map(option => (
                    <option key={option.id} value={option.id}>Read from {option.name}</option>
                ))}
            </select>
        </div>
    );

    return (
        <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-start gap-3 border-b border-gray-200 px-4 py-3">
                <div className="rounded-lg bg-gray-100 p-2 text-gray-600"><Database size={18} /></div>
                <div>
                    <p className="text-sm font-bold text-gray-900">
                        Data source
                        <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-800">
                            Admin
                        </span>
                    </p>
                    <p className="text-xs text-gray-500">
                        Let this team read another team&apos;s data. No files are copied; uploads stay with {team.name}.
                    </p>
                </div>
            </div>
            <div className="p-4">
                <div className="grid gap-3 md:grid-cols-2">
                    {renderSelect('Transit App data', transitAppSourceId, setTransitAppSourceId)}
                    {renderSelect('STREETS dashboard / reports', performanceSourceId, setPerformanceSourceId)}
                </div>
                <div className="mt-4 flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center">
                    <p className={`flex-1 text-xs ${canEdit ? 'text-gray-500' : 'font-semibold text-amber-700'}`}>
                        {canEdit
                            ? 'Saving changes what this team reads. Uploads stay with this team.'
                            : 'Start an edit session from Support to change data sources.'}
                    </p>
                    <button
                        onClick={() => void handleSave()}
                        disabled={!canEdit || saving}
                        className="rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save data sources'}
                    </button>
                </div>
            </div>
        </div>
    );
};
