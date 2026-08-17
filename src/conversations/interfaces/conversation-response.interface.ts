import { ApiProperty } from '@nestjs/swagger';

export enum VdaResponseType {
  TEXT = 'text',
  ACTION = 'action',
  EDUCATION = 'education',
  SCHEME = 'scheme',
  FACILITY = 'facility',
  ESCALATION = 'escalation',
  TELECONSULTATION = 'teleconsultation',
  REMINDER = 'reminder',
  MEDICATION = 'medication',
  TREND_VITAL = 'trend_vital',
}

export interface ITextContent {
  en: string;
  hi?: string;
}

export interface IActionContent {
  action_type: string;
  parameters: Record<string, any>;
}

export interface IEducationContent {
  topic: string;
  url: string;
  summary: string;
}

export interface ISchemeContent {
  scheme_name: string;
  eligible: boolean;
  details?: string;
}

export interface IFacilityContent {
  facility_name: string;
  address: string;
  distance_km?: number;
}

export interface IEscalationContent {
  escalation_id: string;
  reason: string;
  assigned_role: string;
}

export interface ITeleconsultationContent {
  provider_name: string;
  specialty: string;
  slot_time?: string;
}

export interface IReminderContent {
  title: string;
  due_at: string;
}

export interface IMedicationContent {
  drug_name: string;
  dosage: string;
  frequency: string;
}

export interface ITrendVitalContent {
  vital_name: string;
  value: string;
  trend?: 'up' | 'down' | 'stable';
}

export class TurnResponseDto {
  @ApiProperty({
    example: 1,
    description: 'The turn count inside this session',
  })
  turn_number!: number;

  @ApiProperty({
    example: 'a9b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    description: 'The VDA internal session UUID',
  })
  session_id!: string;

  @ApiProperty({
    enum: VdaResponseType,
    example: 'text',
    description: 'The response type',
  })
  response_type!: string;

  @ApiProperty({
    description: 'The response content payload depending on response_type',
    example: {
      en: 'Conversation processing is available in the prototype.',
      hi: 'प्रोटोटाइप में बातचीत की प्रक्रिया उपलब्ध है।',
    },
  })
  content!: Record<string, any>;

  @ApiProperty({
    example: 'vda-12345-67890',
    description: 'The correlation trace ID',
  })
  correlation_id!: string;

  @ApiProperty({ example: 'SAFE', description: 'Clinical safety status' })
  safety_status!: string;

  @ApiProperty({
    example: 'prototype-intent',
    description: 'Resolved query intent',
  })
  intent!: string | null;

  @ApiProperty({
    example: 'prototype-agent',
    description: 'Selected routing agent identifier',
  })
  selected_agent!: string | null;

  @ApiProperty({
    example: 250,
    description: 'Processing latency in milliseconds',
  })
  latency!: number;

  @ApiProperty({
    example: '2026-08-17T12:00:00.000Z',
    description: 'UTC timestamp of turn creation',
  })
  created_at!: string;
}
