import { Module } from '@nestjs/common';
import { HostIdentityContext } from './host-identity.context';
import { MockHostIdentityService } from './mock-host-identity.service';
import { AuthGuard } from './auth.guard';
import { DevAuthController } from './dev-auth.controller';
import { TenantsModule } from '../tenants/tenants.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { MobileUser } from '../database/entities/mobile-user.entity';
import { Tenant } from '../database/entities/tenant.entity';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileAuthService } from './mobile-auth.service';
import { MobileAuthTokenService } from './mobile-auth-token.service';
import { ConfigurationModule } from '../configuration/configuration.module';
import { ConfigurationService } from '../configuration/configuration.service';
import { RedisModule } from '../redis/redis.module';
import { TenantRateLimiterGuard } from '../common/guards/tenant-rate-limiter.guard';
import { WorkerRoleGuard } from './worker-role.guard';

@Module({
  imports: [
    TenantsModule,
    ConfigurationModule,
    RedisModule,
    TypeOrmModule.forFeature([MobileUser, Tenant]),
    JwtModule.registerAsync({
      imports: [ConfigurationModule],
      inject: [ConfigurationService],
      useFactory: (config: ConfigurationService) => ({ secret: config.mobileAuthJwtSecret }),
    }),
  ],
  controllers: [DevAuthController, MobileAuthController],
  providers: [
    {
      provide: HostIdentityContext,
      useClass: MockHostIdentityService,
    },
    AuthGuard,
    MobileAuthService,
    MobileAuthTokenService,
    TenantRateLimiterGuard,
    WorkerRoleGuard,
  ],
  exports: [HostIdentityContext, AuthGuard, WorkerRoleGuard, MobileAuthTokenService, TenantsModule],
})
export class AuthModule {}
