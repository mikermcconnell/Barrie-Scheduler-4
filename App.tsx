import React, { useState } from 'react';
import { OnDemandWorkspace } from './components/OnDemandWorkspace';
import { FixedRouteWorkspace } from './components/FixedRouteWorkspace';
import { AuthProvider, useAuth } from './components/AuthContext';
import { AuthModal } from './components/AuthModal';
import { FileManager } from './components/FileManager';
import { LayoutDashboard, Bus, Settings, Bell, ArrowRight, Map, CheckCircle2, User, LogOut, FolderOpen, ChevronDown, Loader2 } from 'lucide-react';

type View = 'home' | 'ondemand' | 'fixed';

const AppContent: React.FC = () => {
  const { user, loading, signOut } = useAuth();
  const [currentView, setCurrentView] = useState<View>('home');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showFileManager, setShowFileManager] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

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
    <div className="min-h-screen pb-20 font-sans text-gray-800 bg-[#F7F7F7]">

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

      {/* Global Header */}
      <nav className="bg-white border-b-2 border-gray-200 px-6 py-4 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div
            className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => setCurrentView('home')}
          >
            <div className="bg-brand-green p-2 rounded-xl">
              <LayoutDashboard className="text-white" size={24} />
            </div>
            <h1 className="text-2xl font-extrabold text-brand-green tracking-tight">
              Bus<span className="text-gray-700">Scheduler</span>
            </h1>
          </div>
          <div className="flex gap-3 items-center">
            {user && (
              <button
                onClick={() => setShowFileManager(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors font-bold text-gray-600"
              >
                <FolderOpen size={18} />
                <span className="hidden sm:inline">Files</span>
              </button>
            )}
            <button className="p-2 text-gray-400 hover:bg-gray-100 rounded-xl transition-colors">
              <Bell size={24} />
            </button>
            <button className="p-2 text-gray-400 hover:bg-gray-100 rounded-xl transition-colors">
              <Settings size={24} />
            </button>

            {/* User Avatar / Sign In */}
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 p-1 pr-3 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-green to-emerald-400 border-2 border-white shadow-sm flex items-center justify-center">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <User className="text-white" size={16} />
                    )}
                  </div>
                  <span className="text-sm font-bold text-gray-700 hidden sm:inline max-w-[120px] truncate">
                    {user.displayName || user.email?.split('@')[0]}
                  </span>
                  <ChevronDown size={14} className="text-gray-400" />
                </button>

                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                    <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg py-2 min-w-[200px] z-50">
                      <div className="px-4 py-2 border-b border-gray-100">
                        <p className="font-bold text-gray-800 truncate">{user.displayName || 'User'}</p>
                        <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      </div>
                      <button
                        onClick={() => { setShowFileManager(true); setShowUserMenu(false); }}
                        className="w-full px-4 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <FolderOpen size={16} /> My Files
                      </button>
                      <button
                        onClick={handleSignOut}
                        className="w-full px-4 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <LogOut size={16} /> Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-brand-green hover:bg-emerald-600 text-white rounded-xl transition-colors font-bold"
              >
                <User size={18} />
                Sign In
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Breadcrumb / Navigation State */}
      {currentView !== 'home' && (
        <div className="bg-white border-b border-gray-100 px-6 py-2">
          <div className="max-w-7xl mx-auto flex items-center gap-2 text-sm font-bold text-gray-400">
            <span className="hover:text-gray-600 cursor-pointer" onClick={() => setCurrentView('home')}>Home</span>
            <ArrowRight size={14} />
            <span className="text-brand-blue bg-blue-50 px-2 py-0.5 rounded-md">
              {currentView === 'ondemand' ? 'Transit On-Demand' : 'Scheduled Transit'}
            </span>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* Workspace Selector (Home View) */}
        {currentView === 'home' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-12 mt-8">
              <h2 className="text-4xl font-extrabold text-gray-800 mb-4">Select Workspace</h2>
              <p className="text-xl text-gray-500 font-semibold max-w-2xl mx-auto">
                Choose between managing dynamic Transit On-Demand shifts or optimizing Fixed Route schedules.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
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
                  Manage fixed routes (100, 200, 8A/B), set timetables, and monitor headway compliance.
                </p>
                <div className="flex items-center gap-2 text-brand-green font-extrabold uppercase tracking-wide text-sm">
                  Enter Workspace <ArrowRight size={16} />
                </div>
              </button>
            </div>

            <div className="mt-16 flex justify-center gap-8 text-gray-400 font-bold text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-brand-green" />
                System Operational
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-brand-green" />
                Data Synced (2 mins ago)
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Workspace Rendering */}
        {currentView === 'ondemand' && <OnDemandWorkspace />}
        {currentView === 'fixed' && <FixedRouteWorkspace />}

      </main>
    </div>
  );
};

// Main App component with AuthProvider wrapper
const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;