type RequestWithHeaders = {
  headers?: Record<string, unknown>;
};

export function hasValidApiKey(
  req: RequestWithHeaders,
  expectedApiKey: string | undefined,
  headerName = 'x-api-key',
): boolean {
  if (!expectedApiKey) return false;

  const rawHeader = req.headers?.[headerName];
  const providedApiKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  return typeof providedApiKey === 'string' && providedApiKey === expectedApiKey;
}
