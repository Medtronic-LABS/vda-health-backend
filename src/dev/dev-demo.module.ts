import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../database/entities/tenant.entity';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';
import { DevDemoController } from './dev-demo.controller';
import { SessionsModule } from '../sessions/sessions.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, ConsentArtifact]), SessionsModule, AuthModule],
  controllers: [DevDemoController],
})
export class DevDemoModule {}
