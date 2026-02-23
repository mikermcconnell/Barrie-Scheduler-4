import React, { useState, useCallback, useEffect } from 'react';
import { OnDemandWorkspace } from './components/workspaces/OnDemandWorkspace';
import { FixedRouteWorkspace } from './components/workspaces/FixedRouteWorkspace';
import { OperationsWorkspace } from './components/workspaces/OperationsWorkspace';
import { AuthProvider, useAuth } from './components/contexts/AuthContext';
import { TeamProvider } from './components/contexts/TeamContext';
import { ToastProvider } from './components/contexts/ToastContext';
import { AuthModal } from './components/modals/AuthModal';
import { FileManager } from './components/FileManager';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Modal } from './components/ui/Modal';
import { TeamManagement } from './components/TeamManagement';
import { LayoutDashboard, Bus, Settings, Bell, ArrowRight, ArrowLeft, Map, User, LogOut, FolderOpen, ChevronDown, ChevronRight, Loader2, FileSpreadsheet, Plus, Download, CalendarPlus, Timer, BarChart2, Settings2, Sparkles } from 'lucide-react';
import { Header, View } from './components/layout/Header';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

function parseHashView(): View {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('fixed')) return 'fixed';
  if (hash.startsWith('ondemand')) return 'ondemand';
  if (hash.startsWith('operations')) return 'operations';
  return 'home';
}



const AppContent: React.FC = () => {
  const { user, loading, signOut } = useAuth();
  const [currentView, setCurrentViewState] = useState<View>(parseHashView);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showFileManager, setShowFileManager] = useState(false);
  const [showTeamManagement, setShowTeamManagement] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Wrap navigation to sync URL hash
  const setCurrentView = useCallback((view: View) => {
    setCurrentViewState(view);
    window.location.hash = view === 'home' ? '' : view;
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const handler = () => setCurrentViewState(parseHashView());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F7F7]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-brand-green" size={48} />
          <p className="text-gray-500 font-bold">Loading...</p>
        </div>
      </div>
    );
  }



  const handleSignOut = async () => {
    await signOut();
    setShowUserMenu(false);
    setCurrentView('home');
  };

  return (
    <div className="flex flex-col h-screen font-sans text-gray-800 bg-[#F7F7F7] overflow-hidden">

      {/* Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />

      {/* File Manager Modal */}
      {showFileManager && user && (
        <FileManager
          onClose={() => setShowFileManager(false)}
          onSelectSchedule={(schedule) => {
            console.log('Selected schedule:', schedule);
            setShowFileManager(false);
          }}
          onSelectFile={(file) => {
            console.log('Selected file:', file);
            setShowFileManager(false);
          }}
        />
      )}

      {/* Team Management Modal */}
      <Modal
        isOpen={showTeamManagement}
        onClose={() => setShowTeamManagement(false)}
        size="lg"
        zIndex="high"
      >
        <Modal.Header>Team Management</Modal.Header>
        <Modal.Body className="p-4 bg-gray-50">
          <TeamManagement />
        </Modal.Body>
      </Modal>

      {/* Global Header */}
      <Header
        currentView={currentView}
        onNavigate={setCurrentView}
        onShowFileManager={() => setShowFileManager(true)}
        onShowTeamManagement={() => setShowTeamManagement(true)}
        onShowAuthModal={() => setShowAuthModal(true)}
      />


      <main className={`flex-1 overflow-hidden relative flex flex-col mx-auto w-full px-6 py-8 ${currentView === 'home' ? 'max-w-7xl' : 'max-w-[1920px]'}`}>

        {/* Workspace Selector (Home View) */}
        {currentView === 'home' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-y-auto h-full">
            <div className="text-center mb-12 mt-8">
              <h2 className="text-4xl font-extrabold text-gray-800 mb-4">Select Workspace</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto pb-12">
              {/* On Demand Card */}
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

              {/* Fixed Route Card */}
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

              {/* Dashboard & Reporting Card */}
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

            </div>

          </div>
        )}

        {/* Dynamic Workspace Rendering */}
        {currentView === 'ondemand' && (
          <ErrorBoundary fallbackTitle="Workspace Error">
            <OnDemandWorkspace />
          </ErrorBoundary>
        )}
        {currentView === 'fixed' && (
          <ErrorBoundary fallbackTitle="Workspace Error">
            <FixedRouteWorkspace />
          </ErrorBoundary>
        )}
        {currentView === 'operations' && (
          <ErrorBoundary fallbackTitle="Workspace Error">
            <OperationsWorkspace />
          </ErrorBoundary>
        )}


      </main>
    </div>
  );
};

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
