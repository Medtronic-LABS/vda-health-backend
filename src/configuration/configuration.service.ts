import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

@Injectable()
export class ConfigurationService {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  get port(): number {
    return this.configService.get<number>('PORT');
  }

  get nodeEnv(): string {
    return this.configService.get<string>('NODE_ENV');
  }

  get apiPrefix(): string {
    return this.configService.get<string>('API_PREFIX');
  }

  get dbHost(): string {
    return this.configService.get<string>('DB_HOST');
  }

  get dbPort(): number {
    return this.configService.get<number>('DB_PORT');
  }

  get dbUsername(): string {
    return this.configService.get<string>('DB_USERNAME');
  }

  get dbPassword(): string {
    return this.configService.get<string>('DB_PASSWORD');
  }

  get dbDatabase(): string {
    return this.configService.get<string>('DB_DATABASE');
  }

  get redisHost(): string {
    return this.configService.get<string>('REDIS_HOST');
  }

  get redisPort(): number {
    return this.configService.get<number>('REDIS_PORT');
  }

  get redisPassword(): string | undefined {
    return this.configService.get<string>('REDIS_PASSWORD');
  }

  get sarvamApiKey(): string {
    return this.configService.get<string>('SARVAM_API_KEY');
  }

  get sarvamBaseUrl(): string {
    return this.configService.get<string>('SARVAM_BASE_URL');
  }

  get sarvamLlmModel(): string {
    return this.configService.get<string>('SARVAM_LLM_MODEL');
  }

  get sarvamTranslationModel(): string {
    return this.configService.get<string>('SARVAM_TRANSLATION_MODEL');
  }

  get sarvamSaarasSttModel(): string {
    return this.configService.get<string>('SARVAM_SAARAS_STT_MODEL');
  }

  get sarvamBulbulTtsModel(): string {
    return this.configService.get<string>('SARVAM_BULBUL_TTS_MODEL');
  }

  get geminiApiKey(): string {
    return this.configService.get<string>('GEMINI_API_KEY');
  }

  get geminiModelId(): string {
    return this.configService.get<string>('GEMINI_MODEL_ID');
  }

  get clinicianLeaseTtlSeconds(): number {
    return this.configService.get<number>('CLINICIAN_LEASE_TTL_SECONDS');
  }

  get ragasThresholdFaithfulness(): number {
    return this.configService.get<number>('RAGAS_THRESHOLD_FAITHFULNESS');
  }

  get ragasThresholdAnswerRelevancy(): number {
    return this.configService.get<number>('RAGAS_THRESHOLD_ANSWER_RELEVANCY');
  }

  get ragasThresholdContextRecall(): number {
    return this.configService.get<number>('RAGAS_THRESHOLD_CONTEXT_RECALL');
  }

  get ragasThresholdContextPrecision(): number {
    return this.configService.get<number>('RAGAS_THRESHOLD_CONTEXT_PRECISION');
  }

  get ragasThresholdEscalationRecall(): number {
    return this.configService.get<number>('RAGAS_THRESHOLD_ESCALATION_RECALL');
  }

  get correlationIdHeader(): string {
    return this.configService.get<string>('X_CORRELATION_ID_HEADER');
  }

  get devAuthEnabled(): boolean {
    return this.configService.get<boolean>('DEV_AUTH_ENABLED');
  }

  get devAuthPartnerId(): string | undefined {
    return this.configService.get<string | undefined>('DEV_AUTH_PARTNER_ID');
  }

  get devAuthTenantId(): string | undefined {
    return this.configService.get<string | undefined>('DEV_AUTH_TENANT_ID');
  }

  get devAuthExternalId(): string | undefined {
    return this.configService.get<string | undefined>('DEV_AUTH_EXTERNAL_ID');
  }

  get devAuthSubjectAbhaRef(): string | undefined {
    return this.configService.get<string | undefined>(
      'DEV_AUTH_SUBJECT_ABHA_REF',
    );
  }

  get devAuthToken(): string | undefined {
    return this.configService.get<string | undefined>('DEV_AUTH_TOKEN');
  }

  get contextCompleteness(): string {
    return (
      this.configService.get<string>('DEV_AUTH_CONTEXT_COMPLETENESS') ||
      'COMPLETE'
    );
  }

  get auditHmacKeyId(): string {
    return this.configService.get<string>('AUDIT_HMAC_KEY_ID');
  }

  get auditHmacSecret(): string {
    return this.configService.get<string>('AUDIT_HMAC_SECRET');
  }

  get idempotencyWaitTimeoutMs(): number {
    return this.configService.get<number>('IDEMPOTENCY_WAIT_TIMEOUT_MS');
  }

  get sessionExpiredHttpStatus(): number {
    return this.configService.get<number>('SESSION_EXPIRED_HTTP_STATUS');
  }
}
