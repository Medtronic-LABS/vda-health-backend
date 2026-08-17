export interface VerificationRequest {
  generatedText: string;
  contextSources: string[];
  safetyRules?: string[];
}

export interface VerificationResponse {
  isVerified: boolean;
  reason?: string;
  faithfulnessScore?: number;
  correctedText?: string;
}

export interface VerificationProvider {
  verify(request: VerificationRequest): Promise<VerificationResponse>;
}
