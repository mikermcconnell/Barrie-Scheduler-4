import type { CouncilTransitTopic } from './types';

export interface CouncilTransitClassification {
  isTransitRelevant: boolean;
  score: number;
  topics: CouncilTransitTopic[];
  matchedTerms: string[];
}

const TOPIC_TERMS: Record<CouncilTransitTopic, readonly string[]> = {
  service_levels: ['transit service', 'service level', 'service frequency', 'headway', 'service hours'],
  routes: ['bus route', 'transit route', 'route change', 'route network', 'route extension'],
  transit_on_demand: ['transit on demand', 'transit-on-demand', 'on demand transit', 'rideco'],
  fares: ['transit fare', 'bus fare', 'fare increase', 'fare integration', 'fare policy'],
  accessibility: ['accessible transit', 'transit accessibility', 'wheel-trans', 'paratransit', 'mobility device'],
  terminals: ['transit terminal', 'bus terminal', 'transit hub', 'allandale go', 'barrie south go'],
  fleet: ['transit fleet', 'bus fleet', 'electric bus', 'zero-emission bus', 'bus replacement'],
  capital: ['transit capital', 'transit facility', 'bus garage', 'transit infrastructure'],
  student_senior_programs: ['student transit', 'senior transit', 'student pass', 'seniors pass', 'school special'],
  parking_integration: ['park and ride', 'parking integration', 'go station parking'],
  active_transportation: ['active transportation', 'bike lane', 'cycling network', 'pedestrian connection'],
  development_impacts: ['transit impact', 'transit-oriented development', 'transit oriented development', 'bus stop relocation'],
  special_event_service: ['special event service', 'event shuttle', 'transit shuttle', 'extra bus service'],
};

const STRONG_TRANSIT_TERMS = ['barrie transit', 'public transit', 'bus service', 'bus stop'];

function normalizeSearchText(text: string): string {
  return text.toLocaleLowerCase('en-CA').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
}

export function classifyTransitRelevance(text: string): CouncilTransitClassification {
  const normalized = normalizeSearchText(text);
  const topics: CouncilTransitTopic[] = [];
  const matches = new Set<string>();

  for (const [topic, terms] of Object.entries(TOPIC_TERMS) as Array<[CouncilTransitTopic, readonly string[]]>) {
    const topicMatches = terms.filter(term => normalized.includes(term));
    if (topicMatches.length > 0) {
      topics.push(topic);
      topicMatches.forEach(term => matches.add(term));
    }
  }

  STRONG_TRANSIT_TERMS.filter(term => normalized.includes(term)).forEach(term => matches.add(term));
  const score = Math.min(1, topics.length * 0.25 + matches.size * 0.15);

  return {
    isTransitRelevant: topics.length > 0 || STRONG_TRANSIT_TERMS.some(term => normalized.includes(term)),
    score,
    topics,
    matchedTerms: [...matches],
  };
}

export function getCouncilTransitTopicLabel(topic: CouncilTransitTopic): string {
  return topic.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}
