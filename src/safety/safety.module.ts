import { Module } from '@nestjs/common';
import { DevelopmentSafetyGate } from './services/development-safety-gate.service';

@Module({
  providers: [
    {
      provide: 'ISafetyGate',
      useClass: DevelopmentSafetyGate,
    },
  ],
  exports: ['ISafetyGate'],
})
export class SafetyModule {}
