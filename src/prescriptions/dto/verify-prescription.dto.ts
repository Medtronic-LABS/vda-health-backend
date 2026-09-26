import { IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class VerifiedMedicationDto {
  @IsString() @MaxLength(200) medicationName!: string;
  @IsOptional() @IsString() @MaxLength(120) normalizedName?: string | null;
  @IsOptional() @IsString() @MaxLength(80) strength?: string | null;
  @IsOptional() @IsString() @MaxLength(120) dosage?: string | null;
  @IsOptional() @IsString() @MaxLength(80) dosageForm?: string | null;
  @IsOptional() @IsString() @MaxLength(80) route?: string | null;
  @IsOptional() @IsString() @MaxLength(120) frequency?: string | null;
  @IsOptional() @IsString() @MaxLength(120) timing?: string | null;
  @IsOptional() @IsString() @MaxLength(120) duration?: string | null;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string | null;
}

export class VerifiedInvestigationDto {
  @IsString() @MaxLength(200) rawName!: string;
  @IsOptional() @IsString() @MaxLength(200) normalizedName?: string | null;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string | null;
}

export class VerifyPrescriptionDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => VerifiedMedicationDto)
  medications!: VerifiedMedicationDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => VerifiedInvestigationDto)
  investigations!: VerifiedInvestigationDto[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class PrescriptionDecisionDto {
  /** Explanation approved by the worker for display to this patient. */
  @IsString() @MaxLength(500) reason!: string;
  /** Optional internal review note. This is never returned in a patient response. */
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
