import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  external_id!: string;

  @IsString()
  @IsNotEmpty()
  subject_abha_ref!: string;

  @IsString()
  @IsNotEmpty()
  speaker!: string;

  @IsString()
  @IsOptional()
  device_class?: string;

  @IsString()
  @IsOptional()
  locale_hint?: string;

  @IsString()
  @IsOptional()
  assist_context_id?: string;

  @IsUUID()
  @IsNotEmpty()
  consent_artefact_id!: string;
}
