import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { WorkspaceHeader } from '../components/layout/WorkspaceHeader';

describe('WorkspaceHeader', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
  });

  const renderHeader = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <WorkspaceHeader
          routeGroupName="2"
          dayLabel="Sunday"
          isRoundTrip
          subView="editor"
          onViewChange={() => {}}
          onSaveVersion={() => {}}
          autoSaveStatus="idle"
          lastSaved={new Date('2026-04-17T10:00:00Z')}
          hasUnsavedChanges
          summaryTable={{
            routeName: '2 (Sunday) (North)',
            stops: ['Park Place', 'Downtown Hub'],
            stopIds: { 'Park Place': '777', 'Downtown Hub': '1' },
            trips: [],
          }}
          draftName="Sunday System"
          onOpenDrafts={() => {}}
          onNewDraft={() => {}}
          onDuplicateDraft={() => {}}
          onExport={() => {}}
        />
      );
    });
  };

  it('renders Save now before Drafts in the header action row', () => {
    renderHeader();

    const saveButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.includes('Save now')
    );
    const draftsButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.includes('Drafts')
    );

    expect(saveButton).toBeTruthy();
    expect(draftsButton).toBeTruthy();
    expect(saveButton?.compareDocumentPosition(draftsButton as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
