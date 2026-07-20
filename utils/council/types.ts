export const COUNCIL_INTELLIGENCE_SCHEMA_VERSION = 1;

export type CouncilExtractionStatus =
  | 'pending'
  | 'extracted'
  | 'partial'
  | 'review_required'
  | 'failed';

export type CouncilDocumentType =
  | 'agenda'
  | 'minutes'
  | 'report'
  | 'attachment'
  | 'circulation'
  | 'action_summary'
  | 'video'
  | 'other';

export type CouncilMeetingStatus = 'scheduled' | 'completed' | 'cancelled' | 'unknown';
export type CouncilAttendanceStatus = 'present' | 'absent' | 'regrets' | 'conflict' | 'unknown';
export type CouncilMotionOutcome = 'carried' | 'defeated' | 'withdrawn' | 'referred' | 'tabled' | 'unknown';
export type CouncilVoteChoice = 'yes' | 'no' | 'abstain' | 'absent' | 'conflict';
export type CouncilEvidenceType =
  | 'named_vote'
  | 'motion'
  | 'amendment'
  | 'attributed_statement'
  | 'deputation'
  | 'document'
  | 'attendance';
export type CouncilConfidence = 'high' | 'medium' | 'low';
export type CouncilPosition = 'supportive' | 'conditional' | 'opposed' | 'mixed' | 'unclear' | 'no_evidence';
export type CouncilActionStatus = 'open' | 'completed' | 'overdue' | 'cancelled' | 'unknown';

export interface CouncilSourceDocument {
  id: string;
  type: CouncilDocumentType;
  title: string;
  sourceUrl: string;
  retrievedAt?: string;
  contentHash?: string;
  contentType?: string;
  extractionStatus: CouncilExtractionStatus;
  extractionMessage?: string;
}

export interface CouncilTerm {
  id: string;
  label: string;
  startsOn: string;
  endsOn?: string;
  isCurrent: boolean;
}

export interface Councillor {
  id: string;
  termId: string;
  name: string;
  normalizedName: string;
  role?: string;
  ward?: string;
  committees: string[];
  activeFrom?: string;
  activeTo?: string;
}

export interface CouncilAttendance {
  councillorId?: string;
  name: string;
  status: CouncilAttendanceStatus;
  note?: string;
}

export interface CouncilVote {
  councillorId?: string;
  councillorName: string;
  choice: CouncilVoteChoice;
  isRecorded: true;
  sourceText?: string;
}

export interface CouncilMotion {
  id: string;
  itemId: string;
  number?: string;
  text: string;
  mover?: string;
  seconder?: string;
  outcome: CouncilMotionOutcome;
  votes: CouncilVote[];
  isAmendment: boolean;
  parentMotionId?: string;
}

export interface CouncilItem {
  id: string;
  meetingId: string;
  sourceId?: string;
  number?: string;
  title: string;
  bodyText: string;
  wards: string[];
  transitTopics: CouncilTransitTopic[];
  transitRelevanceScore: number;
  motions: CouncilMotion[];
  documents: CouncilSourceDocument[];
}

export interface CouncilMeeting {
  id: string;
  termId?: string;
  sourceId?: string;
  title: string;
  committee: string;
  startsAt: string;
  location?: string;
  status: CouncilMeetingStatus;
  sourceUrl: string;
  videoUrl?: string;
  attendance: CouncilAttendance[];
  itemIds: string[];
  documents: CouncilSourceDocument[];
  extractionStatus: CouncilExtractionStatus;
  contentHash?: string;
}

export interface CouncilEvidence {
  id: string;
  meetingId: string;
  itemId?: string;
  motionId?: string;
  councillorId?: string;
  type: CouncilEvidenceType;
  text: string;
  sourceUrl: string;
  sourceDocumentId?: string;
  sourceChunkId?: string;
  occurredAt: string;
}

export interface CouncilPositionSummary {
  id: string;
  councillorId: string;
  topic: CouncilTransitTopic;
  position: CouncilPosition;
  confidence: CouncilConfidence;
  evidenceIds: string[];
  isProvisional: true;
  generatedAt: string;
}

export interface CouncilAction {
  id: string;
  meetingId: string;
  itemId: string;
  description: string;
  assignedTo?: string;
  deadline?: string;
  status: CouncilActionStatus;
  evidenceId: string;
}

export interface CouncilFundingCommitment {
  id: string;
  meetingId: string;
  itemId: string;
  description: string;
  amount?: number;
  currency?: 'CAD';
  fundingSource?: string;
  evidenceId: string;
}

export interface CouncilParseResult {
  meeting: CouncilMeeting;
  items: CouncilItem[];
  motions: CouncilMotion[];
  evidence: CouncilEvidence[];
  actions: CouncilAction[];
  fundingCommitments: CouncilFundingCommitment[];
  warnings: string[];
}

export type CouncilTransitTopic =
  | 'service_levels'
  | 'routes'
  | 'transit_on_demand'
  | 'fares'
  | 'accessibility'
  | 'terminals'
  | 'fleet'
  | 'capital'
  | 'student_senior_programs'
  | 'parking_integration'
  | 'active_transportation'
  | 'development_impacts'
  | 'special_event_service';
