import { Facility } from '../database/entities/facility.entity';

export const IPHS_SOURCE = 'IPHS 2022';
export const IPHS_OVERLAY_STATES = ['HARYANA', 'HIMACHAL_PRADESH'] as const;

export type IphsLevel =
  'HWC_SHC' | 'HWC_PHC' | 'CHC' | 'SDH' | 'DH' | 'UNKNOWN';
export type IphsClassification =
  | 'HWC_SHC'
  | 'UHWC'
  | 'HWC_PHC'
  | 'HWC_UPHC'
  | 'NON_FRU_CHC'
  | 'FRU_CHC'
  | 'CHC_NOT_SUBCLASSIFIED'
  | 'SDH'
  | 'DH'
  | 'UNKNOWN';
export type EmergencyCapability =
  'SOURCE_REPORTED_CAPABLE' | 'SOURCE_REPORTED_NOT_CAPABLE' | 'UNKNOWN';
export type ReferralLevel = 'PRIMARY' | 'SECONDARY' | 'DISTRICT' | 'UNKNOWN';

export interface IphsClassificationResult {
  iphsLevel: IphsLevel;
  iphsClassification: IphsClassification;
  referralLevel: ReferralLevel;
  emergencyCapability: EmergencyCapability;
  classificationBasis: string | null;
}

const normalize = (value?: string | null): string =>
  (value || '')
    .trim()
    .toUpperCase()
    .replace(/[._/]+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');

/** Maps only an explicit source facility type; facility names are not evidence. */
export function classifyIphsFacility(
  facility: Pick<Facility, 'hospitalType' | 'emergencyAvailable'>,
): IphsClassificationResult {
  const sourceType = normalize(facility.hospitalType);
  let iphsLevel: IphsLevel = 'UNKNOWN';
  let iphsClassification: IphsClassification = 'UNKNOWN';
  let referralLevel: ReferralLevel = 'UNKNOWN';

  if (
    ['HWC-SHC', 'SHC', 'SUB HEALTH CENTRE', 'SUB-HEALTH CENTRE'].includes(
      sourceType,
    )
  ) {
    iphsLevel = 'HWC_SHC';
    iphsClassification = 'HWC_SHC';
    referralLevel = 'PRIMARY';
  } else if (
    ['UHWC', 'URBAN HEALTH AND WELLNESS CENTRE'].includes(sourceType)
  ) {
    iphsLevel = 'HWC_SHC';
    iphsClassification = 'UHWC';
    referralLevel = 'PRIMARY';
  } else if (['HWC-PHC', 'PHC', 'PRIMARY HEALTH CENTRE'].includes(sourceType)) {
    iphsLevel = 'HWC_PHC';
    iphsClassification = 'HWC_PHC';
    referralLevel = 'PRIMARY';
  } else if (
    ['HWC-UPHC', 'UPHC', 'URBAN PRIMARY HEALTH CENTRE'].includes(sourceType)
  ) {
    iphsLevel = 'HWC_PHC';
    iphsClassification = 'HWC_UPHC';
    referralLevel = 'PRIMARY';
  } else if (
    ['FRU CHC', 'FRU-CHC', 'FRU UCHC', 'FRU-UCHC'].includes(sourceType)
  ) {
    iphsLevel = 'CHC';
    iphsClassification = 'FRU_CHC';
    referralLevel = 'SECONDARY';
  } else if (['NON-FRU CHC', 'NON FRU CHC'].includes(sourceType)) {
    iphsLevel = 'CHC';
    iphsClassification = 'NON_FRU_CHC';
    referralLevel = 'SECONDARY';
  } else if (['CHC', 'UCHC', 'COMMUNITY HEALTH CENTRE'].includes(sourceType)) {
    iphsLevel = 'CHC';
    iphsClassification = 'CHC_NOT_SUBCLASSIFIED';
    referralLevel = 'SECONDARY';
  } else if (
    ['SDH', 'SUB DISTRICT HOSPITAL', 'SUB-DISTRICT HOSPITAL'].includes(
      sourceType,
    )
  ) {
    iphsLevel = 'SDH';
    iphsClassification = 'SDH';
    referralLevel = 'SECONDARY';
  } else if (['DH', 'DISTRICT HOSPITAL'].includes(sourceType)) {
    iphsLevel = 'DH';
    iphsClassification = 'DH';
    referralLevel = 'DISTRICT';
  }

  const emergencyCapability: EmergencyCapability =
    facility.emergencyAvailable === true
      ? 'SOURCE_REPORTED_CAPABLE'
      : facility.emergencyAvailable === false
        ? 'SOURCE_REPORTED_NOT_CAPABLE'
        : 'UNKNOWN';

  return {
    iphsLevel,
    iphsClassification,
    referralLevel,
    emergencyCapability,
    classificationBasis: sourceType ? `hospitalType:${sourceType}` : null,
  };
}

export function supportsIphsOverlay(state?: string | null): boolean {
  return IPHS_OVERLAY_STATES.includes(
    normalize(state).replace(/ /g, '_') as (typeof IPHS_OVERLAY_STATES)[number],
  );
}
