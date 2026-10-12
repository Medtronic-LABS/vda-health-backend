import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { applicationDefault, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { MobilePushDevice } from '../database/entities/mobile-push-device.entity';
import { PrescriptionPushDelivery } from '../database/entities/prescription-push-delivery.entity';
import { MobileUser } from '../database/entities/mobile-user.entity';
import { Prescription } from '../database/entities/prescription.entity';

@Injectable()
export class PushNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushNotificationsService.name);
  private firebaseApp: App | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    @InjectRepository(MobilePushDevice) private readonly devices: Repository<MobilePushDevice>,
    @InjectRepository(PrescriptionPushDelivery) private readonly deliveries: Repository<PrescriptionPushDelivery>,
    @InjectRepository(MobileUser) private readonly users: Repository<MobileUser>,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!projectId || !credentialPath || !existsSync(credentialPath)) {
      this.logger.log('FCM is unconfigured; in-app prescription notices remain available.');
      return;
    }
    try {
      this.firebaseApp = getApps().length ? getApp() : initializeApp({ credential: applicationDefault(), projectId });
      this.timer = setInterval(() => { void this.flush(); }, 30_000);
      this.timer.unref?.();
      void this.flush();
    } catch {
      this.logger.warn('FCM initialization failed; in-app prescription notices remain available.');
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async register(tenantId: string, userId: string, token: string): Promise<void> {
    if (!this.firebaseApp) return;
    const normalized = token.trim();
    if (normalized.length < 20 || normalized.length > 4096 || /\s/.test(normalized)) throw new BadRequestException('INVALID_PUSH_TOKEN');
    const hash = createHash('sha256').update(normalized).digest('hex');
    // A refreshed token can be bound to only one account at a time, including
    // when family members share the Android device.
    await this.devices.upsert({ tokenHash: hash, tenantId, userId, token: normalized, platform: 'android', disabledAt: null }, ['tokenHash']);
  }

  async unregisterAll(tenantId: string, userId: string): Promise<void> {
    if (!this.firebaseApp) return;
    await this.devices.update({ tenantId, userId, disabledAt: IsNull() }, { disabledAt: new Date() });
  }

  // Called inside the prescription decision transaction. Only the devices
  // currently bound to this authenticated patient receive a durable delivery.
  async enqueuePrescriptionDecision(manager: EntityManager, record: Prescription): Promise<void> {
    if (!this.firebaseApp) return;
    if (!record.patientRef.startsWith('mobile-user:')) return;
    if (!['VERIFIED', 'REJECTED', 'NEEDS_RESUBMISSION'].includes(record.verificationStatus)) return;
    const userId = record.patientRef.slice('mobile-user:'.length);
    const devices = await manager.getRepository(MobilePushDevice).find({
      where: { tenantId: record.tenantId, userId, disabledAt: IsNull() },
    });
    if (!devices.length) return;
    const repo = manager.getRepository(PrescriptionPushDelivery);
    await repo.save(devices.map((device) => repo.create({
      tenantId: record.tenantId, userId, prescriptionId: record.id,
      status: record.verificationStatus as PrescriptionPushDelivery['status'],
      deviceId: device.id, attempts: 0, nextAttemptAt: new Date(), deliveredAt: null,
    })));
  }

  wake(): void { if (this.firebaseApp) void this.flush(); }

  private async flush(): Promise<void> {
    if (!this.firebaseApp || this.flushing) return;
    this.flushing = true;
    try {
      const due = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(PrescriptionPushDelivery);
        const rows = await repo.createQueryBuilder('d')
          .where('d.deliveredAt IS NULL AND d.nextAttemptAt <= now()')
          .orderBy('d.createdAt', 'ASC').limit(20)
          .setLock('pessimistic_write').setOnLocked('skip_locked').getMany();
        for (const row of rows) {
          row.attempts += 1;
          row.nextAttemptAt = new Date(Date.now() + 120_000);
        }
        await repo.save(rows);
        return rows;
      });
      for (const delivery of due) await this.sendOne(delivery);
    } catch {
      this.logger.warn('Push delivery retry is unavailable; queued notices remain pending.');
    } finally {
      this.flushing = false;
    }
  }

  private async sendOne(delivery: PrescriptionPushDelivery): Promise<void> {
    const device = await this.devices.findOne({ where: { id: delivery.deviceId } });
    const user = await this.users.findOne({ where: { id: delivery.userId, tenantId: delivery.tenantId, isActive: true } });
    if (!device || device.disabledAt || device.tenantId !== delivery.tenantId || device.userId !== delivery.userId || !user) {
      await this.deliveries.update(delivery.id, { deliveredAt: new Date() });
      return;
    }
    const hindi = user.preferredLanguage === 'hi';
    try {
      await getMessaging(this.firebaseApp!).send({
        token: device.token,
        notification: {
          title: hindi ? 'VDA Health से सूचना' : 'VDA Health update',
          body: hindi ? 'आपके लिए नई सूचना है। ऐप खोलकर देखें।' : 'You have a new update. Open the app to view it.',
        },
        data: { type: 'PRESCRIPTION_REVIEW', prescriptionId: delivery.prescriptionId, eventId: delivery.id },
        android: { priority: 'high', notification: { channelId: 'prescription_updates', tag: delivery.id } },
      });
      await this.deliveries.update(delivery.id, { deliveredAt: new Date() });
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        await this.devices.delete(device.id);
        return;
      }
      const delay = Math.min(3_600_000, 30_000 * 2 ** Math.min(delivery.attempts, 7));
      await this.deliveries.update(delivery.id, { nextAttemptAt: new Date(Date.now() + delay) });
      this.logger.warn('FCM send failed; delivery will be retried.');
    }
  }
}
