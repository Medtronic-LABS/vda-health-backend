export type FollowUpDateSource = 'EXPLICIT' | 'DERIVED_30_DAY';
export type FollowUpStatus = 'DUE_TODAY' | 'DUE_TOMORROW' | 'UPCOMING' | 'ATTENDANCE_CHECK';
export type FollowUpAttendanceStatus = 'PENDING' | 'COMPLETED' | 'MISSED';

/** A patient-facing, date-driven clinical follow-up. This is not medication adherence. */
export interface ClinicalFollowUp {
  id: string;
  type: 'CLINICAL_REVIEW' | 'MEDICATION_REVIEW' | 'LAB_REVIEW' | 'CHECKUP';
  title: string;
  dueDate: string;
  daysUntil: number;
  status: FollowUpStatus;
  dateSource: FollowUpDateSource;
  attendanceStatus: FollowUpAttendanceStatus;
  requiresAttendanceCheck: boolean;
  condition?: string;
  guidance?: string;
}

export interface FollowUpListResponse {
  asOfDate: string;
  timezone: string;
  followUps: ClinicalFollowUp[];
}

export interface FollowUpAttendanceResponse {
  followUpId: string;
  attendanceStatus: 'COMPLETED' | 'MISSED';
  message: string;
}
