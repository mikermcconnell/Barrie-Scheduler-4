/**
 * useTimeValidation Hook
 * Provides time input validation with visual feedback state.
 */

import { useState, useCallback } from 'react';
import { TimeUtils } from '../utils/timeUtils';

interface ValidationState {
    isValid: boolean;
    errorMessage: string | null;
    showError: boolean;
}

export const useTimeValidation = () => {
    const [validationStates, setValidationStates] = useState<Record<string, ValidationState>>({});

    const validateTime = useCallback((inputId: string, value: string): boolean => {
        if (!value.trim()) {
            // Empty is valid (will be cleared)
            setValidationStates(prev => ({
                ...prev,
                [inputId]: { isValid: true, errorMessage: null, showError: false }
            }));
            return true;
        }

        const parsed = TimeUtils.toMinutes(value);

        if (parsed === null) {
            setValidationStates(prev => ({
                ...prev,
                [inputId]: {
                    isValid: false,
                    errorMessage: 'Invalid time format. Use HH:MM or H:MM AM/PM',
                    showError: true
                }
            }));

            // Auto-hide error after 3 seconds
            setTimeout(() => {
                setValidationStates(prev => ({
                    ...prev,
                    [inputId]: { ...prev[inputId], showError: false }
                }));
            }, 3000);

            return false;
        }

        setValidationStates(prev => ({
            ...prev,
            [inputId]: { isValid: true, errorMessage: null, showError: false }
        }));
        return true;
    }, []);

    const getValidationState = useCallback((inputId: string): ValidationState => {
        return validationStates[inputId] || { isValid: true, errorMessage: null, showError: false };
    }, [validationStates]);

    const clearValidation = useCallback((inputId: string) => {
        setValidationStates(prev => ({
            ...prev,
            [inputId]: { isValid: true, errorMessage: null, showError: false }
        }));
    }, []);

    return {
        validateTime,
        getValidationState,
        clearValidation
    };
};

// CSS classes for validation states
export const getValidationClasses = (isValid: boolean, showError: boolean): string => {
    if (!isValid && showError) {
        return 'border-red-400 ring-2 ring-red-100 animate-shake';
    }
    return '';
};

// Add shake animation to your CSS or Tailwind config:
// @keyframes shake {
//   0%, 100% { transform: translateX(0); }
//   25% { transform: translateX(-4px); }
//   75% { transform: translateX(4px); }
// }
// .animate-shake { animation: shake 0.3s ease-in-out; }

export default useTimeValidation;
