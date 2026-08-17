import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ConfigurationService {
  constructor(private readonly configService: ConfigService) {}

  get port(): number {
    return this.configService.get<number>('PORT', 3000);
  }

  get nodeEnv(): string {
    return this.configService.get<string>('NODE_ENV', 'development');
  }

  get apiPrefix(): string {
    return this.configService.get<string>('API_PREFIX', '/api/v1');
  }

  get dbHost(): string {
    return this.configService.get<string>('DB_HOST')!;
  }

  get dbPort(): number {
    return this.configService.get<number>('DB_PORT')!;
  }

  get dbUsername(): string {
    return this.configService.get<string>('DB_USERNAME')!;
  }

  get dbPassword(): string {
    return this.configService.get<string>('DB_PASSWORD')!;
  }

  get dbDatabase(): string {
    return this.configService.get<string>('DB_DATABASE')!;
  }

  get redisHost(): string {
    return this.configService.get<string>('REDIS_HOST')!;
  }

  get redisPort(): number {
    return this.configService.get<number>('REDIS_PORT')!;
  }

  get redisPassword(): string | undefined {
    return this.configService.get<string>('REDIS_PASSWORD');
  }

  get abdmEnabled(): boolean {
    return Boolean(this.configService.get<boolean>('ABDM_ENABLED'));
  }

  get abdmBaseUrl(): string | undefined {
    return this.configService.get<string>('ABDM_BASE_URL');
  }

  get abdmClientId(): string | undefined {
    return this.configService.get<string>('ABDM_CLIENT_ID');
  }

  get abdmClientSecret(): string | undefined {
    return this.configService.get<string>('ABDM_CLIENT_SECRET');
  }

  get abdmHiuId(): string | undefined {
    return this.configService.get<string>('ABDM_HIU_ID');
  }

  get abdmXCmId(): string {
    return this.configService.get<string>('ABDM_X_CM_ID') || 'sbx';
  }

  get abdmCallbackUrl(): string {
    return (
      this.configService.get<string>('ABDM_CALLBACK_URL') ||
      'http://localhost:3000'
    );
  }

  get abdmTimeoutMs(): number {
    return this.configService.get<number>('ABDM_TIMEOUT_MS') || 10000;
  }

  get abdmMaxRetries(): number {
    return this.configService.get<number>('ABDM_MAX_RETRIES') || 2;
  }

  get sarvamApiKey(): string | undefined {
    return this.configService.get<string>('SARVAM_API_KEY');
  }

  get sarvamBaseUrl(): string {
    return (
      this.configService.get<string>('SARVAM_BASE_URL') ||
      'https://api.sarvam.ai'
    );
  }

  get sarvamLlmModel(): string {
    return (
      this.configService.get<string>('SARVAM_MODEL') ||
      this.configService.get<string>('SARVAM_TRANSLATION_MODEL') ||
      'mayura:v1'
    );
  }

  get sarvamModel(): string {
    return this.sarvamLlmModel;
  }

  get sarvamTranslationModel(): string {
    return (
      this.configService.get<string>('SARVAM_TRANSLATION_MODEL') || 'mayura:v1'
    );
  }

  get sarvamSaarasSttModel(): string | undefined {
    return this.configService.get<string>('SARVAM_SAARAS_STT_MODEL');
  }

  get sarvamBulbulTtsModel(): string | undefined {
    return this.configService.get<string>('SARVAM_BULBUL_TTS_MODEL');
  }

  get sarvamEnabled(): boolean {
    return Boolean(this.configService.get<boolean>('SARVAM_ENABLED'));
  }

  get sarvamTimeoutMs(): number {
    return this.configService.get<number>('SARVAM_TIMEOUT_MS') || 10000;
  }

  get sarvamMaxRetries(): number {
    return this.configService.get<number>('SARVAM_MAX_RETRIES') || 2;
  }

  get geminiApiKey(): string | undefined {
    return this.configService.get<string>('GEMINI_API_KEY');
  }

  get geminiModelId(): string {
    return (
      this.configService.get<string>('GEMINI_MODEL') ||
      this.configService.get<string>('GEMINI_MODEL_ID') ||
      'gemini-3.5-flash'
    );
  }

  get geminiModel(): string {
    return this.geminiModelId;
  }

  get aiProviderEnabled(): boolean {
    return Boolean(this.configService.get<boolean>('AI_PROVIDER_ENABLED'));
  }

  get geminiTimeoutMs(): number {
    return this.configService.get<number>('GEMINI_TIMEOUT_MS') || 10000;
  }

  get geminiMaxRetries(): number {
    return this.configService.get<number>('GEMINI_MAX_RETRIES') || 2;
  }

  get aiMaxInputLength(): number {
    return this.configService.get<number>('AI_MAX_INPUT_LENGTH') || 2000;
  }

  get aiMaxOutputLength(): number {
    return this.configService.get<number>('AI_MAX_OUTPUT_LENGTH') || 2000;
  }

  get clinicianLeaseTtlSeconds(): number {
    return this.configService.get<number>('CLINICIAN_LEASE_TTL_SECONDS') || 300;
  }

  get ragasThresholdFaithfulness(): number {
    return (
      this.configService.get<number>('RAGAS_THRESHOLD_FAITHFULNESS') || 0.9
    );
  }

  get ragasThresholdAnswerRelevancy(): number {
    return (
      this.configService.get<number>('RAGAS_THRESHOLD_ANSWER_RELEVANCY') || 0.85
    );
  }

  get ragasThresholdContextRecall(): number {
    return (
      this.configService.get<number>('RAGAS_THRESHOLD_CONTEXT_RECALL') || 0.85
    );
  }

  get ragasThresholdContextPrecision(): number {
    return (
      this.configService.get<number>('RAGAS_THRESHOLD_CONTEXT_PRECISION') || 0.8
    );
  }

  get ragasThresholdEscalationRecall(): number {
    return (
      this.configService.get<number>('RAGAS_THRESHOLD_ESCALATION_RECALL') ||
      0.98
    );
  }

  get xCorrelationIdHeader(): string {
    return (
      this.configService.get<string>('X_CORRELATION_ID_HEADER') ||
      'x-correlation-id'
    );
  }

  get devAuthEnabled(): boolean {
    return Boolean(this.configService.get<boolean>('DEV_AUTH_ENABLED'));
  }

  get devAuthPartnerId(): string | undefined {
    return this.configService.get<string>('DEV_AUTH_PARTNER_ID');
  }

  get devAuthTenantId(): string | undefined {
    return this.configService.get<string>('DEV_AUTH_TENANT_ID');
  }

  get devAuthExternalId(): string | undefined {
    return this.configService.get<string>('DEV_AUTH_EXTERNAL_ID');
  }

  get devAuthSubjectAbhaRef(): string | undefined {
    return this.configService.get<string>('DEV_AUTH_SUBJECT_ABHA_REF');
  }

  get devAuthToken(): string | undefined {
    return this.configService.get<string>('DEV_AUTH_TOKEN');
  }

  get devAuthContextCompleteness(): string | undefined {
    return this.configService.get<string>('DEV_AUTH_CONTEXT_COMPLETENESS');
  }

  get contextCompleteness(): string {
    return this.devAuthContextCompleteness || 'COMPLETE';
  }

  get auditHmacKeyId(): string | undefined {
    return this.configService.get<string>('AUDIT_HMAC_KEY_ID');
  }

  get auditHmacSecret(): string | undefined {
    return this.configService.get<string>('AUDIT_HMAC_SECRET');
  }

  get idempotencyWaitTimeoutMs(): number {
    return (
      this.configService.get<number>('IDEMPOTENCY_WAIT_TIMEOUT_MS') || 3000
    );
  }

  get sessionExpiredHttpStatus(): number {
    return this.configService.get<number>('SESSION_EXPIRED_HTTP_STATUS') || 410;
  }
}
