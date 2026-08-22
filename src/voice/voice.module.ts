import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigurationModule } from '../configuration/configuration.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({ imports: [ConfigurationModule, AuditModule, AuthModule], controllers: [VoiceController], providers: [VoiceService], exports: [VoiceService] })
export class VoiceModule {}
