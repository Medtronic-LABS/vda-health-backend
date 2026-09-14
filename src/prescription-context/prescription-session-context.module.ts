import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Prescription } from '../database/entities/prescription.entity';
import { Session } from '../database/entities/session.entity';
import { RedisModule } from '../redis/redis.module';
import { PrescriptionSessionContextController } from './prescription-session-context.controller';
import { PrescriptionSessionContextService } from './prescription-session-context.service';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Prescription]), AuthModule, RedisModule],
  controllers: [PrescriptionSessionContextController],
  providers: [PrescriptionSessionContextService],
  exports: [PrescriptionSessionContextService],
})
export class PrescriptionSessionContextModule {}
