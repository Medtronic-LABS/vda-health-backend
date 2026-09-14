import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTurnDto {
  @ApiProperty({
    description: 'The text input from the patient/user',
    example: 'I have a mild fever and cough.',
  })
  @IsString()
  @IsNotEmpty()
  input_text!: string;

  @ApiProperty({
    description: 'The speaker context (must align with session speaker)',
    example: 'self',
    required: false,
  })
  @IsString()
  @IsOptional()
  speaker?: string;

  @ApiProperty({
    description:
      'Opaque subject/patient identity reference (must align with session)',
    example: 'dev-subject-abha-ref-123',
    required: false,
  })
  @IsString()
  @IsOptional()
  subject_ref?: string;

  @ApiProperty({
    description: 'The input modality',
    example: 'text',
    required: false,
  })
  @IsString()
  @IsOptional()
  modality?: string;

  @ApiProperty({
    description: 'The input language/locale hint',
    example: 'en',
    required: false,
  })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiProperty({
    description: 'The exact uploaded prescription record to use for a prescription-scoped explanation turn',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  prescription_id?: string;

  /** Prevents any medication-data fallback outside active prescription context. */
  @IsBoolean()
  @IsOptional()
  prescription_context_required?: boolean;

}
