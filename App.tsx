import React, { useState } from 'react';
import { OnDemandWorkspace } from './components/OnDemandWorkspace';
import { FixedRouteWorkspace } from './components/FixedRouteWorkspace';
import { LayoutDashboard, Bus, Settings, Bell, ArrowRight, Map, CheckCircle2 } from 'lucide-react';

type View = 'home' | 'ondemand' | 'fixed';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('home');

  return (
    <div className="min-h-screen pb-20 font-sans text-gray-800 bg-[#F7F7F7]">
      
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
              Barrie<span className="text-gray-700">Transit</span> Planner
            </h1>
          </div>
          <div className="flex gap-4">
             <button className="p-2 text-gray-400 hover:bg-gray-100 rounded-xl transition-colors">
                <Bell size={24} />
             </button>
             <button className="p-2 text-gray-400 hover:bg-gray-100 rounded-xl transition-colors">
                <Settings size={24} />
             </button>
             <div className="w-10 h-10 rounded-full bg-gray-200 border-2 border-white shadow-sm overflow-hidden">
                <img src="https://picsum.photos/100/100" alt="User" />
             </div>
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

export default App;