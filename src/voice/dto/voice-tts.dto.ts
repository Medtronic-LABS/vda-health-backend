import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class VoiceTtsDto {
  @IsString()
  @MaxLength(2500)
  text!: string;

  @IsIn(['hi-IN', 'en-IN', 'ta-IN', 'kn-IN'])
  language_code!: 'hi-IN' | 'en-IN' | 'ta-IN' | 'kn-IN';

  @IsOptional()
  @IsIn(['priya', 'ishita', 'neha'])
  voice_id?: 'priya' | 'ishita' | 'neha';

  @IsOptional()
  @IsNumber()
  @Min(0.8)
  @Max(1)
  pace?: number;
}
