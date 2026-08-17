import { plainToInstance, Type } from 'class-transformer';
import {
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

  @IsString()
  SARVAM_API_KEY!: string;

  @IsString()
  @IsOptional()
  SARVAM_BASE_URL = 'https://api.sarvam.ai';

  @IsString()
  SARVAM_LLM_MODEL!: string;

  @IsString()
  SARVAM_TRANSLATION_MODEL!: string;

  @IsString()
  SARVAM_SAARAS_STT_MODEL!: string;

  @IsString()
  SARVAM_BULBUL_TTS_MODEL!: string;

  @IsString()
  GEMINI_API_KEY!: string;

  @IsString()
  GEMINI_MODEL_ID = 'gemini-3.5-flash';

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
  DEV_AUTH_CONTEXT_COMPLETENESS = 'COMPLETE';

  @IsString()
  @IsOptional()
  AUDIT_HMAC_KEY_ID = 'v1';

  @IsString()
  @IsOptional()
  AUDIT_HMAC_SECRET = 'dev-hmac-secret-key-123';

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  IDEMPOTENCY_WAIT_TIMEOUT_MS = 3000;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  SESSION_EXPIRED_HTTP_STATUS = 410;
}

export function validate(config: Record<string, any>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Config validation error: ${errors.toString()}`);
  }
  return validatedConfig;
}
