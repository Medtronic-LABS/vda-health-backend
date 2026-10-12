import { PushNotificationsService } from './push-notifications.service';

describe('PushNotificationsService patient scoping', () => {
  const make = (configured = true) => {
    const devices = { upsert: jest.fn(async () => undefined), update: jest.fn(async () => undefined) };
    const deliveryRepo = { create: jest.fn((value) => value), save: jest.fn(async () => undefined) };
    const manager = {
      getRepository: jest.fn((entity: { name: string }) => entity.name === 'MobilePushDevice'
        ? { find: jest.fn(async () => [{ id: 'device-a', tenantId: 'tenant-a', userId: 'patient-a' }]) }
        : deliveryRepo),
    };
    const service = new PushNotificationsService(devices as any, {} as any, {} as any, {} as any);
    if (configured) (service as any).firebaseApp = {};
    return { service, devices, manager, deliveryRepo };
  };

  it('binds a token to the authenticated tenant and patient with an atomic upsert', async () => {
    const { service, devices } = make();
    await service.register('tenant-a', 'patient-a', 'example:android-token-with-length');
    expect(devices.upsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', userId: 'patient-a', token: 'example:android-token-with-length',
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), disabledAt: null,
    }), ['tokenHash']);
  });

  it('queues only mobile-patient decisions for devices bound to that tenant and patient', async () => {
    const { service, manager, deliveryRepo } = make();
    const record = { id: 'prescription-a', tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a', verificationStatus: 'VERIFIED' };
    await service.enqueuePrescriptionDecision(manager as any, record as any);
    expect(manager.getRepository).toHaveBeenCalled();
    expect(deliveryRepo.save).toHaveBeenCalledWith([expect.objectContaining({
      tenantId: 'tenant-a', userId: 'patient-a', prescriptionId: 'prescription-a', deviceId: 'device-a', status: 'VERIFIED',
    })]);
    deliveryRepo.save.mockClear();
    await service.enqueuePrescriptionDecision(manager as any, { ...record, patientRef: 'synthetic:patient-a' } as any);
    expect(deliveryRepo.save).not.toHaveBeenCalled();
  });

  it('does not access push tables when Firebase is unconfigured', async () => {
    const { service, devices, manager, deliveryRepo } = make(false);
    const record = { id: 'prescription-a', tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a', verificationStatus: 'VERIFIED' };
    await service.register('tenant-a', 'patient-a', 'example:android-token-with-length');
    await service.unregisterAll('tenant-a', 'patient-a');
    await service.enqueuePrescriptionDecision(manager as any, record as any);
    service.wake();
    expect(devices.upsert).not.toHaveBeenCalled();
    expect(devices.update).not.toHaveBeenCalled();
    expect(manager.getRepository).not.toHaveBeenCalled();
    expect(deliveryRepo.save).not.toHaveBeenCalled();
  });
});
