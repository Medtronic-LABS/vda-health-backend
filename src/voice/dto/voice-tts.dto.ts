import { IsIn, IsString, MaxLength } from 'class-validator';

export class VoiceTtsDto {
  @IsString()
  @MaxLength(2500)
  text!: string;

  @IsIn(['hi-IN', 'en-IN', 'ta-IN', 'kn-IN'])
  language_code!: 'hi-IN' | 'en-IN' | 'ta-IN' | 'kn-IN';
}
