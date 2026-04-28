import { useEffect } from 'react';

export function useUnsavedChangesWarning(
  shouldWarn: boolean,
  message = 'You have unsaved changes. Leave anyway?',
): void {
  useEffect(() => {
    if (!shouldWarn || typeof window === 'undefined') {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [message, shouldWarn]);
}
