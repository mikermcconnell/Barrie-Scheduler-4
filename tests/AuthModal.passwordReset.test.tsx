import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const resetPasswordMock = vi.hoisted(() => vi.fn());

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithGoogle: vi.fn(),
    resetPassword: resetPasswordMock,
    signInWithDevAccess: vi.fn(),
    hasDevAccess: false,
    devAccessLabel: null as string | null,
  }),
}));

import { AuthModal } from '../components/modals/AuthModal';

describe('AuthModal password reset', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetPasswordMock.mockReset();
    resetPasswordMock.mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it('trims the reset email and does not promise delivery for missing accounts', async () => {
    await act(async () => {
      root.render(<AuthModal isOpen={true} onClose={vi.fn()} />);
    });

    const forgotButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Forgot your password?'),
    ) as HTMLButtonElement;

    await act(async () => {
      forgotButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;

    await act(async () => {
      emailInput.value = '  lane.user@example.com  ';
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(resetPasswordMock).toHaveBeenCalledWith('lane.user@example.com');
    expect(container.textContent).toContain('If an account exists for that email');
  });
});
