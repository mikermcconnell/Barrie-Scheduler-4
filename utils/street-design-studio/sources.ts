export function validateStreetStyleUrl(value: string, allowedHosts: string[] = ['tiles.openfreemap.org']): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || !allowedHosts.includes(url.hostname)) throw new Error('Street style host is not approved.');
  return url.toString();
}
export function validateImageryTemplate(value: string, allowedHosts: string[]): string {
  const sample = value.replace('{z}', '1').replace('{x}', '1').replace('{y}', '1');
  const url = new URL(sample);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || !allowedHosts.includes(url.hostname) || !value.includes('{z}') || !value.includes('{x}') || !value.includes('{y}')) throw new Error('Imagery requires an approved HTTPS XYZ host with no client secret or query token.');
  return value;
}
