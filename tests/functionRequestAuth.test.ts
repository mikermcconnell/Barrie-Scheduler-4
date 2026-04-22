import { describe, expect, it } from 'vitest';
import { hasValidApiKey } from '../functions/src/requestAuth';

describe('function request API key auth', () => {
  it('accepts matching x-api-key headers', () => {
    expect(
      hasValidApiKey({ headers: { 'x-api-key': 'secret-1' } }, 'secret-1')
    ).toBe(true);
  });

  it('rejects missing or mismatched x-api-key headers', () => {
    expect(hasValidApiKey({ headers: {} }, 'secret-1')).toBe(false);
    expect(
      hasValidApiKey({ headers: { 'x-api-key': 'wrong' } }, 'secret-1')
    ).toBe(false);
  });
});
