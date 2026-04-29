import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { RoutePlanner2Workspace } from '../components/Analytics/RoutePlanner2Workspace';

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function click(element: Element | null | undefined) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  ) ?? null;
}

describe('RoutePlanner2Workspace local workspace', () => {
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

  function renderWorkspace() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2Workspace
          onBack={() => {}}
          userId="user-1"
          teamId="team-1"
        />,
      );
    });

    return container;
  }

  it('renders the clean local blank-concept foundation', () => {
    const view = renderWorkspace();
    const notes = view.querySelector('#rp2-notes') as HTMLTextAreaElement | null;

    expect(view.textContent).toContain('Route Planner 2');
    expect(view.textContent).toContain('Local draft');
    expect(view.textContent).toContain('Clean Concept A');
    expect(notes?.value).toContain('Blank route concept');
    expect(view.textContent).not.toContain('Shuttle Template');
  });

  it('adds Option 2 as a local scenario', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Add scenario'));
    });

    expect(view.textContent).toContain('Option 2');
  });

  it('edits the selected scenario name', () => {
    const view = renderWorkspace();
    const nameInput = view.querySelector('#rp2-scenario-name') as HTMLInputElement | null;

    expect(nameInput).not.toBeNull();

    flushSync(() => {
      setInputValue(nameInput!, 'Downtown Loop Option');
    });

    expect(view.textContent).toContain('Downtown Loop Option');
  });

  it('marks the selected scenario as preferred', () => {
    const view = renderWorkspace();

    expect(view.textContent).toContain('No preferred scenario yet');

    flushSync(() => {
      click(findButton(view, 'Mark preferred'));
    });

    expect(view.textContent).not.toContain('No preferred scenario yet');
    expect(view.textContent).toContain('(preferred)');
  });

  it('deletes the selected scenario when more than one exists', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Add scenario'));
    });
    expect(view.textContent).toContain('Option 2');

    flushSync(() => {
      click(findButton(view, 'Delete'));
    });

    expect(view.textContent).not.toContain('Option 2');
    expect(view.textContent).toContain('Clean Concept A');
  });

  it('renders the scenario comparison table', () => {
    const view = renderWorkspace();

    expect(view.textContent).toContain('Scenario comparison');
    expect(view.textContent).toContain('Stops');
    expect(view.textContent).toContain('Runtime');
    expect(view.textContent).toContain('Buses');
    expect(view.textContent).toContain('Warnings');
  });

  it('adds route points and stops from the authoring canvas', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Add route point'));
      click(findButton(view, 'Add stop'));
    });

    const stopNameInput = view.querySelector('#rp2-stop-name') as HTMLInputElement | null;

    expect(view.textContent).toContain('Route points');
    expect(view.textContent).toContain('Stop order');
    expect(stopNameInput?.value).toBe('Stop 1');
  });

  it('marks start and end terminals through stop role editing', () => {
    const view = renderWorkspace();

    expect(view.textContent).toContain('Add stops before checking route feasibility.');

    flushSync(() => {
      click(findButton(view, 'Add stop'));
    });
    expect(view.textContent).toContain('Add a start terminal before estimating cycle time.');

    const roleSelect = view.querySelector('#rp2-stop-role') as HTMLSelectElement | null;
    expect(roleSelect).not.toBeNull();

    flushSync(() => {
      setInputValue(roleSelect!, 'start-terminal');
    });
    flushSync(() => {
      click(findButton(view, 'Add stop'));
    });
    flushSync(() => {
      click(findButton(view, 'Stop 2'));
    });

    const updatedRoleSelect = view.querySelector('#rp2-stop-role') as HTMLSelectElement | null;
    flushSync(() => {
      setInputValue(updatedRoleSelect!, 'end-terminal');
    });

    expect(view.textContent).toContain('Runtime uses fallback assumptions');
    expect(view.textContent).toContain('Segment runtime source');
    expect(view.textContent).toContain('fallback');
  });

  it('updates feasibility outputs when service assumptions change', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Add stop'));
    });
    const roleSelect = view.querySelector('#rp2-stop-role') as HTMLSelectElement | null;
    flushSync(() => {
      setInputValue(roleSelect!, 'start-terminal');
    });
    flushSync(() => {
      click(findButton(view, 'Add stop'));
    });
    flushSync(() => {
      click(findButton(view, 'Stop 2'));
    });
    const updatedRoleSelect = view.querySelector('#rp2-stop-role') as HTMLSelectElement | null;
    flushSync(() => {
      setInputValue(updatedRoleSelect!, 'end-terminal');
    });

    const numberInputs = Array.from(view.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    const frequencyInput = numberInputs.find((input) => input.value === '30');
    expect(frequencyInput).toBeTruthy();

    flushSync(() => {
      setInputValue(frequencyInput!, '0');
    });

    expect(view.textContent).toContain('Target frequency must be greater than zero.');
  });
});
