import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsEnum,
  IsNumber,
  IsString,
  IsOptional,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
  Provision = 'provision',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  PORT = 3000;

  @IsString()
  @IsOptional()
  API_PREFIX = '/api/v1';

  @IsString()
  DB_HOST!: string;

  @Type(() => Number)
  @IsNumber()
  DB_PORT!: number;

  @IsString()
  DB_USERNAME!: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  DB_DATABASE!: string;

  @IsString()
  REDIS_HOST!: string;

  @Type(() => Number)
  @IsNumber()
  REDIS_PORT!: number;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  @IsOptional()
  ABDM_ENABLED = false;

  @IsString()
  @IsOptional()
  ABDM_BASE_URL = 'https://dev.abdm.gov.in';

  @IsString()
  @IsOptional()
  ABDM_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  ABDM_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  ABDM_HIU_ID?: string;

  @IsString()
  @IsOptional()
  ABDM_X_CM_ID = 'sbx';

  @IsString()
  @IsOptional()
  ABDM_CALLBACK_URL = 'http://localhost:3000';

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  ABDM_TIMEOUT_MS = 10000;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  ABDM_MAX_RETRIES = 2;

  @IsString()
  @IsOptional()
  SARVAM_API_KEY?: string;

  @IsString()
  @IsOptional()
  SARVAM_BASE_URL = 'https://api.sarvam.ai';

  @IsString()
  @IsOptional()
  SARVAM_LLM_MODEL = 'sarvam-llm-v1';

  @IsString()
  @IsOptional()
  SARVAM_MODEL = 'mayura:v1';

  @IsString()
  @IsOptional()
  SARVAM_TRANSLATION_MODEL = 'sarvam-translate-v1';

  @IsString()
  @IsOptional()
  SARVAM_SAARAS_STT_MODEL = 'saaras:v3';

  @IsString()
  @IsOptional()
  SARVAM_BULBUL_TTS_MODEL = 'bulbul:v3';

  @IsOptional()
  SARVAM_ENABLED = false;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  SARVAM_TIMEOUT_MS = 10000;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  SARVAM_MAX_RETRIES = 2;

  // Voice provider routing. SraVaani is an isolated local STT service; Sarvam
  // remains the controlled STT fallback and the sole TTS provider.
  @IsIn(['sravaani', 'sarvam'])
  @IsOptional()
  VOICE_STT_PROVIDER: 'sravaani' | 'sarvam' = 'sravaani';

  @IsIn(['sravaani', 'sarvam'])
  @IsOptional()
  VOICE_STT_FALLBACK_PROVIDER: 'sravaani' | 'sarvam' = 'sarvam';

  @IsOptional()
  VOICE_STT_FALLBACK_ENABLED = true;

  @IsString()
  @IsOptional()
  SRAVAANI_BASE_URL = 'http://127.0.0.1:8001';

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  VOICE_STT_TIMEOUT_MS = 20000;

  @IsIn(['sarvam'])
  @IsOptional()
  VOICE_TTS_PROVIDER: 'sarvam' = 'sarvam';

  @IsString()
  @IsOptional()
  GEMINI_API_KEY?: string;

  @IsString()
  @IsOptional()
  GEMINI_API_KEY_1?: string;

  @IsString()
  @IsOptional()
  GEMINI_API_KEY_2?: string;

  @IsString()
  @IsOptional()
  GEMINI_API_KEY_3?: string;

  @IsString()
  @IsOptional()
  GEMINI_API_KEY_4?: string;

  @IsString()
  @IsOptional()
  GEMINI_MODEL_ID = 'gemini-3.5-flash';

  @IsString()
  @IsOptional()
  GEMINI_MODEL = 'gemini-3.5-flash';

  @IsOptional()
  AI_PROVIDER_ENABLED = false;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  GEMINI_TIMEOUT_MS = 10000;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  GEMINI_MAX_RETRIES = 2;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  GEMINI_KEY_COOLDOWN_SECONDS = 60;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  AI_MAX_INPUT_LENGTH = 2000;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  AI_MAX_OUTPUT_LENGTH = 2000;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  CLINICIAN_LEASE_TTL_SECONDS = 300;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  RAGAS_THRESHOLD_FAITHFULNESS = 0.9;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  RAGAS_THRESHOLD_ANSWER_RELEVANCY = 0.85;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  RAGAS_THRESHOLD_CONTEXT_RECALL = 0.85;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  RAGAS_THRESHOLD_CONTEXT_PRECISION = 0.8;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  RAGAS_THRESHOLD_ESCALATION_RECALL = 0.98;

  @IsString()
  @IsOptional()
  X_CORRELATION_ID_HEADER = 'x-correlation-id';

  @IsOptional()
  DEV_AUTH_ENABLED = false;

  @IsString()
  @IsOptional()
  DEV_AUTH_PARTNER_ID?: string;

  @IsString()
  @IsOptional()
  DEV_AUTH_TENANT_ID?: string;

  @IsString()
  @IsOptional()
  DEV_AUTH_EXTERNAL_ID?: string;

  @IsString()
  @IsOptional()
  DEV_AUTH_SUBJECT_ABHA_REF?: string;

  @IsString()
  @IsOptional()
  DEV_AUTH_TOKEN?: string;

  @IsString()
  @IsOptional()
  DEV_AUTH_CONTEXT_COMPLETENESS?: string;

  @IsString()
  @IsOptional()
  LOCAL_PATIENT_SUMMARY_PATH?: string;

  @IsString()
  @IsOptional()
  LOCAL_PATIENT_BUNDLES_PATH?: string;

  @IsString()
  @IsOptional()
  AUDIT_HMAC_KEY_ID?: string;

  @IsString()
  @IsOptional()
  AUDIT_HMAC_SECRET?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  IDEMPOTENCY_WAIT_TIMEOUT_MS = 3000;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  SESSION_EXPIRED_HTTP_STATUS = 410;

  @IsOptional()
  LANGCHAIN_TRACING_V2 = false;

  @IsString()
  @IsOptional()
  LANGCHAIN_API_KEY?: string;

  @IsString()
  @IsOptional()
  LANGCHAIN_PROJECT = 'vda-health-backend';

  @IsString()
  @IsOptional()
  LANGCHAIN_ENDPOINT = 'https://api.smith.langchain.com';

  @IsOptional()
  LANGSMITH_TRACING = false;

  @IsString()
  @IsOptional()
  LANGSMITH_API_KEY?: string;

  @IsString()
  @IsOptional()
  LANGSMITH_PROJECT?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
