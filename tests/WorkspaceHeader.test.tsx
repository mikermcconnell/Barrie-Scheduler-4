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

  const renderHeader = (overrides: Partial<React.ComponentProps<typeof WorkspaceHeader>> = {}) => {
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
          {...overrides}
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

  it('shows source and review counts with Review Changes as the primary action', () => {
    let reviewCalls = 0;
    renderHeader({
      sourceLabel: 'Published master v12',
      changeCount: 4,
      warningCount: 2,
      onReviewChanges: () => { reviewCalls += 1; },
      onPublish: () => {},
    });

    expect(container?.textContent).toContain('From Published master v12');
    expect(container?.textContent).toContain('4 changes');
    expect(container?.textContent).toContain('2 warnings');

    const reviewButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.includes('Review Changes (4)')
    ) as HTMLButtonElement | undefined;

    expect(reviewButton).toBeTruthy();
    flushSync(() => reviewButton?.click());
    expect(reviewCalls).toBe(1);

    const visiblePublishButtons = Array.from(container?.querySelectorAll('button') ?? []).filter(
      button => button.textContent?.trim() === 'Publish'
    );
    expect(visiblePublishButtons).toHaveLength(0);
  });

  it('keeps schedule views available in an accessible menu', () => {
    renderHeader();

    const viewMenu = Array.from(container?.querySelectorAll('details') ?? []).find(
      details => details.querySelector('summary')?.textContent?.includes('Schedule')
    );
    expect(viewMenu).toBeTruthy();
    expect(viewMenu?.querySelector('button[aria-current="page"]')?.textContent).toContain('Schedule');
    expect(viewMenu?.textContent).toContain('Timeline');
    expect(viewMenu?.textContent).toContain('Travel Times');
  });
});
