import { IsString, Matches } from 'class-validator';

export class MobileRefreshDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) refreshToken!: string;
}

export class MobileRotateDto extends MobileRefreshDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) nextRefreshToken!: string;
}
