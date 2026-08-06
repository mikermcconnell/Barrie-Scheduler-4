import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, MapPin, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

type ParkingWorkspaceView = 'dashboard' | 'plate-monitor' | 'lot-data';

const ParkingDataWorkspace = lazyWithRetry(
  () => import('./ParkingDataWorkspace').then(module => ({ default: module.ParkingDataWorkspace })),
  'parking-data-workspace',
);

function parseParkingWorkspaceView(hash = window.location.hash): ParkingWorkspaceView {
  const normalized = hash.replace(/^#\/?/, '').toLowerCase();
  if (normalized.includes('plate-monitor') || normalized.includes('plate')) return 'plate-monitor';
  if (normalized.includes('lot-data') || normalized.includes('lot') || normalized.includes('data')) return 'lot-data';
  return 'dashboard';
}

const ParkingDashboardCard: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  color: 'emerald' | 'amber';
}> = ({ onClick, icon, title, description, color }) => {
  const colorClasses = {
    emerald: {
      bg: 'bg-emerald-50/50',
      text: 'text-emerald-600',
      border: 'hover:border-emerald-300',
      arrow: 'group-hover:text-emerald-500',
    },
    amber: {
      bg: 'bg-amber-50/50',
      text: 'text-amber-600',
      border: 'hover:border-amber-300',
      arrow: 'group-hover:text-amber-500',
    },
  }[color];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex h-full flex-col rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm transition-all hover:shadow-md active:scale-[0.99] ${colorClasses.border}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className={`${colorClasses.bg} rounded-lg p-2.5 ${colorClasses.text} transition-colors`}>{icon}</div>
        <ArrowRight size={16} className={`text-gray-300 transition-colors ${colorClasses.arrow}`} />
      </div>
      <h3 className="mb-1 text-lg font-bold text-gray-900">{title}</h3>
      <p className="text-sm leading-relaxed text-gray-500">{description}</p>
    </button>
  );
};

const ParkingSubviewLoading = () => (
  <div className="flex h-full items-center justify-center text-gray-500" role="status">
    <Loader2 className="mr-2 animate-spin text-emerald-500" aria-hidden="true" />
    Loading Parking workspace...
  </div>
);

export const ParkingWorkspace: React.FC = () => {
  const { user } = useAuth();
  const { team } = useTeam();
  const [activeWorkspace, setActiveWorkspace] = useState<ParkingWorkspaceView>(parseParkingWorkspaceView);

  useEffect(() => {
    const handleHashChange = () => setActiveWorkspace(parseParkingWorkspaceView());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateWorkspace = useCallback((view: Exclude<ParkingWorkspaceView, 'dashboard'>) => {
    setActiveWorkspace(view);
    window.location.hash = `parking/${view}`;
  }, []);

  if (!team || !user) {
    return <div className="p-8 text-sm text-gray-500">Sign in and join a team to use Parking.</div>;
  }

  if (activeWorkspace !== 'dashboard') {
    return (
      <Suspense fallback={<ParkingSubviewLoading />}>
        <ParkingDataWorkspace key={activeWorkspace} />
      </Suspense>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-12">
      <div className="mx-auto max-w-6xl animate-in fade-in slide-in-from-bottom-2 duration-500 pt-8">
        <div className="mb-8 px-4">
          <button
            type="button"
            onClick={() => { window.location.hash = ''; }}
            className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600"
          >
            <ArrowLeft size={14} /> Back to Main
          </button>
          <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">Parking Workspace</h2>
          <p className="text-gray-500">Select a parking tool to review plates, revenue, lots, and usage trends.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 px-4 md:grid-cols-2">
          <ParkingDashboardCard
            onClick={() => navigateWorkspace('plate-monitor')}
            icon={<Search size={20} />}
            color="amber"
            title="Plate Monitor"
            description="Review flagged plates, repeat activity, unusual timing, and plate-level pattern evidence."
          />
          <ParkingDashboardCard
            onClick={() => navigateWorkspace('lot-data')}
            icon={<MapPin size={20} />}
            color="emerald"
            title="Parking Lot Data"
            description="Import revenue files, map HotSpot locations, and compare lot usage, revenue, and peak periods."
          />
        </div>
      </div>
    </div>
  );
};
