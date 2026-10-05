import React from 'react';
import { createRoot } from 'react-dom/client';
import { StreetDesignStudioWorkspace } from '../../components/Analytics/StreetDesignStudioWorkspace';
createRoot(document.getElementById('root')!).render(<StreetDesignStudioWorkspace onBack={() => {}} />);
