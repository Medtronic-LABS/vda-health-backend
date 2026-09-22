import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
export class UpdateMobileProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) age?: number;
  @IsOptional() @IsIn(['male', 'female', 'other']) gender?: 'male' | 'female' | 'other';
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) district?: string;
  @IsOptional() @IsIn(['hi', 'en', 'ta', 'kn']) language?: 'hi' | 'en' | 'ta' | 'kn';
  @IsOptional() @IsIn(['hi', 'en', 'ta', 'kn']) preferredLanguage?: 'hi' | 'en' | 'ta' | 'kn';
  @IsOptional() @IsString() @MaxLength(50) abhaNumber?: string | null;
}
