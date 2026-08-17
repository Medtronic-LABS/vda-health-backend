import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';
import { ConsentService } from './consent.service';

@Module({
  imports: [TypeOrmModule.forFeature([ConsentArtifact])],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
