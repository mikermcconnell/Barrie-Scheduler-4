import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from '../components/contexts/AuthContext';
import { ToastProvider } from '../components/contexts/ToastContext';
import { OnDemandWorkspace } from '../components/workspaces/OnDemandWorkspace';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find the Transit On-Demand demo capture root');
}

ReactDOM.createRoot(rootElement).render(
  <AuthProvider>
    <ToastProvider>
      <main className="h-screen overflow-hidden bg-[#F7F7F7] px-8 py-6 font-sans text-gray-800">
        <OnDemandWorkspace
          initialMode="empty"
          captureFileStageEventName="tod-demo-stage-files"
        />
      </main>
    </ToastProvider>
  </AuthProvider>,
);
