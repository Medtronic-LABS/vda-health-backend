import { IsString, Matches, MaxLength } from 'class-validator';
export class MobileLoginDto {
  @IsString() @MaxLength(20) phone!: string;
  @IsString() @Matches(/^\d{4}$/) pin!: string;
}
