import React, { Suspense, useState, useCallback, useEffect } from 'react';
import { AuthProvider, useAuth } from './components/contexts/AuthContext';
import { TeamProvider, useTeam } from './components/contexts/TeamContext';
import { ToastProvider } from './components/contexts/ToastContext';
import { AuthModal } from './components/modals/AuthModal';
import { FileManager } from './components/FileManager';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Modal } from './components/ui/Modal';
import { TeamManagement } from './components/TeamManagement';
import { LayoutDashboard, Bus, ArrowRight, Map, Loader2, BarChart2, Smartphone, Car } from 'lucide-react';
import { Header, View } from './components/layout/Header';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { isFeatureEnabled } from './utils/features';
import { clearLegacyFixedRouteResumeState, FIXED_ROUTE_RESUME_UPDATED_EVENT, loadFixedRouteResumeState } from './utils/workspaces/fixedRouteResumeState';
import { useWorkspaceAccess } from './hooks/useWorkspaceAccess';
import { getPendingInviteCode } from './utils/inviteLinks';
import { ANALYTICS_WORKSPACE_FEATURES } from './utils/workspaceAccess';
import { parseAnalyticsWorkspaceViewFromHash } from './utils/workspaces/analyticsWorkspaceRouting';

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
  const { user, loading, signOut } = useAuth();
  const { hasTeam } = useTeam();
  const { canAccess, loading: accessLoading } = useWorkspaceAccess();
  const [currentView, setCurrentViewState] = useState<View>(parseHashView);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showFileManager, setShowFileManager] = useState(false);
  const [showTeamManagement, setShowTeamManagement] = useState(false);
  const [fixedRouteResume, setFixedRouteResume] = useState(() => loadFixedRouteResumeState(user?.uid));
  const pendingInviteCode = getPendingInviteCode();

  const isViewAvailable = useCallback((view: View): boolean => {
    if (view === 'planning') return ANALYTICS_WORKSPACE_FEATURES.some(feature => canAccess(feature));
    const feature = APP_VIEW_FEATURES[view];
    return feature ? canAccess(feature) : true;
  }, [canAccess]);
  const hasAvailableWorkspace = (['ondemand', 'fixed', 'operations', 'parking', 'planning'] as View[]).some(isViewAvailable);
  const mustCompleteTeamSetup = Boolean(user && (!hasTeam || !hasAvailableWorkspace));

  // Wrap navigation to sync URL hash
  const setCurrentView = useCallback((view: View) => {
    const safeView = isViewAvailable(view) ? view : 'home';
    setCurrentViewState(safeView);
    window.location.hash = safeView === 'home' ? '' : safeView;
  }, [isViewAvailable]);

  // Handle browser back/forward
  useEffect(() => {
    const handler = () => {
      const parsedView = parseHashView();
      const nextView = isViewAvailable(parsedView) ? parsedView : 'home';
      setCurrentViewState(nextView);
      setFixedRouteResume(loadFixedRouteResumeState(user?.uid));
      if (nextView === 'home' && window.location.hash) {
        window.location.hash = '';
      }
    };
    handler();
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, [isViewAvailable, user?.uid]);

  useEffect(() => {
    if (!user) {
      clearLegacyFixedRouteResumeState();
      setFixedRouteResume(null);
      return;
    }

    setFixedRouteResume(loadFixedRouteResumeState(user.uid));
  }, [user]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    const refreshResume = () => setFixedRouteResume(loadFixedRouteResumeState(user.uid));
    window.addEventListener(FIXED_ROUTE_RESUME_UPDATED_EVENT, refreshResume);
    window.addEventListener('storage', refreshResume);
    return () => {
      window.removeEventListener(FIXED_ROUTE_RESUME_UPDATED_EVENT, refreshResume);
      window.removeEventListener('storage', refreshResume);
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!loading && !user && pendingInviteCode) {
      setShowAuthModal(true);
    }
  }, [loading, pendingInviteCode, user]);

  // Show loading state while checking auth
  if (loading || accessLoading) {
    return <WorkspaceLoadingState label="Loading..." />;
  }

  const handleResumeFixedRoute = () => {
    if (!fixedRouteResume?.hash) return;
    window.location.hash = fixedRouteResume.hash;
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
        size="xl"
        zIndex="high"
        closeOnBackdropClick={!mustCompleteTeamSetup}
        closeOnEscape={!mustCompleteTeamSetup}
      >
        <Modal.Header showClose={!mustCompleteTeamSetup}>
          {mustCompleteTeamSetup ? 'Get Started' : 'Team Management'}
        </Modal.Header>
        <Modal.Body className="p-4 bg-gray-50">
          <TeamManagement onClose={mustCompleteTeamSetup ? undefined : () => setShowTeamManagement(false)} />
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
        canShowFileManager={Boolean(user && hasAvailableWorkspace && !mustCompleteTeamSetup)}
      />


      <main className={`flex-1 overflow-hidden relative flex flex-col mx-auto w-full px-6 py-8 ${currentView === 'home' ? 'max-w-7xl' : 'max-w-[1920px]'}`}>

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
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-y-auto h-full">
            <div className="text-center mb-12 mt-8">
              <h2 className="text-4xl font-extrabold text-gray-800 mb-4">Select Workspace</h2>
            </div>

            {user && fixedRouteResume && (
              <div className="max-w-4xl mx-auto mb-8 px-2">
                <button
                  onClick={handleResumeFixedRoute}
                  className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-left transition-all hover:border-emerald-300 hover:bg-emerald-100/70"
                >
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-emerald-600">Where you left off</div>
                      <div className="mt-1 text-base font-bold text-gray-900">{fixedRouteResume.label}</div>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
                      Resume
                      <ArrowRight size={16} />
                    </div>
                  </div>
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3 max-w-6xl mx-auto pb-12">
              {/* On Demand Card */}
              {isViewAvailable('ondemand') && (
                <button
                  onClick={() => setCurrentView('ondemand')}
                  className="group relative bg-white rounded-3xl border-b-8 border-gray-200 p-8 hover:border-brand-blue hover:-translate-y-1 transition-all duration-200 text-left overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Map size={120} />
                  </div>
                  <div className="bg-blue-100 w-16 h-16 rounded-2xl flex items-center justify-center text-brand-blue mb-6 group-hover:scale-110 transition-transform">
                    <LayoutDashboard size={32} />
                  </div>
                  <h3 className="text-2xl font-extrabold text-gray-800 mb-2 group-hover:text-brand-blue transition-colors">Transit On-Demand</h3>
                  <p className="text-gray-500 font-bold mb-6">
                    Manage driver shifts, analyze coverage gaps, and optimize 15-minute increments for dynamic demand.
                  </p>
                  <div className="flex items-center gap-2 text-brand-blue font-extrabold uppercase tracking-wide text-sm">
                    Enter Workspace <ArrowRight size={16} />
                  </div>
                </button>
              )}

              {/* Fixed Route Card */}
              {isViewAvailable('fixed') && (
                <button
                  onClick={() => setCurrentView('fixed')}
                  className="group relative bg-white rounded-3xl border-b-8 border-gray-200 p-8 hover:border-brand-green hover:-translate-y-1 transition-all duration-200 text-left overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Bus size={120} />
                  </div>
                  <div className="bg-green-100 w-16 h-16 rounded-2xl flex items-center justify-center text-brand-green mb-6 group-hover:scale-110 transition-transform">
                    <Bus size={32} />
                  </div>
                  <h3 className="text-2xl font-extrabold text-gray-800 mb-2 group-hover:text-brand-green transition-colors">Scheduled Transit</h3>
                  <p className="text-gray-500 font-bold mb-6">
                    Plan and manage route schedules — from CSV import and runtime analysis to published timetables and public brochures.
                  </p>
                  <div className="flex items-center gap-2 text-brand-green font-extrabold uppercase tracking-wide text-sm">
                    Enter Workspace <ArrowRight size={16} />
                  </div>
                </button>
              )}

              {/* Dashboard & Reporting Card */}
              {isViewAvailable('operations') && (
                <button
                  onClick={() => setCurrentView('operations')}
                  className="group relative bg-white rounded-3xl border-b-8 border-gray-200 p-8 hover:border-amber-500 hover:-translate-y-1 transition-all duration-200 text-left overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                    <BarChart2 size={120} />
                  </div>
                  <div className="bg-amber-100 w-16 h-16 rounded-2xl flex items-center justify-center text-amber-600 mb-6 group-hover:scale-110 transition-transform">
                    <BarChart2 size={32} />
                  </div>
                  <h3 className="text-2xl font-extrabold text-gray-800 mb-2 group-hover:text-amber-600 transition-colors">Dashboard & Reporting</h3>
                  <p className="text-gray-500 font-bold mb-6">
                    OTP analysis, ridership dashboards, and STREETS reporting for scheduled transit operations.
                  </p>
                  <div className="flex items-center gap-2 text-amber-600 font-extrabold uppercase tracking-wide text-sm">
                    Enter Workspace <ArrowRight size={16} />
                  </div>
                </button>
              )}

              {/* Parking Card */}
              {isViewAvailable('parking') && (
                <button
                  onClick={() => setCurrentView('parking')}
                  className="group relative bg-white rounded-3xl border-b-8 border-gray-200 p-8 hover:border-emerald-500 hover:-translate-y-1 transition-all duration-200 text-left overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Car size={120} />
                  </div>
                  <div className="bg-emerald-100 w-16 h-16 rounded-2xl flex items-center justify-center text-emerald-600 mb-6 group-hover:scale-110 transition-transform">
                    <Car size={32} />
                  </div>
                  <h3 className="text-2xl font-extrabold text-gray-800 mb-2 group-hover:text-emerald-600 transition-colors">Parking</h3>
                  <p className="text-gray-500 font-bold mb-6">
                    Import HotSpot shared-code usage, review department totals, and flag plate-level parking patterns.
                  </p>
                  <div className="flex items-center gap-2 text-emerald-600 font-extrabold uppercase tracking-wide text-sm">
                    Enter Workspace <ArrowRight size={16} />
                  </div>
                </button>
              )}

              {/* Planning Data Card */}
              {isViewAvailable('planning') && (
                <button
                  onClick={() => setCurrentView('planning')}
                  className="group relative bg-white rounded-3xl border-b-8 border-gray-200 p-8 hover:border-cyan-500 hover:-translate-y-1 transition-all duration-200 text-left overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Smartphone size={120} />
                  </div>
                  <div className="bg-cyan-100 w-16 h-16 rounded-2xl flex items-center justify-center text-cyan-600 mb-6 group-hover:scale-110 transition-transform">
                    <Smartphone size={32} />
                  </div>
                  <h3 className="text-2xl font-extrabold text-gray-800 mb-2 group-hover:text-cyan-600 transition-colors">Planning Data</h3>
                  <p className="text-gray-500 font-bold mb-6">
                    Analyze rider demand, Transit App data, and other planning datasets allowed for your access profile.
                  </p>
                  <div className="flex items-center gap-2 text-cyan-600 font-extrabold uppercase tracking-wide text-sm">
                    Enter Workspace <ArrowRight size={16} />
                  </div>
                </button>
              )}

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
