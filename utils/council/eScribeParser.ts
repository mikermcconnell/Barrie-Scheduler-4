import { classifyTransitRelevance } from './transitTaxonomy';
import type {
  CouncilAttendance,
  CouncilAttendanceStatus,
  CouncilEvidence,
  CouncilItem,
  CouncilMeetingStatus,
  CouncilMotion,
  CouncilMotionOutcome,
  CouncilParseResult,
  CouncilVote,
  CouncilVoteChoice,
} from './types';
import { validateCouncilSourceUrl } from './sourceValidation';

export interface EScribeMeetingMetadata {
  meetingId: string;
  sourceUrl: string;
  termId?: string;
  sourceId?: string;
  title?: string;
  committee?: string;
  startsAt?: string;
  status?: CouncilMeetingStatus;
  retrievedAt?: string;
  contentHash?: string;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedLabel(value: string): string {
  return cleanText(value).toLocaleLowerCase('en-CA').replace(/[^a-z0-9]+/g, ' ').trim();
}

function firstText(root: ParentNode, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const value = cleanText(root.querySelector(selector)?.textContent);
    if (value) return value;
  }
  return '';
}

function fieldValue(root: ParentNode, labels: readonly string[]): string {
  const normalizedLabels = labels.map(normalizedLabel);
  const labelled = [...root.querySelectorAll<HTMLElement>('[data-label], dt, th, .label, .field-label')];
  for (const element of labelled) {
    const label = normalizedLabel(element.dataset.label ?? element.textContent ?? '');
    if (!normalizedLabels.some(candidate => label === candidate || label.startsWith(`${candidate} `))) continue;
    const value = element.dataset.value
      ?? element.nextElementSibling?.textContent
      ?? element.parentElement?.querySelector<HTMLElement>('.value, dd, td')?.textContent;
    const cleaned = cleanText(value);
    if (cleaned && normalizedLabel(cleaned) !== label) return cleaned;
  }
  return '';
}

function parseOutcome(text: string): CouncilMotionOutcome {
  const normalized = normalizedLabel(text);
  if (/\bcarried\b/.test(normalized)) return 'carried';
  if (/\bdefeated\b|\blost\b/.test(normalized)) return 'defeated';
  if (/\bwithdrawn\b/.test(normalized)) return 'withdrawn';
  if (/\breferred\b/.test(normalized)) return 'referred';
  if (/\btabled\b|\bdeferred\b/.test(normalized)) return 'tabled';
  return 'unknown';
}

function parseChoice(value: string): CouncilVoteChoice | null {
  const normalized = normalizedLabel(value);
  if (/^(yes|yea|aye|for|in favour|in favor)$/.test(normalized)) return 'yes';
  if (/^(no|nay|against|opposed)$/.test(normalized)) return 'no';
  if (/^(abstain|abstained)$/.test(normalized)) return 'abstain';
  if (/^(absent)$/.test(normalized)) return 'absent';
  if (/^(conflict|declared conflict|pecuniary interest)$/.test(normalized)) return 'conflict';
  return null;
}

function splitNames(value: string): string[] {
  return value.split(/[,;]|\band\b/gi).map(cleanText).filter(Boolean);
}

function parseRecordedVotes(root: ParentNode): CouncilVote[] {
  const votes: CouncilVote[] = [];
  const seen = new Set<string>();
  const add = (name: string, choice: CouncilVoteChoice, sourceText: string) => {
    const councillorName = cleanText(name).replace(/^(councillor|mayor)\s+/i, '');
    const key = `${normalizedLabel(councillorName)}:${choice}`;
    if (!councillorName || seen.has(key)) return;
    seen.add(key);
    votes.push({ councillorName, choice, isRecorded: true, sourceText: cleanText(sourceText) });
  };

  for (const table of root.querySelectorAll('table')) {
    const tableLabel = normalizedLabel(
      `${table.getAttribute('aria-label') ?? ''} ${table.querySelector('caption')?.textContent ?? ''} ${table.querySelector('thead')?.textContent ?? ''}`,
    );
    const isVoteTable = table.matches('[data-recorded-vote], [data-vote-table], .recorded-vote, .recordedVote')
      || /\b(recorded )?vote\b/.test(tableLabel);
    if (!isVoteTable) continue;
    for (const row of table.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('td')].map(cell => cleanText(cell.textContent));
      if (cells.length < 2) continue;
      const choice = parseChoice(cells[cells.length - 1]);
      if (choice) add(cells[0], choice, cells.join(' | '));
    }
  }

  const recordedSections = [...root.querySelectorAll<HTMLElement>('[data-recorded-vote], .recorded-vote, .recordedVote')];
  for (const section of recordedSections) {
    for (const element of section.querySelectorAll<HTMLElement>('[data-vote-choice], li, p, div')) {
      const raw = cleanText(element.textContent);
      const explicitChoice = element.dataset.voteChoice ? parseChoice(element.dataset.voteChoice) : null;
      const labelled = raw.match(/^(yes|yeas?|ayes?|for|in favou?r|no|nays?|against|opposed|abstain(?:ed)?|absent|conflict)\s*[:\-]\s*(.+)$/i);
      const choice = explicitChoice ?? (labelled ? parseChoice(labelled[1]) : null);
      const names = element.dataset.councillor
        ? [element.dataset.councillor]
        : labelled ? splitNames(labelled[2]) : [];
      if (choice) names.forEach(name => add(name, choice, raw));
    }
  }
  return votes;
}

function parseAttendance(document: Document): CouncilAttendance[] {
  const results: CouncilAttendance[] = [];
  const seen = new Set<string>();
  const sections: Array<[string, CouncilAttendanceStatus]> = [
    ['[data-attendance-status="present"], .attendance-present, .present-members', 'present'],
    ['[data-attendance-status="absent"], .attendance-absent, .absent-members', 'absent'],
    ['[data-attendance-status="regrets"], .attendance-regrets, .regrets', 'regrets'],
    ['[data-attendance-status="conflict"], .attendance-conflict, .conflicts', 'conflict'],
  ];
  for (const [selector, status] of sections) {
    for (const section of document.querySelectorAll<HTMLElement>(selector)) {
      const elements = section.matches('[data-member-name]') ? [section] : [...section.querySelectorAll<HTMLElement>('[data-member-name], li')];
      const names = elements.length > 0
        ? elements.map(element => element.dataset.memberName ?? element.textContent ?? '')
        : splitNames(section.textContent ?? '');
      for (const rawName of names) {
        const name = cleanText(rawName).replace(/^(councillor|mayor)\s+/i, '');
        const key = normalizedLabel(name);
        if (!name || seen.has(key)) continue;
        seen.add(key);
        results.push({ name, status });
      }
    }
  }
  return results;
}

function parseMotions(itemElement: HTMLElement, itemId: string): CouncilMotion[] {
  const motionElements = [...itemElement.querySelectorAll<HTMLElement>('[data-motion-id], .motion, .resolution')];
  return motionElements.map((element, index) => {
    const number = cleanText(element.dataset.motionNumber ?? firstText(element, ['.motion-number', '.resolution-number'])) || undefined;
    const text = firstText(element, ['[data-motion-text]', '.motion-text', '.resolution-text', '.recommendation']) || cleanText(element.textContent);
    const mover = cleanText(element.dataset.mover ?? fieldValue(element, ['moved by', 'mover'])) || undefined;
    const seconder = cleanText(element.dataset.seconder ?? fieldValue(element, ['seconded by', 'seconder'])) || undefined;
    const id = cleanText(element.dataset.motionId) || `${itemId}-motion-${index + 1}`;
    return {
      id,
      itemId,
      number,
      text,
      mover,
      seconder,
      outcome: parseOutcome(element.dataset.outcome ?? firstText(element, ['.motion-result', '.result', '.outcome']) ?? text),
      votes: parseRecordedVotes(element),
      isAmendment: element.matches('[data-amendment="true"], .amendment') || /\bamendment\b/i.test(number ?? ''),
      parentMotionId: cleanText(element.dataset.parentMotionId) || undefined,
    };
  });
}

export function parseEScribeMeetingHtml(html: string, metadata: EScribeMeetingMetadata): CouncilParseResult {
  const sourceValidation = validateCouncilSourceUrl(metadata.sourceUrl);
  if (!sourceValidation.ok) {
    const reason = 'reason' in sourceValidation ? sourceValidation.reason : 'Council source URL is invalid.';
    throw new Error(reason);
  }
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser is required to parse eScribe HTML.');
  const document = new DOMParser().parseFromString(html, 'text/html');
  const warnings: string[] = [];
  const title = cleanText(metadata.title) || firstText(document, ['h1', '.meeting-title', '[data-meeting-title]']);
  const committee = cleanText(metadata.committee) || firstText(document, ['.committee-name', '[data-committee]']) || title;
  const startsAtRaw = cleanText(metadata.startsAt)
    || document.querySelector('time')?.getAttribute('datetime')
    || firstText(document, ['.meeting-date', '[data-meeting-date]']);
  const parsedStartsAt = new Date(startsAtRaw);
  if (!startsAtRaw || Number.isNaN(parsedStartsAt.getTime())) throw new Error('Meeting metadata must include a valid startsAt value.');

  const itemElements = [...document.querySelectorAll<HTMLElement>('[data-agenda-item-id], .agenda-item, article.agenda-item')];
  const items: CouncilItem[] = itemElements.map((element, index): CouncilItem => {
    const id = cleanText(element.dataset.agendaItemId ?? element.id) || `${metadata.meetingId}-item-${index + 1}`;
    const number = cleanText(element.dataset.itemNumber ?? firstText(element, ['.item-number', '.agenda-number'])) || undefined;
    const itemTitle = firstText(element, ['.item-title', 'h2', 'h3', '[data-item-title]']) || `Item ${number ?? index + 1}`;
    const bodyText = firstText(element, ['.item-body', '.description', '.agenda-item-body']) || cleanText(element.textContent);
    const transit = classifyTransitRelevance(`${itemTitle} ${bodyText}`);
    return {
      id,
      meetingId: metadata.meetingId,
      sourceId: cleanText(element.dataset.sourceId) || undefined,
      number,
      title: itemTitle,
      bodyText,
      wards: [...new Set((`${itemTitle} ${bodyText}`.match(/\bward\s+\d+\b/gi) ?? []).map(value => value.replace(/\s+/g, ' ')))],
      transitTopics: transit.topics,
      transitRelevanceScore: transit.score,
      motions: parseMotions(element, id),
      documents: [],
    };
  });
  const motions = items.flatMap(item => item.motions);
  if (itemElements.length === 0) warnings.push('No agenda items were found in the meeting HTML.');
  if (!title) warnings.push('Meeting title was not found.');

  const evidence: CouncilEvidence[] = motions.flatMap(motion => motion.votes.map((vote, index) => ({
    id: `${motion.id}-vote-${index + 1}`,
    meetingId: metadata.meetingId,
    itemId: motion.itemId,
    motionId: motion.id,
    type: 'named_vote' as const,
    text: `${vote.councillorName}: ${vote.choice}`,
    sourceUrl: sourceValidation.parsedUrl.toString(),
    occurredAt: parsedStartsAt.toISOString(),
  })));
  const itemByElement = new Map(itemElements.map((element, index) => [element, items[index]]));
  const actions = itemElements.flatMap((itemElement) => {
    const item = itemByElement.get(itemElement)!;
    return [...itemElement.querySelectorAll<HTMLElement>('[data-council-action], .staff-direction')].map((element, index) => {
      const id = cleanText(element.dataset.actionId) || `${item.id}-action-${index + 1}`;
      const description = cleanText(element.dataset.description) || cleanText(element.textContent);
      const evidenceId = `${id}-evidence`;
      evidence.push({
        id: evidenceId,
        meetingId: metadata.meetingId,
        itemId: item.id,
        type: 'document',
        text: description,
        sourceUrl: sourceValidation.parsedUrl.toString(),
        occurredAt: parsedStartsAt.toISOString(),
      });
      return {
        id,
        meetingId: metadata.meetingId,
        itemId: item.id,
        description,
        assignedTo: cleanText(element.dataset.assignedTo) || undefined,
        deadline: cleanText(element.dataset.deadline) || undefined,
        status: 'open' as const,
        evidenceId,
      };
    });
  });
  const fundingCommitments = itemElements.flatMap((itemElement) => {
    const item = itemByElement.get(itemElement)!;
    return [...itemElement.querySelectorAll<HTMLElement>('[data-funding-commitment], .funding-commitment')].map((element, index) => {
      const id = cleanText(element.dataset.fundingId) || `${item.id}-funding-${index + 1}`;
      const description = cleanText(element.dataset.description) || cleanText(element.textContent);
      const rawAmount = cleanText(element.dataset.amount);
      const parsedAmount = rawAmount ? Number(rawAmount.replace(/[$,\s]/g, '')) : Number.NaN;
      const evidenceId = `${id}-evidence`;
      evidence.push({
        id: evidenceId,
        meetingId: metadata.meetingId,
        itemId: item.id,
        type: 'document',
        text: description,
        sourceUrl: sourceValidation.parsedUrl.toString(),
        occurredAt: parsedStartsAt.toISOString(),
      });
      return {
        id,
        meetingId: metadata.meetingId,
        itemId: item.id,
        description,
        amount: Number.isFinite(parsedAmount) ? parsedAmount : undefined,
        currency: 'CAD' as const,
        fundingSource: cleanText(element.dataset.fundingSource) || undefined,
        evidenceId,
      };
    });
  });

  return {
    meeting: {
      id: metadata.meetingId,
      termId: metadata.termId,
      sourceId: metadata.sourceId,
      title: title || 'Untitled meeting',
      committee,
      startsAt: parsedStartsAt.toISOString(),
      location: firstText(document, ['.meeting-location', '[data-meeting-location]']) || undefined,
      status: metadata.status ?? 'completed',
      sourceUrl: sourceValidation.parsedUrl.toString(),
      videoUrl: document.querySelector<HTMLAnchorElement>('a[href*="youtube.com"], a[href*="youtu.be"]')?.href,
      attendance: parseAttendance(document),
      itemIds: items.map(item => item.id),
      documents: [],
      extractionStatus: warnings.length > 0 ? 'partial' : 'extracted',
      contentHash: metadata.contentHash,
    },
    items,
    motions,
    evidence,
    actions,
    fundingCommitments,
    warnings,
  };
}
