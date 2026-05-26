import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const {
  resetPasswordMock,
  signInMock,
  signUpMock,
} = vi.hoisted(() => ({
  resetPasswordMock: vi.fn(),
  signInMock: vi.fn(),
  signUpMock: vi.fn(),
}));

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => ({
    signIn: signInMock,
    signUp: signUpMock,
    signInWithGoogle: vi.fn(),
    resetPassword: resetPasswordMock,
    signInWithDevAccess: vi.fn(),
    hasDevAccess: false,
    devAccessLabel: null as string | null,
  }),
}));

import { AuthModal } from '../components/modals/AuthModal';

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('AuthModal password reset', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetPasswordMock.mockReset();
    resetPasswordMock.mockResolvedValue(undefined);
    signInMock.mockReset();
    signInMock.mockResolvedValue(undefined);
    signUpMock.mockReset();
    signUpMock.mockResolvedValue(undefined);
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
      setInputValue(emailInput, '  lane.user@example.com  ');
    });

    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(resetPasswordMock).toHaveBeenCalledWith('lane.user@example.com');
    expect(container.textContent).toContain('If an account exists for that email');
  });

  it('shows a generic invite-aware sign-in error instead of Firebase details', async () => {
    signInMock.mockRejectedValue({
      code: 'auth/invalid-credential',
      message: 'Firebase: Error (auth/invalid-credential).',
    });

    await act(async () => {
      root.render(<AuthModal isOpen={true} onClose={vi.fn()} inviteCode="ABC123" />);
    });

    const [emailInput, passwordInput] = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];

    await act(async () => {
      setInputValue(emailInput, 'planner@example.com');
      setInputValue(passwordInput, 'wrong-password');
    });

    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'We could not sign you in. Check your email and password, or create an account to use this invite.',
    );
    expect(container.textContent).not.toContain('Firebase');
    expect(container.textContent).not.toContain('auth/invalid-credential');
  });

  it('shows a generic invite-aware existing-account message on sign-up', async () => {
    signUpMock.mockRejectedValue({
      code: 'auth/email-already-in-use',
      message: 'Firebase: Error (auth/email-already-in-use).',
    });

    await act(async () => {
      root.render(<AuthModal isOpen={true} onClose={vi.fn()} inviteCode="ABC123" />);
    });

    const signUpButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Sign up'),
    ) as HTMLButtonElement;

    await act(async () => {
      signUpButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const [emailInput, passwordInput, confirmInput] = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];

    await act(async () => {
      setInputValue(emailInput, 'planner@example.com');
      setInputValue(passwordInput, 'correct-password');
      setInputValue(confirmInput, 'correct-password');
    });

    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'An account already exists for this email. Sign in instead to use this invite.',
    );
    expect(container.textContent).not.toContain('Firebase');
    expect(container.textContent).not.toContain('auth/email-already-in-use');
  });
});
