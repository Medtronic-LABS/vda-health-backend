import { Module } from '@nestjs/common';
import { DevelopmentPiiProtectionService } from './services/development-pii-protection.service';

@Module({
  providers: [
    {
      provide: 'IPiiProtectionService',
      useClass: DevelopmentPiiProtectionService,
    },
  ],
  exports: ['IPiiProtectionService'],
})
export class PiiModule {}
