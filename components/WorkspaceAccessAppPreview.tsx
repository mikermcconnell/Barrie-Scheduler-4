import React, { useEffect, useState } from 'react';
import { ArrowLeft, BarChart2, Bus, Car, Eye, Landmark, LayoutDashboard, Map, Smartphone, User } from 'lucide-react';
import type { buildWorkspaceAccessPreview, WorkspacePreviewItem } from '../utils/workspaceAccessPreview';

type WorkspaceAccessPreview = ReturnType<typeof buildWorkspaceAccessPreview>;

interface WorkspaceAccessAppPreviewProps {
    title: string;
    preview: WorkspaceAccessPreview;
}

const iconForFeature = (feature: WorkspacePreviewItem['feature']): React.ReactNode => {
    if (feature === 'workspaceFixedRoute') return <Bus size={24} />;
    if (feature === 'workspaceOperations') return <BarChart2 size={24} />;
    if (feature === 'workspaceParking') return <Car size={24} />;
    if (feature === 'analyticsTransitApp') return <Smartphone size={18} />;
    if (feature === 'analyticsCouncilIntelligence') return <Landmark size={18} />;
    if (feature === 'workspaceOndemand') return <Map size={24} />;
    return <LayoutDashboard size={18} />;
};

const HomeWorkspaceCard: React.FC<{ item: WorkspacePreviewItem; onOpen: (item: WorkspacePreviewItem) => void }> = ({ item, onOpen }) => (
    <button
        type="button"
        onClick={() => onOpen(item)}
        className="rounded-2xl border-b-4 border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-200"
    >
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            {iconForFeature(item.feature)}
        </div>
        <p className="text-base font-extrabold text-gray-900">{item.label}</p>
        <p className="mt-1 text-xs font-medium leading-relaxed text-gray-500">{item.description}</p>
        <p className="mt-3 text-[11px] font-extrabold uppercase tracking-wide text-blue-600">Enter Workspace</p>
    </button>
);

const ToolCard: React.FC<{ item: WorkspacePreviewItem; onOpen: (item: WorkspacePreviewItem) => void }> = ({ item, onOpen }) => (
    <button
        type="button"
        onClick={() => onOpen(item)}
        className="rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition-all hover:border-blue-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-200"
    >
        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
            {iconForFeature(item.feature)}
        </div>
        <p className="text-sm font-bold text-gray-900">{item.label}</p>
        <p className="mt-1 text-xs leading-snug text-gray-500">{item.description}</p>
    </button>
);

export const WorkspaceAccessAppPreview: React.FC<WorkspaceAccessAppPreviewProps> = ({ title, preview }) => {
    const inAppTools = [...preview.analyticsCards, ...preview.operationsTools];
    const [selectedItem, setSelectedItem] = useState<WorkspacePreviewItem | null>(null);
    const [showPlanningData, setShowPlanningData] = useState(false);

    useEffect(() => {
        setSelectedItem(null);
        setShowPlanningData(false);
    }, [preview]);

    const handleOpenItem = (item: WorkspacePreviewItem) => {
        if (item.previewKind === 'planning-home') {
            setSelectedItem(null);
            setShowPlanningData(true);
            return;
        }
        setSelectedItem(item);
    };

    const handleBackHome = () => {
        setSelectedItem(null);
        setShowPlanningData(false);
    };

    return (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-2">
                    <div className="mt-0.5 rounded-lg bg-white p-2 text-blue-600 shadow-sm">
                        <Eye size={16} />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-gray-900">{title}</p>
                        <p className="text-xs text-gray-600">
                            This access preview uses the selected profile and mirrors the app navigation. It does not impersonate the account or load live data.
                        </p>
                    </div>
                </div>
                <span className="w-fit rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-blue-700 shadow-sm">
                    Access preview
                </span>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-[#F7F7F7] shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-gradient-to-br from-brand-green to-emerald-600 p-2 text-white">
                            <LayoutDashboard size={16} />
                        </div>
                        <p className="text-sm font-bold text-gray-900">Transit<span className="text-brand-green">Scheduler</span></p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="hidden text-right sm:block">
                            <p className="text-xs font-bold text-gray-800">Previewing as {preview.profileName}</p>
                            <p className="text-[10px] text-gray-500">{preview.accessLabel}</p>
                        </div>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-emerald-600 ring-2 ring-emerald-500">
                            <User size={14} />
                        </div>
                    </div>
                </div>

                <div className="p-5">
                    {selectedItem ? (
                        <PreviewDetailScreen
                            item={selectedItem}
                            onBack={() => {
                                setSelectedItem(null);
                                if (selectedItem.previewKind === 'analytics-card') {
                                    setShowPlanningData(true);
                                }
                            }}
                        />
                    ) : showPlanningData ? (
                        <PreviewPlanningScreen
                            analyticsCards={preview.analyticsCards}
                            onOpen={setSelectedItem}
                            onBack={handleBackHome}
                        />
                    ) : (
                        <>
                            <div className="mb-4 text-center">
                                <p className="text-xl font-extrabold text-gray-800">Select Workspace</p>
                                <p className="mt-1 text-xs text-gray-500">What this user would see after signing in.</p>
                            </div>

                            {preview.homeWorkspaces.length > 0 ? (
                                <div className="grid gap-3 md:grid-cols-3">
                                    {preview.homeWorkspaces.map(item => (
                                        <HomeWorkspaceCard key={`${item.previewKind ?? 'home'}-${item.feature}`} item={item} onOpen={handleOpenItem} />
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center">
                                    <p className="text-sm font-bold text-gray-800">No main workspace cards will appear</p>
                                    <p className="mt-1 text-xs text-gray-500">
                                        This profile will only see Team Management until workspace access is granted.
                                    </p>
                                </div>
                            )}

                            <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                <div className="mb-3 flex items-center justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-bold text-gray-900">Available in-app tools</p>
                                        <p className="text-xs text-gray-500">Analytics and operations surfaces allowed for this profile.</p>
                                    </div>
                                    <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-gray-600">
                                        {inAppTools.length} visible
                                    </span>
                                </div>

                                {inAppTools.length > 0 ? (
                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                        {inAppTools.map(item => (
                                            <ToolCard key={item.feature} item={item} onOpen={handleOpenItem} />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="rounded-lg bg-white px-3 py-2 text-xs text-gray-500">No extra in-app tools will appear.</p>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const PreviewPlanningScreen: React.FC<{
    analyticsCards: WorkspacePreviewItem[];
    onOpen: (item: WorkspacePreviewItem) => void;
    onBack: () => void;
}> = ({ analyticsCards, onOpen, onBack }) => (
    <div>
        <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
        >
            <ArrowLeft size={14} />
            Back to preview home
        </button>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
                <p className="text-lg font-extrabold text-gray-900">Planning Data</p>
                <p className="mt-1 text-sm text-gray-500">
                    This mirrors the Planning Data landing page. Only tools allowed by this profile are shown.
                </p>
            </div>

            {analyticsCards.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                    {analyticsCards.map(item => (
                        <ToolCard key={item.feature} item={item} onOpen={onOpen} />
                    ))}
                </div>
            ) : (
                <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">No planning-data tools will appear.</p>
            )}
        </div>
    </div>
);

const PreviewDetailScreen: React.FC<{
    item: WorkspacePreviewItem;
    onBack: () => void;
}> = ({ item, onBack }) => {
    const actions = getPreviewActions(item);

    return (
        <div>
            <button
                type="button"
                onClick={onBack}
                className="mb-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
                <ArrowLeft size={14} />
                Back to preview home
            </button>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                        {iconForFeature(item.feature)}
                    </div>
                    <div>
                        <p className="text-lg font-extrabold text-gray-900">{item.label} preview</p>
                        <p className="mt-1 text-sm text-gray-500">{item.description}</p>
                    </div>
                </div>

                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Visible actions</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {actions.map(action => (
                            <div key={action} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                                <p className="text-sm font-bold text-gray-900">{action}</p>
                                <p className="mt-1 text-xs text-gray-500">Visible in this preview profile.</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-semibold text-amber-800">
                        Access preview: this follows the same allowed navigation shape, but does not load live team data or make changes.
                    </p>
                </div>
            </div>
        </div>
    );
};

function getPreviewActions(item: WorkspacePreviewItem): string[] {
    if (item.feature === 'workspaceFixedRoute') {
        return ['New Schedule', 'Master Schedules', 'Drafts', 'Reports'];
    }
    if (item.feature === 'workspaceOndemand') {
        return ['Shift Builder', 'Coverage Review', 'Optimize Schedule'];
    }
    if (item.feature === 'workspaceOperations') {
        return ['Performance Dashboard', 'Reports', 'Import Health'];
    }
    if (item.feature === 'workspaceParking') {
        return ['Parking Lot Data', 'Plate Monitor', 'Revenue Imports', 'Department Settings'];
    }
    if (item.feature === 'analyticsTransitApp') {
        return ['Demand Map', 'Route Performance', 'Stop Analysis', 'Transfers'];
    }
    if (item.feature === 'analyticsOdMatrix') {
        return ['OD Map', 'Station Connectivity', 'Import Matrix'];
    }
    if (item.feature === 'analyticsCouncilIntelligence') {
        return ['Meeting Records', 'Council Decisions', 'Votes & Positions', 'Transit Actions'];
    }
    if (item.feature === 'operationsOperatorDwell') {
        return ['Dwell Summary', 'Operator Report'];
    }
    return ['Open Workspace', 'Review Data'];
}
