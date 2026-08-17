export interface PiiDetectionResult {
  sanitizedText: string;
  detectedPiiCategories: string[];
  piiDetected: boolean;
  redactionMetadata: Record<string, any>;
  status: 'SUCCESS' | 'FAILED';
  language: string;
}

export interface IPiiProtectionService {
  sanitizeText(text: string, localeHint?: string): Promise<PiiDetectionResult>;
}
