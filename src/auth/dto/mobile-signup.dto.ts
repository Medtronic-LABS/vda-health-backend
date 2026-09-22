import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
export class MobileSignupDto {
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsString() @Matches(/^\d{4}$/) pin!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(120) age!: number;
  @IsIn(['male', 'female', 'other']) gender!: 'male' | 'female' | 'other';
  @IsString() @MinLength(2) @MaxLength(100) state!: string;
  @IsString() @MinLength(1) @MaxLength(100) district!: string;
  @IsOptional() @IsIn(['hi', 'en', 'ta', 'kn']) language?: 'hi' | 'en' | 'ta' | 'kn';
  @IsOptional() @IsIn(['hi', 'en', 'ta', 'kn']) preferredLanguage?: 'hi' | 'en' | 'ta' | 'kn';
  @IsOptional() @IsString() @MaxLength(50) abhaNumber?: string;
}
