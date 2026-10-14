import React, { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';
import type { Team, TeamWithMembers } from '../../utils/masterScheduleTypes';
import { updateTeamDataSourceTeamIds } from '../../utils/services/teamService';
import { isPermissionDeniedError } from './accessErrors';

type DataSourceKey = keyof NonNullable<Team['dataSourceTeamIds']>;

interface DataSourceField {
    key: DataSourceKey;
    label: string;
    ownOption: (teamName: string) => string;
    sourceOption: (sourceName: string) => string;
    /** Collaborative sources are editable by both teams, unlike read-only evidence. */
    editable?: boolean;
}

const DATA_SOURCE_FIELDS: DataSourceField[] = [
    {
        key: 'transitApp',
        label: 'Transit App data',
        ownOption: name => `Use ${name}'s own data`,
        sourceOption: name => `Read from ${name}`,
    },
    {
        key: 'performance',
        label: 'STREETS dashboard / reports',
        ownOption: name => `Use ${name}'s own data`,
        sourceOption: name => `Read from ${name}`,
    },
    {
        key: 'fleetPlan',
        label: 'Fleet Plan',
        ownOption: name => `Use ${name}'s own plan`,
        sourceOption: name => `Read from ${name}`,
    },
    {
        key: 'masterSchedules',
        label: 'Master Schedules',
        ownOption: name => `Use ${name}'s own schedules`,
        sourceOption: name => `Read from ${name}`,
    },
    {
        key: 'strategicPlanWorkplan',
        label: 'Strategic Plan work plan',
        ownOption: name => `Maintain ${name}'s own work plan`,
        sourceOption: name => `Collaborate in ${name}'s work plan`,
        editable: true,
    },
];

const EMPTY_SELECTION: Record<DataSourceKey, string> = {
    transitApp: '',
    performance: '',
    fleetPlan: '',
    masterSchedules: '',
    strategicPlanWorkplan: '',
};

interface DataSourceCardProps {
    team: TeamWithMembers;
    teamOptions: Team[];
    canEdit: boolean;
    onSaved: () => Promise<void>;
}

export const DataSourceCard: React.FC<DataSourceCardProps> = ({ team, teamOptions, canEdit, onSaved }) => {
    const toast = useToast();
    const queryClient = useQueryClient();
    const [selection, setSelection] = useState<Record<DataSourceKey, string>>(EMPTY_SELECTION);
    const [saving, setSaving] = useState(false);

    const savedSources = team.dataSourceTeamIds;
    useEffect(() => {
        setSelection({
            transitApp: savedSources?.transitApp ?? '',
            performance: savedSources?.performance ?? '',
            fleetPlan: savedSources?.fleetPlan ?? '',
            masterSchedules: savedSources?.masterSchedules ?? '',
            strategicPlanWorkplan: savedSources?.strategicPlanWorkplan ?? '',
        });
    }, [
        team.id,
        savedSources?.transitApp,
        savedSources?.performance,
        savedSources?.fleetPlan,
        savedSources?.masterSchedules,
        savedSources?.strategicPlanWorkplan,
    ]);

    const sourceOptions = teamOptions.filter(option => option.id !== team.id);

    const handleSave = async (): Promise<void> => {
        if (!canEdit) return;

        setSaving(true);
        try {
            await updateTeamDataSourceTeamIds(team.id, {
                transitApp: selection.transitApp || undefined,
                performance: selection.performance || undefined,
                fleetPlan: selection.fleetPlan || undefined,
                masterSchedules: selection.masterSchedules || undefined,
                strategicPlanWorkplan: selection.strategicPlanWorkplan || undefined,
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

    return (
        <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-start gap-3 border-b border-gray-200 px-4 py-3">
                <div className="rounded-lg bg-gray-100 p-2 text-gray-600"><Database size={18} /></div>
                <div>
                    <p className="text-sm font-bold text-gray-900">
                        Data sources
                        <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-800">
                            Admin
                        </span>
                    </p>
                    <p className="text-xs text-gray-500">
                        Let {team.name} read another team&apos;s data without copying files. Uploads and imports stay with {team.name}.
                    </p>
                </div>
            </div>
            <div className="p-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {DATA_SOURCE_FIELDS.map(field => (
                        <div
                            key={field.key}
                            className={field.editable ? 'rounded-lg border border-indigo-200 bg-indigo-50 p-3' : undefined}
                        >
                            <label
                                htmlFor={`data-source-${field.key}`}
                                className={`text-[11px] font-bold uppercase tracking-wide ${field.editable ? 'text-indigo-800' : 'text-gray-500'}`}
                            >
                                {field.label}
                            </label>
                            <select
                                id={`data-source-${field.key}`}
                                value={selection[field.key]}
                                onChange={(event) => setSelection(current => ({ ...current, [field.key]: event.target.value }))}
                                disabled={!canEdit || saving}
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 disabled:bg-gray-100 disabled:text-gray-500"
                            >
                                <option value="">{field.ownOption(team.name)}</option>
                                {sourceOptions.map(option => (
                                    <option key={option.id} value={option.id}>{field.sourceOption(option.name)}</option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>
                <p className="mt-3 text-xs text-gray-500">
                    The Strategic Plan work plan is the exception: permitted members of both teams edit one shared
                    schedule, and every save is attributed. Everything else is read-only.
                </p>
                <div className="mt-4 flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center">
                    <p className={`flex-1 text-xs ${canEdit ? 'text-gray-500' : 'font-semibold text-amber-700'}`}>
                        {canEdit
                            ? 'Any source left on "own data" reads from this team.'
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
