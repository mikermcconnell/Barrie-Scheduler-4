import { describe, expect, it } from 'vitest';
import { isEditableEventTarget } from '../utils/domUtils';

describe('isEditableEventTarget', () => {
    it('returns true for form fields', () => {
        expect(isEditableEventTarget(document.createElement('input'))).toBe(true);
        expect(isEditableEventTarget(document.createElement('textarea'))).toBe(true);
        expect(isEditableEventTarget(document.createElement('select'))).toBe(true);
    });

    it('returns true for contenteditable descendants', () => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('contenteditable', 'true');
        const child = document.createElement('span');
        wrapper.appendChild(child);

        expect(isEditableEventTarget(child)).toBe(true);
    });

    it('returns false for non-editable elements and null', () => {
        expect(isEditableEventTarget(document.createElement('button'))).toBe(false);
        expect(isEditableEventTarget(document.createElement('div'))).toBe(false);
        expect(isEditableEventTarget(null)).toBe(false);
    });
});
