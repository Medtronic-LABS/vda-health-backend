import { Module } from '@nestjs/common';
import { HostIdentityContext } from './host-identity.context';
import { MockHostIdentityService } from './mock-host-identity.service';
import { AuthGuard } from './auth.guard';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TenantsModule],
  providers: [
    {
      provide: HostIdentityContext,
      useClass: MockHostIdentityService,
    },
    AuthGuard,
  ],
  exports: [HostIdentityContext, AuthGuard, TenantsModule],
})
export class AuthModule {}
