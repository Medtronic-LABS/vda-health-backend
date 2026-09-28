import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, Min, ValidateNested } from 'class-validator';

export class PrescriptionReminderContextDto {
  @IsString()
  medicine_name!: string;

  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/, { each: true })
  reminder_times!: string[];
}

/** The device submits only confirmed reminder times; medicine/test facts stay server-resolved. */
export class RefreshPrescriptionSessionContextDto {
  /** Database Prescription.id returned as `id` by GET .../prescriptions/current. */
  @IsUUID()
  prescription_id!: string;

  @IsInt()
  @Min(1)
  plan_revision!: number;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionReminderContextDto)
  @IsOptional()
  reminders?: PrescriptionReminderContextDto[];
}
