import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigurationModule } from '../configuration/configuration.module';
import { ObservabilityModule } from '../observability/observability.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { SarvamSttProvider } from './stt/sarvam-stt.provider';
import { SravaaniSttProvider } from './stt/sravaani-stt.provider';

@Module({ imports: [ConfigurationModule, AuditModule, AuthModule, ObservabilityModule], controllers: [VoiceController], providers: [VoiceService, SarvamSttProvider, SravaaniSttProvider], exports: [VoiceService] })
export class VoiceModule {}
