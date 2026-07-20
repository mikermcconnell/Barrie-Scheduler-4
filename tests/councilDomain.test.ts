import { describe, expect, it } from 'vitest';
import {
  classifyTransitRelevance,
  filterMeetingsInCouncilPilotWindow,
  getCouncilPilotWindow,
  parseEScribeMeetingHtml,
  validateCouncilSourceUrl,
} from '../utils/council';

const SOURCE_URL = 'https://pub-barrie.escribemeetings.com/Meeting.aspx?Id=meeting-1';

describe('council source validation', () => {
  it('allows only HTTPS Barrie and eScribe source hosts', () => {
    expect(validateCouncilSourceUrl(SOURCE_URL).ok).toBe(true);
    expect(validateCouncilSourceUrl('https://www.barrie.ca/government-news/meetings').ok).toBe(true);
    expect(validateCouncilSourceUrl('http://pub-barrie.escribemeetings.com/Meeting.aspx').ok).toBe(false);
    expect(validateCouncilSourceUrl('https://pub-barrie.escribemeetings.com.evil.example/Meeting.aspx').ok).toBe(false);
    expect(validateCouncilSourceUrl('https://evil.example/?next=https://www.barrie.ca').ok).toBe(false);
  });
});

describe('council pilot window', () => {
  it('includes the exact 90-day cutoff and excludes older meetings', () => {
    const window = getCouncilPilotWindow('2026-07-20T16:00:00.000Z');
    expect(window.startsAt).toBe('2026-04-21T16:00:00.000Z');

    const meetings = [
      { id: 'at-cutoff', startsAt: '2026-04-21T16:00:00.000Z' },
      { id: 'too-old', startsAt: '2026-04-21T15:59:59.999Z' },
      { id: 'deployment', startsAt: '2026-07-20T16:00:00.000Z' },
      { id: 'future', startsAt: '2026-07-20T16:00:00.001Z' },
    ];

    expect(filterMeetingsInCouncilPilotWindow(meetings, window).map(meeting => meeting.id))
      .toEqual(['at-cutoff', 'deployment']);
  });
});

describe('council transit taxonomy', () => {
  it('classifies transit topics without treating unrelated city business as transit', () => {
    const relevant = classifyTransitRelevance(
      'Barrie Transit proposes a route extension, fare integration, and three electric buses.',
    );
    expect(relevant.isTransitRelevant).toBe(true);
    expect(relevant.topics).toEqual(expect.arrayContaining(['routes', 'fares', 'fleet']));
    expect(relevant.score).toBeGreaterThan(0);

    expect(classifyTransitRelevance('Approval of the annual horticultural awards.')).toMatchObject({
      isTransitRelevant: false,
      score: 0,
      topics: [],
    });
  });
});

describe('eScribe meeting parser', () => {
  it('extracts named recorded votes while keeping movers and seconders distinct', () => {
    const html = `
      <main>
        <h1>General Committee</h1>
        <time datetime="2026-07-15T18:00:00-04:00"></time>
        <div class="meeting-location">Council Chamber</div>
        <section class="attendance-present">
          <ul><li>Councillor Aylwin</li><li>Mayor Nuttall</li></ul>
        </section>
        <article class="agenda-item" data-agenda-item-id="item-7" data-item-number="7.2">
          <h2 class="item-title">Transit Route and Fare Changes</h2>
          <div class="item-body">A route extension affecting Ward 3 and transit fare integration.</div>
          <p class="staff-direction" data-action-id="action-1" data-assigned-to="Transit staff" data-deadline="2026-09-01">Report back on route performance.</p>
          <p class="funding-commitment" data-funding-id="funding-1" data-amount="$1,250,000" data-funding-source="Capital reserve">Fund three electric buses.</p>
          <section class="motion" data-motion-id="motion-7" data-motion-number="C-77-26" data-outcome="Carried">
            <p class="motion-text">That the transit route extension be approved.</p>
            <dl>
              <dt>Moved by</dt><dd>Councillor Thomson</dd>
              <dt>Seconded by</dt><dd>Councillor Kungl</dd>
            </dl>
            <div class="recorded-vote">
              <p>Yes: Councillor Aylwin, Mayor Nuttall</p>
              <p>No: Councillor Thomson</p>
              <p>Absent: Councillor Harvey</p>
            </div>
          </section>
        </article>
      </main>`;

    const result = parseEScribeMeetingHtml(html, { meetingId: 'meeting-1', sourceUrl: SOURCE_URL });
    const motion = result.motions[0];

    expect(result.meeting).toMatchObject({
      title: 'General Committee',
      committee: 'General Committee',
      location: 'Council Chamber',
      startsAt: '2026-07-15T22:00:00.000Z',
      extractionStatus: 'extracted',
    });
    expect(result.meeting.attendance).toEqual([
      { name: 'Aylwin', status: 'present' },
      { name: 'Nuttall', status: 'present' },
    ]);
    expect(result.items[0]).toMatchObject({
      id: 'item-7',
      wards: ['Ward 3'],
      transitTopics: expect.arrayContaining(['routes', 'fares']),
    });
    expect(motion).toMatchObject({
      mover: 'Councillor Thomson',
      seconder: 'Councillor Kungl',
      outcome: 'carried',
    });
    expect(motion.votes.map(vote => [vote.councillorName, vote.choice])).toEqual([
      ['Aylwin', 'yes'],
      ['Nuttall', 'yes'],
      ['Thomson', 'no'],
      ['Harvey', 'absent'],
    ]);
    expect(motion.votes.some(vote => vote.councillorName === 'Kungl')).toBe(false);
    expect(result.actions).toEqual([expect.objectContaining({
      id: 'action-1',
      assignedTo: 'Transit staff',
      deadline: '2026-09-01',
    })]);
    expect(result.fundingCommitments).toEqual([expect.objectContaining({
      id: 'funding-1',
      amount: 1_250_000,
      fundingSource: 'Capital reserve',
    })]);
    expect(result.evidence).toHaveLength(6);
  });

  it('does not invent individual votes from a generic Carried result', () => {
    const html = `
      <h1>City Council</h1>
      <article class="agenda-item" data-agenda-item-id="item-1">
        <h2>Bus Fleet Purchase</h2>
        <section class="motion" data-outcome="Carried">
          <p class="motion-text">That the bus fleet purchase be approved. Carried.</p>
          <dl><dt>Moved by</dt><dd>Councillor Harris</dd><dt>Seconded by</dt><dd>Councillor Morales</dd></dl>
        </section>
      </article>`;

    const result = parseEScribeMeetingHtml(html, {
      meetingId: 'meeting-2',
      sourceUrl: SOURCE_URL,
      startsAt: '2026-07-16T18:00:00-04:00',
    });

    expect(result.motions[0]).toMatchObject({ outcome: 'carried', votes: [] });
    expect(result.evidence).toEqual([]);
  });

  it('rejects unapproved source metadata before parsing', () => {
    expect(() => parseEScribeMeetingHtml('<h1>Meeting</h1>', {
      meetingId: 'meeting-3',
      sourceUrl: 'https://example.com/meeting',
      startsAt: '2026-07-16T18:00:00-04:00',
    })).toThrow('not approved');
  });
});
