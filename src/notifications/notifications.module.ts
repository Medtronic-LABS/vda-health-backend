import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MobilePushDevice } from '../database/entities/mobile-push-device.entity';
import { PrescriptionPushDelivery } from '../database/entities/prescription-push-delivery.entity';
import { MobileUser } from '../database/entities/mobile-user.entity';
import { PushNotificationsController } from './push-notifications.controller';
import { PushNotificationsService } from './push-notifications.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([MobilePushDevice, PrescriptionPushDelivery, MobileUser])],
  controllers: [PushNotificationsController],
  providers: [PushNotificationsService],
  exports: [PushNotificationsService],
})
export class NotificationsModule {}
