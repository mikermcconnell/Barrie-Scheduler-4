import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface HostingRewrite {
  source?: string;
  destination?: string;
  function?: {
    functionId?: string;
  };
}

interface FirebaseConfig {
  hosting?: {
    rewrites?: HostingRewrite[];
  };
}

const config = JSON.parse(
  readFileSync('firebase.json', 'utf8')
) as FirebaseConfig;

describe('Firebase Hosting configuration', () => {
  it('does not rewrite missing built assets to index.html', () => {
    const indexRewrite = config.hosting?.rewrites?.find(
      (rewrite) => rewrite.destination === '/index.html'
    );

    expect(indexRewrite?.source).toBe('!/assets/**');
    expect(config.hosting?.rewrites).not.toContainEqual({
      source: '**',
      destination: '/index.html',
    });
  });

  it('keeps the route planner API rewrite ahead of the client-route fallback', () => {
    const rewrites = config.hosting?.rewrites ?? [];
    const apiIndex = rewrites.findIndex(
      (rewrite) => rewrite.function?.functionId === 'routePlannerGeocode'
    );
    const clientRouteIndex = rewrites.findIndex(
      (rewrite) => rewrite.destination === '/index.html'
    );

    expect(apiIndex).toBeGreaterThanOrEqual(0);
    expect(clientRouteIndex).toBeGreaterThan(apiIndex);
  });
});
