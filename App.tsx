import React, { Suspense, useState, useCallback, useEffect } from 'react';
import { AuthProvider, useAuth } from './components/contexts/AuthContext';
import { TeamProvider, useTeam } from './components/contexts/TeamContext';
import { ToastProvider } from './components/contexts/ToastContext';
import { AuthModal } from './components/modals/AuthModal';
import { FileManager } from './components/FileManager';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Modal } from './components/ui/Modal';
import { TeamManagement } from './components/TeamManagement';
import { LayoutDashboard, Bus, ArrowRight, Loader2, BarChart2, Smartphone, Car, TrendingUp } from 'lucide-react';
import { Header, View } from './components/layout/Header';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { isFeatureEnabled } from './utils/features';
import { clearLegacyFixedRouteResumeState } from './utils/workspaces/fixedRouteResumeState';
import { useWorkspaceAccess } from './hooks/useWorkspaceAccess';
import { useWorkspacePreload } from './hooks/useWorkspacePreload';
import { getPendingInviteCode } from './utils/inviteLinks';
import { ANALYTICS_WORKSPACE_FEATURES } from './utils/workspaceAccess';
import { parseAnalyticsWorkspaceViewFromHash } from './utils/workspaces/analyticsWorkspaceRouting';
import { SimulatorWorkspaceCard } from './components/Performance/SimulatorLink';

const queryClient = new QueryClient();
const OnDemandWorkspace = lazyWithRetry(() => import('./components/workspaces/OnDemandWorkspace').then(module => ({ default: module.OnDemandWorkspace })), 'ondemand-workspace');
const FixedRouteWorkspace = lazyWithRetry(() => import('./components/workspaces/FixedRouteWorkspace').then(module => ({ default: module.FixedRouteWorkspace })), 'fixed-workspace');
const OperationsWorkspace = lazyWithRetry(() => import('./components/workspaces/OperationsWorkspace').then(module => ({ default: module.OperationsWorkspace })), 'operations-workspace');
const ParkingWorkspace = lazyWithRetry(() => import('./components/workspaces/ParkingWorkspace').then(module => ({ default: module.ParkingWorkspace })), 'parking-workspace');
const AnalyticsDashboard = lazyWithRetry(() => import('./components/Analytics/AnalyticsDashboard').then(module => ({ default: module.AnalyticsDashboard })), 'planning-data-workspace');

const APP_VIEW_FEATURES: Partial<Record<View, Parameters<typeof isFeatureEnabled>[0]>> = {
  ondemand: 'workspaceOndemand',
  fixed: 'workspaceFixedRoute',
  operations: 'workspaceOperations',
  parking: 'workspaceParking',
};

const isAppViewEnabled = (view: View): boolean => {
  if (view === 'planning') return ANALYTICS_WORKSPACE_FEATURES.some(feature => isFeatureEnabled(feature));
  const feature = APP_VIEW_FEATURES[view];
  return feature ? isFeatureEnabled(feature) : true;
};

function parseHashView(): View {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('fixed') && isAppViewEnabled('fixed')) return 'fixed';
  if (hash.startsWith('ondemand') && isAppViewEnabled('ondemand')) return 'ondemand';
  if (hash.startsWith('operations') && isAppViewEnabled('operations')) return 'operations';
  if (hash.startsWith('parking') && isAppViewEnabled('parking')) return 'parking';
  if (hash.startsWith('planning') && isAppViewEnabled('planning')) return 'planning';
  return 'home';
}



const AppContent: React.FC = () => {
  const { user, loading, signOut, isGlobalAdmin } = useAuth();
  const { hasTeam, actualTeam, availableTeams = [] } = useTeam();
  const { canAccess, loading: accessLoading } = useWorkspaceAccess();
  const [currentView, setCurrentViewState] = useState<View>(parseHashView);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showFileManager, setShowFileManager] = useState(false);
  const [showTeamManagement, setShowTeamManagement] = useState(false);
  const pendingInviteCode = getPendingInviteCode();

  const isViewAvailable = useCallback((view: View): boolean => {
    if (view === 'planning') return ANALYTICS_WORKSPACE_FEATURES.some(feature => canAccess(feature));
    const feature = APP_VIEW_FEATURES[view];
    return feature ? canAccess(feature) : true;
  }, [canAccess]);
  const hasAvailableWorkspace = (['ondemand', 'fixed', 'operations', 'parking', 'planning'] as View[]).some(isViewAvailable);
  const hasSwitchableTeam = availableTeams.some(team => team.id !== actualTeam?.id);
  const mustCompleteTeamSetup = Boolean(
    user && !isGlobalAdmin && (
      (!hasTeam && !hasSwitchableTeam) ||
      (!hasAvailableWorkspace && !hasSwitchableTeam)
    )
  );

  useWorkspacePreload(Boolean(user && !loading && !accessLoading && !mustCompleteTeamSetup), currentView);

  // Wrap navigation to sync URL hash
  const setCurrentView = useCallback((view: View) => {
    const safeView = isViewAvailable(view) ? view : 'home';
    setCurrentViewState(safeView);
    window.location.hash = safeView === 'home' ? '' : safeView;
  }, [isViewAvailable]);

  // Handle browser back/forward
  useEffect(() => {
    if (loading || accessLoading) return undefined;

    const handler = () => {
      const parsedView = parseHashView();
      const nextView = isViewAvailable(parsedView) ? parsedView : 'home';
      setCurrentViewState(nextView);
      if (nextView === 'home' && window.location.hash) {
        window.location.hash = '';
      }
    };
    handler();
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, [accessLoading, isViewAvailable, loading]);

  useEffect(() => {
    if (!user) clearLegacyFixedRouteResumeState();
  }, [user]);

  useEffect(() => {
    if (!loading && !user && pendingInviteCode) {
      setShowAuthModal(true);
    }
  }, [loading, pendingInviteCode, user]);

  // Show loading state while checking auth
  if (loading || accessLoading) {
    return <WorkspaceLoadingState label="Loading..." />;
  }

  const handleOpenOperationsRidership = () => {
    window.location.hash = 'operations/performance/ridership';
  };

  const handleSetupModalClose = () => {
    if (mustCompleteTeamSetup) return;
    setShowTeamManagement(false);
  };

  const handleSetupSignOut = async () => {
    await signOut();
    setShowTeamManagement(false);
    setCurrentView('home');
  };

  return (
    <div className="flex flex-col h-screen font-sans text-gray-800 bg-[#F7F7F7] overflow-hidden">

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        inviteCode={pendingInviteCode ?? undefined}
      />

      {/* File Manager Modal */}
      {showFileManager && user && (
        <FileManager
          onClose={() => setShowFileManager(false)}
          onSelectSchedule={(schedule) => {
            void schedule;
            setShowFileManager(false);
          }}
          onSelectFile={(file) => {
            void file;
            setShowFileManager(false);
          }}
        />
      )}

      {/* Team Management Modal */}
      <Modal
        isOpen={showTeamManagement || mustCompleteTeamSetup}
        onClose={handleSetupModalClose}
        size="full"
        zIndex="high"
        closeOnBackdropClick={!mustCompleteTeamSetup}
        closeOnEscape={!mustCompleteTeamSetup}
        className="h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)]"
      >
        <Modal.Header showClose={!mustCompleteTeamSetup}>
          {mustCompleteTeamSetup ? 'Get Started' : 'Team Management'}
        </Modal.Header>
        <Modal.Body className="flex-1 bg-gray-50 p-0">
          <TeamManagement
            fullScreen
            onClose={mustCompleteTeamSetup ? undefined : () => setShowTeamManagement(false)}
          />
        </Modal.Body>
        {mustCompleteTeamSetup && (
          <Modal.Footer>
            <button
              onClick={handleSetupSignOut}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              Sign out
            </button>
          </Modal.Footer>
        )}
      </Modal>

      {/* Global Header */}
      <Header
        currentView={currentView}
        onNavigate={setCurrentView}
        onShowFileManager={() => setShowFileManager(true)}
        onShowTeamManagement={() => setShowTeamManagement(true)}
        onShowAuthModal={() => setShowAuthModal(true)}
        canShowFileManager={Boolean(
          user && (isGlobalAdmin || hasAvailableWorkspace) && !mustCompleteTeamSetup
        )}
      />


      <main className={`flex-1 overflow-hidden relative flex flex-col mx-auto w-full px-6 ${currentView === 'home' ? 'max-w-[1440px] py-5' : 'max-w-[1920px] py-8'}`}>

        {/* Workspace Selector (Home View) */}
        {currentView === 'home' && mustCompleteTeamSetup && (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-lg rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-brand-green">
                <LayoutDashboard size={28} />
              </div>
              <h2 className="text-2xl font-extrabold text-gray-900">Complete team setup to continue</h2>
              <p className="mt-3 text-sm font-medium leading-relaxed text-gray-500">
                Join an existing team or create a new team before any workspaces become available.
              </p>
            </div>
          </div>
        )}

        {currentView === 'home' && !mustCompleteTeamSetup && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex h-full flex-col overflow-y-auto">
            <div className="mb-5 text-center">
              <h2 className="text-3xl font-extrabold text-gray-800">Select Workspace</h2>
            </div>

            {user && !hasAvailableWorkspace && hasSwitchableTeam && (
              <div className="mx-auto mb-8 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-center">
                <p className="text-sm font-bold text-amber-900">
                  No workspaces are available for {actualTeam?.name ?? 'the current team'}.
                </p>
                <p className="mt-1 text-sm font-medium text-amber-800">
                  Use the Active team menu in the header to switch to another team.
                </p>
              </div>
            )}

            <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 lg:max-h-[600px] lg:min-h-0 lg:flex-1 lg:flex-row">
              {isViewAvailable('operations') && isFeatureEnabled('operationsPerformanceDashboard') && (
                <aside aria-labelledby="quick-links-heading" className="lg:w-60 lg:shrink-0">
                  <h3
                    id="quick-links-heading"
                    className="mb-3 text-xs font-extrabold uppercase tracking-[0.18em] text-gray-500"
                  >
                    Quick links
                  </h3>
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={handleOpenOperationsRidership}
                      className="group flex min-h-20 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-amber-300 hover:bg-amber-50/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 transition-colors group-hover:bg-amber-200">
                        <TrendingUp size={20} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-extrabold text-gray-900">Ridership</span>
                        <span className="mt-0.5 block text-xs font-semibold text-gray-500">Operations Dashboard</span>
                      </span>
                      <ArrowRight size={16} aria-hidden="true" className="ml-auto shrink-0 text-gray-300 transition-colors group-hover:text-amber-600" />
                    </button>
                  </div>
                </aside>
              )}

              <div className="grid min-w-0 flex-1 grid-cols-1 gap-6 md:grid-cols-2 xl:min-h-0 xl:grid-cols-3 xl:grid-rows-2">
                {/* Barrie Transit Simulator Card */}
                {isViewAvailable('operations') && <SimulatorWorkspaceCard />}

                {/* On Demand Card */}
                {isViewAvailable('ondemand') && (
                  <button
                    onClick={() => setCurrentView('ondemand')}
                    className="group relative bg-white rounded-3xl border-b-8 border-gray-200 p-6 hover:border-brand-blue hover:-translate-y-1 transition-all duration-200 text-left overflow-hidden flex flex-col"
                  >
                    <div className="absolute bottom-0 right-0 p-5 opacity-[0.07] group-hover:opacity-[0.14] transition-opacity">
                      <LayoutDashboard size={56} />
                    </div>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="bg-blue-100 w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-brand-blue group-hover:scale-110 transition-transform">
                        <LayoutDashboard size={22} />
                      </div>
                      <h3 className="text-xl font-extrabold leading-tight text-gray-800 group-hover:text-brand-blue transition-colors">Transit On-Demand</h3>
                    </div>
                    <p className="mb-4 line-clamp-3 text-sm font-bold text-gray-500">
                      Manage driver shifts, analyze coverage gaps, and optimize 15-minute increments for dynamic demand.
                    </p>
                    <div className="mt-auto flex items-center gap-2 text-brand-blue font-extrabold uppercase tracking-wide text-sm">
                      Enter Workspace <ArrowRight size={16} />
                    </div>
                  </button>
                )}

                {/* Fixed Route Card */}
                {isViewAvailable('fixed') && (
                  <button
                    onClick={() => setCurrentView('fixed')}
                    className="group relative bg-white rounded-3xl border-b-8 border-gray-200 p-6 hover:border-brand-green hover:-translate-y-1 transition-all duration-200 text-left overflow-hidden flex flex-col"
                  >
                    <div className="absolute bottom-0 right-0 p-5 opacity-[0.07] group-hover:opacity-[0.14] transition-opacity">
                      <Bus size={56} />
                    </div>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="bg-green-100 w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-brand-green group-hover:scale-110 transition-transform">
                        <Bus size={22} />
                      </div>
                      <h3 className="text-xl font-extrabold leading-tight text-gray-800 group-hover:text-brand-green transition-colors">Scheduled Transit</h3>
                    </div>
                    <p className="mb-4 line-clamp-3 text-sm font-bold text-gray-500">
                      Plan and manage route schedules — from CSV import and runtime analysis to published timetables and public brochures.
                    </p>
                    <div className="mt-auto flex items-center gap-2 text-brand-green font-extrabold uppercase tracking-wide text-sm">
                      Enter Workspace <ArrowRight size={16} />
                    </div>
                  </button>
                )}

                {/* Dashboard & Reporting Card */}
                {isViewAvailable('operations') && (
                  <button
                    onClick={() => setCurrentView('operations')}
                    className="group relative bg-white rounded-3xl border-b-8 border-gray-200 p-6 hover:border-amber-500 hover:-translate-y-1 transition-all duration-200 text-left overflow-hidden flex flex-col"
                  >
                    <div className="absolute bottom-0 right-0 p-5 opacity-[0.07] group-hover:opacity-[0.14] transition-opacity">
                      <BarChart2 size={56} />
                    </div>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="bg-amber-100 w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform">
                        <BarChart2 size={22} />
                      </div>
                      <h3 className="text-xl font-extrabold leading-tight text-gray-800 group-hover:text-amber-600 transition-colors">Dashboard & Reporting</h3>
                    </div>
                    <p className="mb-4 line-clamp-3 text-sm font-bold text-gray-500">
                      OTP analysis, ridership dashboards, and STREETS reporting for scheduled transit operations.
                    </p>
                    <div className="mt-auto flex items-center gap-2 text-amber-600 font-extrabold uppercase tracking-wide text-sm">
                      Enter Workspace <ArrowRight size={16} />
                    </div>
                  </button>
                )}

                {/* Parking Card */}
                {isViewAvailable('parking') && (
                  <button
                    onClick={() => setCurrentView('parking')}
                    className="group relative bg-white rounded-3xl border-b-8 border-gray-200 p-6 hover:border-emerald-500 hover:-translate-y-1 transition-all duration-200 text-left overflow-hidden flex flex-col"
                  >
                    <div className="absolute bottom-0 right-0 p-5 opacity-[0.07] group-hover:opacity-[0.14] transition-opacity">
                      <Car size={56} />
                    </div>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="bg-emerald-100 w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
                        <Car size={22} />
                      </div>
                      <h3 className="text-xl font-extrabold leading-tight text-gray-800 group-hover:text-emerald-600 transition-colors">Parking</h3>
                    </div>
                    <p className="mb-4 line-clamp-3 text-sm font-bold text-gray-500">
                      Open Parking Lot Data, import revenue files, review department totals, and monitor plate-level patterns.
                    </p>
                    <div className="mt-auto flex items-center gap-2 text-emerald-600 font-extrabold uppercase tracking-wide text-sm">
                      Enter Workspace <ArrowRight size={16} />
                    </div>
                  </button>
                )}

                {/* Planning Data Card */}
                {isViewAvailable('planning') && (
                  <button
                    onClick={() => setCurrentView('planning')}
                    className="group relative bg-white rounded-3xl border-b-8 border-gray-200 p-6 hover:border-cyan-500 hover:-translate-y-1 transition-all duration-200 text-left overflow-hidden flex flex-col"
                  >
                    <div className="absolute bottom-0 right-0 p-5 opacity-[0.07] group-hover:opacity-[0.14] transition-opacity">
                      <Smartphone size={56} />
                    </div>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="bg-cyan-100 w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-cyan-600 group-hover:scale-110 transition-transform">
                        <Smartphone size={22} />
                      </div>
                      <h3 className="text-xl font-extrabold leading-tight text-gray-800 group-hover:text-cyan-600 transition-colors">Planning Data</h3>
                    </div>
                    <p className="mb-4 line-clamp-3 text-sm font-bold text-gray-500">
                      Analyze rider demand, Transit App data, and other planning datasets allowed for your access profile.
                    </p>
                    <div className="mt-auto flex items-center gap-2 text-cyan-600 font-extrabold uppercase tracking-wide text-sm">
                      Enter Workspace <ArrowRight size={16} />
                    </div>
                  </button>
                )}

              </div>
            </div>

          </div>
        )}

        {/* Dynamic Workspace Rendering */}
        <Suspense fallback={<WorkspaceLoadingState label="Loading workspace..." />}>
          {currentView === 'ondemand' && isViewAvailable('ondemand') && (
            <ErrorBoundary fallbackTitle="Workspace Error">
              <OnDemandWorkspace />
            </ErrorBoundary>
          )}
          {currentView === 'fixed' && isViewAvailable('fixed') && (
            <ErrorBoundary fallbackTitle="Workspace Error">
              <FixedRouteWorkspace />
            </ErrorBoundary>
          )}
          {currentView === 'operations' && isViewAvailable('operations') && (
            <ErrorBoundary fallbackTitle="Workspace Error">
              <OperationsWorkspace />
            </ErrorBoundary>
          )}
          {currentView === 'parking' && isViewAvailable('parking') && (
            <ErrorBoundary fallbackTitle="Workspace Error">
              <ParkingWorkspace />
            </ErrorBoundary>
          )}
          {currentView === 'planning' && isViewAvailable('planning') && (
            <ErrorBoundary fallbackTitle="Workspace Error">
              <AnalyticsDashboard
                initialView={parseAnalyticsWorkspaceViewFromHash(window.location.hash, 'planning')}
                routePrefix="planning"
                onClose={() => setCurrentView('home')}
              />
            </ErrorBoundary>
          )}
        </Suspense>


      </main>
    </div>
  );
};

const WorkspaceLoadingState: React.FC<{ label: string }> = ({ label }) => (
  <div className="min-h-screen flex items-center justify-center bg-[#F7F7F7]">
    <div className="flex flex-col items-center gap-4">
      <Loader2 className="animate-spin text-brand-green" size={48} />
      <p className="text-gray-500 font-bold">{label}</p>
    </div>
  </div>
);

// Main App component with providers
const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TeamProvider>
          <ToastProvider>
            <AppContent />
          </ToastProvider>
        </TeamProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
