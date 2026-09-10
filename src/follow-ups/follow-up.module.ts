import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClinicalFollowUpAttendance } from '../database/entities/clinical-follow-up-attendance.entity';
import { Session } from '../database/entities/session.entity';
import { DevDemoModule } from '../dev/dev-demo.module';
import { FollowUpController } from './follow-up.controller';
import { FollowUpService } from './follow-up.service';

@Module({
  imports: [TypeOrmModule.forFeature([Session, ClinicalFollowUpAttendance]), AuthModule, DevDemoModule],
  controllers: [FollowUpController],
  providers: [FollowUpService],
  exports: [FollowUpService],
})
export class FollowUpModule {}
