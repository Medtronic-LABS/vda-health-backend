import { IsBoolean } from 'class-validator';

export class RecordFollowUpAttendanceDto {
  @IsBoolean()
  attended!: boolean;
}
