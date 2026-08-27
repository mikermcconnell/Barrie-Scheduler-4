import {
    STRATEGIC_WORKPLAN_SCHEMA_VERSION,
    type StrategicWorkplanDocument,
    type StrategicWorkplanOwnership,
    type StrategicWorkplanSegment,
    type StrategicWorkplanSegmentType,
    type StrategicWorkplanTask,
} from './workplanTypes';

// The source is week-precision, so the requested one-month project-control
// adjustment is represented as four complete schedule weeks.
const BASELINE_START = '2026-08-03';
const BASELINE_END = '2027-09-27';

const DEPENDENCIES_BY_WBS: Readonly<Record<string, readonly string[]>> = {
    '1.02': ['1.01'],
    '1.03': ['1.01'],
    '1.04': ['1.01'],
    '2.01': ['1.01'],
    '2.02': ['2.01'],
    '2.03': ['2.01'],
    '2.04': ['2.01'],
    '2.05': ['2.01'],
    '2.06': ['2.01'],
    '2.07': ['2.01'],
    '2.08': ['2.01'],
    '2.09': ['2.03', '2.04', '2.05', '2.06', '2.07'],
    '2.10': ['2.01'],
    '3.03': ['3.01', '3.02'],
    '3.07': ['3.04', '3.05', '3.06'],
    '3.13': ['3.08', '3.09', '3.10', '3.11', '3.12'],
    '3.18': ['3.14', '3.15', '3.16', '3.17'],
    '3.25': ['3.19', '3.20', '3.21', '3.22', '3.23', '3.24'],
    '3.29': ['3.26', '3.27', '3.28'],
    '3.33': ['3.30', '3.31', '3.32'],
    '3.40': ['3.34', '3.35', '3.36', '3.37', '3.38', '3.39'],
    '3.44': ['3.41', '3.42', '3.43'],
    '3.51': ['3.45', '3.46', '3.47', '3.48', '3.49', '3.50'],
    '3.54': ['3.52', '3.53'],
    '4.01': ['2.09', '3.03', '3.07', '3.13', '3.18', '3.25', '3.29', '3.33', '3.40', '3.44', '3.51', '3.54'],
    '4.02': ['4.01'],
    '4.03': ['4.02'],
};

type BaselineRow = readonly [
    wbs: string,
    title: string,
    ownership: StrategicWorkplanOwnership,
    segmentSpec: string,
];

interface BaselineGroup {
    phaseId: string;
    phaseName: string;
    chapter: string | null;
    rows: readonly BaselineRow[];
}

const GROUPS: readonly BaselineGroup[] = [
    {
        phaseId: 'phase-1',
        phaseName: 'Project Initiation and Data Collection',
        chapter: null,
        rows: [
            ['1.01', 'Project Initiation Meeting', 'Consultant', 'PI@0'],
            ['1.02', 'Update Project Schedule and Work Plan', 'Consultant', 'T@0-1,DD@2,FD@4'],
            ['1.03', 'Data Request', 'Consultant', 'DD@1,FD@3'],
            ['1.04', 'Report Table of Contents', 'Consultant', 'T@1,DD@2,FD@4'],
            ['1.05', 'Project Check-ins', 'Consultant', ''],
            ['1.06', 'Project Management and Quality Review', 'Consultant', 'PT@5,PT@10,PT@14,PT@18,PT@22,PT@27,PT@31,PT@35,PT@40,PT@44,PT@48,PT@53,PT@57'],
        ],
    },
    {
        phaseId: 'phase-2',
        phaseName: 'Stakeholder Engagement',
        chapter: null,
        rows: [
            ['2.01', 'Develop Engagement Plan', 'Consultant', 'T@1-2,DD@3,R@4-5,FD@6'],
            ['2.02', 'Project Team Engagement', 'Consultant', 'T@17,W1@18,T@19-21,W4@22,T@23-24,T@26-27,W2@28,T@29,W3@30,T@31-33,W5@34,T@35,W6@36,T@37,T@43,W7@44'],
            ['2.03', 'Internal Stakeholder Engagement', 'Joint', 'T@7-9,E@10,T@26,E@27'],
            ['2.04', 'External Stakeholder Engagement', 'Joint', 'T@7-11'],
            ['2.05', 'Round 1 Public Open House', 'Joint', 'T@9-10,E@11,T@12'],
            ['2.06', 'Community Survey', 'Joint', 'T@9-13'],
            ['2.07', 'Seniors/Youth Engagement', 'Joint', 'T@8-9,E@10,T@11'],
            ['2.08', 'Round 1 Councillor Working Session', 'Consultant', 'T@26,C@27'],
            ['2.09', 'Round 1 Engagement Reporting', 'Consultant', 'T@12-13,DD@14,R@15-16,FD@17,R@27-29,FD@30'],
            ['2.10', 'Provisional Item - Round 2 Public Open House', 'Joint', 'T@33-34,E@35'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 1 - Current State Assessment',
        rows: [
            ['3.01', 'Current State Advisory', 'Staff', 'T@2-4'],
            ['3.02', 'Identify Regional Service Gaps', 'Joint', 'T@3-5'],
            ['3.03', 'Documentation', 'Joint', 'T@4-5,DD@6,R@7-8,FD@9'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 2 - Peer Benchmarking',
        rows: [
            ['3.04', 'Benchmark Review', 'Consultant', 'T@4-5'],
            ['3.05', 'Frequency Review', 'Consultant', 'T@4-5'],
            ['3.06', 'Best Practices Survey and Interviews', 'Consultant', 'T@4-7'],
            ['3.07', 'Documentation', 'Consultant', 'T@6-7,DD@8,R@9-10,FD@11'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 3 - Growth Context',
        rows: [
            ['3.08', 'Document Growth', 'Staff', 'T@5-6'],
            ['3.09', 'Transportation Master Plan Meeting', 'Joint', 'T@6-7'],
            ['3.10', 'Review Funding Programs', 'Consultant', 'T@7-8'],
            ['3.11', 'Review Legislation and Regulatory Environments', 'Consultant', 'T@8-9'],
            ['3.12', 'MTO Policies and Programs Review', 'Consultant', 'T@8-9'],
            ['3.13', 'Documentation', 'Consultant', 'T@9-10,DD@11,R@12-13,FD@14'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 4 - Strategic Vision and Targets',
        rows: [
            ['3.14', 'Vision and Values', 'Joint', 'T@16-17,W1@18,T@19'],
            ['3.15', 'Ridership and Usefulness Targets', 'Joint', 'T@16-17,W1@18,T@19-20'],
            ['3.16', 'Service Performance Targets', 'Staff', 'T@16-19'],
            ['3.17', 'Regional Connectivity Targets', 'Joint', 'T@16-17,W1@18,T@19-20'],
            ['3.18', 'Documentation', 'Consultant', 'T@18-20,DD@21,R@22-23,FD@24'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 5 - Transit Service Plan 2027-2032',
        rows: [
            ['3.19', 'Network Evolution', 'Joint', 'T@24,T@26-27,W2@28'],
            ['3.20', 'Transit Service Standards', 'Joint', 'T@26-27,W2@28,T@29'],
            ['3.21', '2032 Transit Plan', 'Joint', 'T@26-27,W2@28,T@29-30'],
            ['3.22', 'Transit Infrastructure', 'Joint', 'T@29,W3@30,T@31'],
            ['3.23', 'Phasing Plan', 'Joint', 'T@29,W3@30,T@31'],
            ['3.24', 'Transit Priority', 'Joint', 'T@29,W3@30,T@31'],
            ['3.25', 'Documentation', 'Consultant', 'T@31,DD@32,R@33-34,FD@35'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 6 - Fare Strategy and Regional Integration',
        rows: [
            ['3.26', 'Fare Structure', 'Consultant', 'T@19-21,W4@22,T@23-24'],
            ['3.27', 'Fare Programs and Partnerships', 'Joint', 'T@19-21,W4@22,T@23-24'],
            ['3.28', 'Fare Technology', 'Joint', 'T@19-21,W4@22,T@23-24'],
            ['3.29', 'Documentation', 'Consultant', 'T@23-24,T@26,DD@27,R@28-29,FD@30'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 7 - Marketing and Communications',
        rows: [
            ['3.30', 'Assess Current Strategies', 'Staff', 'T@32-33,W5@34,T@35-36'],
            ['3.31', 'Marketing Targets and Strategies', 'Joint', 'T@32-33,W5@34,T@35-36'],
            ['3.32', 'Customer Communications', 'Joint', 'T@32-33,W5@34,T@35-36'],
            ['3.33', 'Documentation', 'Consultant', 'T@34-35,DD@36,R@37-38,FD@39'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 8 - Fleet, Infrastructure and Technology Planning',
        rows: [
            ['3.34', 'Fleet Plan', 'Staff', ''],
            ['3.35', 'Fleet Propulsion', 'Consultant', 'T@34-35'],
            ['3.36', 'Facilities Plan', 'Joint', 'T@34-35'],
            ['3.37', 'Coordination of Terminals', 'Joint', 'T@34-35'],
            ['3.38', 'Technology Working Session', 'Joint', 'T@34-35,W6@36,T@37'],
            ['3.39', 'Emerging Technologies and AI', 'Staff', 'T@36-37'],
            ['3.40', 'Documentation', 'Consultant', 'T@36-37,DD@38,R@39-40,FD@41'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 9 - Official Plan and Transportation Master Plan Alignment',
        rows: [
            ['3.41', 'Map Strategic Plan Elements', 'Staff', 'T@36-37'],
            ['3.42', 'Gap Assessment', 'Consultant', 'T@37-39'],
            ['3.43', 'Bus Rapid Transit', 'Joint', 'T@38-39'],
            ['3.44', 'Documentation', 'Consultant', 'T@38-39,DD@40,R@41-42,FD@43'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 10 - Financial Plan',
        rows: [
            ['3.45', 'Operating Budget', 'Staff', 'T@42-44'],
            ['3.46', 'Staffing Level and Organization Structure Analysis', 'Joint', 'T@43'],
            ['3.47', 'Capital Budget', 'Staff', 'T@43-44'],
            ['3.48', 'Revenue Strategy', 'Joint', 'T@43,W7@44,T@45'],
            ['3.49', 'Development Charge', 'Staff', 'T@44-45'],
            ['3.50', 'Financial Sustainability', 'Staff', 'T@44-45'],
            ['3.51', 'Documentation', 'Consultant', 'T@44-45,DD@46,R@47-48,FD@49'],
        ],
    },
    {
        phaseId: 'phase-3',
        phaseName: 'Strategic Plan Development',
        chapter: 'Chapter 11 - Implementation Plan',
        rows: [
            ['3.52', 'Implementation Plan', 'Joint', 'T@43,W7@44,T@45'],
            ['3.53', 'Definitions of Success', 'Joint', 'T@43,W7@44,T@45'],
            ['3.54', 'Documentation', 'Consultant', 'T@44-45,DD@46,R@47-48,FD@49'],
        ],
    },
    {
        phaseId: 'phase-4',
        phaseName: 'Report Production and Finalization',
        chapter: null,
        rows: [
            ['4.01', 'Draft Strategic Plan', 'Consultant', 'T@50-51,DD@52,R@53-55,FD@56'],
            ['4.02', 'Final Council Presentation', 'Joint', 'T@56-57,C@58'],
            ['4.03', 'Delivery of Final Strategic Plan', 'Consultant', 'R@58-59,FD@60'],
        ],
    },
];

function parseIsoDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
}

export function addStrategicWorkplanDays(value: string, days: number): string {
    const date = parseIsoDate(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function weekDate(index: number): string {
    return addStrategicWorkplanDays(BASELINE_START, index * 7);
}

function segmentType(code: string): StrategicWorkplanSegmentType {
    if (code === 'T') return 'task';
    if (code === 'DD') return 'draft-deliverable';
    if (code === 'R') return 'review';
    if (code === 'FD') return 'final-deliverable';
    if (code === 'PI') return 'project-initiation';
    if (code === 'PT') return 'project-team-meeting';
    if (code.startsWith('W')) return 'working-session';
    if (code === 'C') return 'council-presentation';
    return 'engagement-event';
}

function segmentLabel(code: string): string {
    if (code === 'T') return 'Task';
    if (code === 'DD') return 'Draft deliverable';
    if (code === 'R') return 'City review';
    if (code === 'FD') return 'Final deliverable';
    if (code === 'PI') return 'Project initiation meeting';
    if (code === 'PT') return 'Project team lead meeting';
    if (code.startsWith('W')) return `Working session ${code.slice(1)}`;
    if (code === 'C') return 'Council presentation';
    return 'Engagement event';
}

function parseSegments(wbs: string, spec: string): StrategicWorkplanSegment[] {
    if (!spec.trim()) return [];

    return spec.split(',').map((token, index) => {
        const [code, range] = token.split('@');
        const [startText, endText = startText] = range.split('-');
        const startIndex = Number(startText);
        const endIndex = Number(endText);
        const type = segmentType(code);
        const milestone = type !== 'task' && type !== 'review';

        return {
            id: `${wbs.replace('.', '-')}-segment-${index + 1}`,
            type,
            label: segmentLabel(code),
            startDate: weekDate(startIndex),
            endDate: milestone ? weekDate(endIndex) : addStrategicWorkplanDays(weekDate(endIndex), 6),
            datePrecision: 'week',
        };
    });
}

function buildTask(group: BaselineGroup, row: BaselineRow): StrategicWorkplanTask {
    const [wbs, title, ownership, spec] = row;
    const segments = parseSegments(wbs, spec);
    const sortedStarts = segments.map(segment => segment.startDate).sort();
    const sortedEnds = segments.map(segment => segment.endDate).sort();

    return {
        id: `dillon-${wbs.replace('.', '-')}`,
        wbs,
        phaseId: group.phaseId,
        phaseName: group.phaseName,
        chapter: group.chapter,
        title,
        ownership,
        startDate: sortedStarts[0] ?? null,
        endDate: sortedEnds.at(-1) ?? null,
        status: 'unconfirmed',
        progress: 0,
        dependencies: [...(DEPENDENCIES_BY_WBS[wbs] ?? [])],
        notes: '',
        segments,
    };
}

export function createStrategicWorkplanBaseline(teamId: string, userId: string): StrategicWorkplanDocument {
    const now = new Date().toISOString();
    return {
        schemaVersion: STRATEGIC_WORKPLAN_SCHEMA_VERSION,
        teamId,
        revision: 0,
        name: 'Barrie Transit Strategic Plan - Project Work Plan',
        scheduleStart: BASELINE_START,
        scheduleEnd: BASELINE_END,
        source: {
            title: 'Barrie Transit Strategic Plan - Work Plan and Schedule',
            organization: 'Dillon Consulting Limited',
            proposalDate: '2026-06-16',
            fileName: '06-F.5.WorkPlanandSchedule.pdf',
            schedulePages: 'PDF pages 6-7 (proposal pages 5-5 to 5-6)',
            importedAt: '2026-08-27',
            datePrecision: 'week',
            note: 'Task and milestone relationships were transcribed from the proposal Gantt, then all dated work was shifted four schedule weeks later for project control. Dependencies are planning assumptions inferred from the work-plan sequence and require project-team confirmation. Current status and progress also require confirmation.',
        },
        tasks: GROUPS.flatMap(group => group.rows.map(row => buildTask(group, row))),
        createdAt: now,
        createdBy: userId,
        updatedAt: now,
        updatedBy: userId,
    };
}

export function cloneStrategicWorkplan(workplan: StrategicWorkplanDocument): StrategicWorkplanDocument {
    return structuredClone(workplan);
}

export const STRATEGIC_WORKPLAN_BASELINE_RANGE = {
    start: BASELINE_START,
    end: BASELINE_END,
} as const;
