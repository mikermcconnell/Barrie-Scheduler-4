import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { ScheduleReviewPanel, type ScheduleReviewPanelProps } from '../components/schedule/ScheduleReviewPanel';

describe('ScheduleReviewPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  const baseProps = (): ScheduleReviewPanelProps => ({
    isOpen: true,
    onClose: vi.fn(),
    sourceMasterLabel: 'Published master',
    sourceMasterVersion: 12,
    baselineTripCount: 48,
    changeCounts: { added: 1, removed: 2, retimed: 4, blockChanged: 1 },
    issues: [],
    publishNote: '',
    onPublishNoteChange: vi.fn(),
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  const render = (props: Partial<ScheduleReviewPanelProps> = {}) => {
    const completeProps = { ...baseProps(), ...props };
    flushSync(() => root.render(<ScheduleReviewPanel {...completeProps} />));
    return completeProps;
  };

  it('shows a concise source and change summary', () => {
    render();

    expect(container.textContent).toContain('Review changes');
    expect(container.textContent).toContain('Compared with Published master · v12');
    expect(container.textContent).toContain('8 changes across 48 baseline trips');
    expect(container.textContent).toContain('Retimed4');
    expect(container.textContent).toContain('No operational issues found');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('orders issues by severity and jumps to the selected row', () => {
    const onJumpToRow = vi.fn();
    render({
      onJumpToRow,
      issues: [
        { id: 'notice', severity: 'info', title: 'Headway changed', rowId: 'row-3' },
        { id: 'warning', severity: 'warning', title: 'Tight recovery', rowId: 'row-2' },
        { id: 'error', severity: 'error', title: 'Block overlap', rowId: 'row-1', rowLabel: 'Block 4' },
      ],
    });

    const issues = Array.from(container.querySelectorAll('li[data-severity]'));
    expect(issues.map(issue => issue.getAttribute('data-severity'))).toEqual(['error', 'warning', 'info']);
    expect(issues[0].textContent).toContain('Block overlap');

    const jumpButtons = Array.from(container.querySelectorAll('button')).filter(button => button.textContent?.includes('Jump to row'));
    flushSync(() => jumpButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onJumpToRow).toHaveBeenCalledWith('row-1');
  });

  it('exposes stale, checkpoint, note, review, and publish actions without deciding readiness', () => {
    const onCreateCheckpoint = vi.fn();
    const onReadyForReview = vi.fn();
    const onPublish = vi.fn();
    const onPublishNoteChange = vi.fn();
    render({
      isStale: true,
      onCreateCheckpoint,
      onReadyForReview,
      onPublish,
      onPublishNoteChange,
      publishDisabled: true,
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Source master has changed');

    const buttons = Array.from(container.querySelectorAll('button'));
    const checkpoint = buttons.find(button => button.textContent === 'Create') as HTMLButtonElement;
    const review = buttons.find(button => button.textContent === 'Ready for review') as HTMLButtonElement;
    const publish = buttons.find(button => button.textContent === 'Publish new version') as HTMLButtonElement;

    flushSync(() => checkpoint.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    flushSync(() => review.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onCreateCheckpoint).toHaveBeenCalledOnce();
    expect(onReadyForReview).toHaveBeenCalledOnce();
    expect(publish.disabled).toBe(true);
    expect(onPublish).not.toHaveBeenCalled();

    const note = container.querySelector('textarea') as HTMLTextAreaElement;
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    flushSync(() => {
      valueSetter?.call(note, 'Adjusted PM peak times');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onPublishNoteChange).toHaveBeenCalledWith('Adjusted PM peak times');
  });

  it('navigates changes and toggles changed rows only', () => {
    const onJumpToRow = vi.fn();
    const onNextChange = vi.fn();
    const onShowChangedOnlyChange = vi.fn();
    render({
      changes: [{ id: 'change-1', title: 'Trip retimed', rowId: 'trip-1', rowLabel: 'Block 4' }],
      onJumpToRow,
      onNextChange,
      onShowChangedOnlyChange,
      showChangedOnly: false,
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    flushSync(() => buttons.find(button => button.textContent === 'Next change')?.click());
    flushSync(() => buttons.find(button => button.textContent === 'Changed rows only')?.click());
    flushSync(() => buttons.find(button => button.textContent?.includes('Trip retimed'))?.click());

    expect(onNextChange).toHaveBeenCalledOnce();
    expect(onShowChangedOnlyChange).toHaveBeenCalledWith(true);
    expect(onJumpToRow).toHaveBeenCalledWith('trip-1');
    expect((container.querySelector('textarea') as HTMLTextAreaElement).maxLength).toBe(500);
  });

  it('renders nothing while closed', () => {
    render({ isOpen: false });
    expect(container.childElementCount).toBe(0);
  });
});
