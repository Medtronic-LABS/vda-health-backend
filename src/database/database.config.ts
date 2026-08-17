import { Injectable } from '@nestjs/common';
import { TypeOrmOptionsFactory, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigurationService } from '../configuration/configuration.service';
import { Tenant } from './entities/tenant.entity';
import { User } from './entities/user.entity';
import { ConsentArtifact } from './entities/consent-artifact.entity';
import { ConsentEvent } from './entities/consent-event.entity';
import { Session } from './entities/session.entity';
import { ConversationTurn } from './entities/conversation-turn.entity';
import { AuditEvent } from './entities/audit-event.entity';

@Injectable()
export class DatabaseConfigService implements TypeOrmOptionsFactory {
  constructor(private readonly configService: ConfigurationService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const isProd = this.configService.nodeEnv === 'production';
    return {
      type: 'postgres',
      host: this.configService.dbHost,
      port: this.configService.dbPort,
      username: this.configService.dbUsername,
      password: this.configService.dbPassword,
      database: this.configService.dbDatabase,
      entities: [
        Tenant,
        User,
        ConsentArtifact,
        ConsentEvent,
        Session,
        ConversationTurn,
        AuditEvent,
      ],
      synchronize: false,
      migrationsRun: false,
      logging: !isProd,
      poolSize: 10,
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: false }
          : false,
    };
  }
}
