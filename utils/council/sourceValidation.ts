export const APPROVED_COUNCIL_SOURCE_HOSTS = [
  'barrie.ca',
  'www.barrie.ca',
  'pub-barrie.escribemeetings.com',
] as const;

export type CouncilSourceValidation =
  | { ok: true; parsedUrl: URL }
  | { ok: false; reason: string };

export function validateCouncilSourceUrl(value: string): CouncilSourceValidation {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    return { ok: false, reason: 'Source URL is invalid.' };
  }

  if (parsedUrl.protocol !== 'https:') {
    return { ok: false, reason: 'Council sources must use HTTPS.' };
  }
  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, reason: 'Council source URLs cannot contain credentials.' };
  }
  if (parsedUrl.port && parsedUrl.port !== '443') {
    return { ok: false, reason: 'Council source URLs cannot use a custom port.' };
  }

  const hostname = parsedUrl.hostname.toLocaleLowerCase('en-CA').replace(/\.$/, '');
  if (!(APPROVED_COUNCIL_SOURCE_HOSTS as readonly string[]).includes(hostname)) {
    return { ok: false, reason: 'Council source host is not approved.' };
  }

  return { ok: true, parsedUrl };
}

export function isApprovedCouncilSourceUrl(value: string): boolean {
  return validateCouncilSourceUrl(value).ok;
}
