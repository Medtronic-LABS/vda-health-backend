import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeDocument } from '../database/entities/knowledge-document.entity';
import { MobileUser } from '../database/entities/mobile-user.entity';
import { Scheme } from '../database/entities/scheme.entity';
import { SchemeAdminController } from './scheme-admin.controller';
import { SchemeService } from './scheme.service';
import { PatientSchemeController } from './patient-scheme.controller';
@Module({ imports: [TypeOrmModule.forFeature([Scheme, KnowledgeDocument, MobileUser]), AuthModule], controllers: [SchemeAdminController, PatientSchemeController], providers: [SchemeService], exports: [SchemeService] })
export class SchemeModule {}
