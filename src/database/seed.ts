import { AppDataSource } from './data-source';
import { Tenant } from './entities/tenant.entity';
import { User } from './entities/user.entity';

async function seed() {
  console.log('Initializing database connection for seeding...');
  await AppDataSource.initialize();

  const tenantRepo = AppDataSource.getRepository(Tenant);
  const userRepo = AppDataSource.getRepository(User);

  // Check if tenant already exists
  let tenant = await tenantRepo.findOne({ where: { name: 'VDA Dev Tenant' } });
  if (!tenant) {
    console.log('Seeding development Tenant...');
    tenant = new Tenant();
    tenant.name = 'VDA Dev Tenant';
    tenant.domain = 'dev.vdahealth.in';
    tenant.status = 'ACTIVE';
    tenant = await tenantRepo.save(tenant);
    console.log(`Tenant created with ID: ${tenant.id}`);
  } else {
    console.log(`Tenant already exists with ID: ${tenant.id}`);
  }

  // Check if operational user already exists
  let user = await userRepo.findOne({
    where: { email: 'clinician@vdahealth.in' },
  });
  if (!user) {
    console.log('Seeding development Clinician User...');
    user = new User();
    user.tenantId = tenant.id;
    user.externalId = 'host-clinician-001';
    user.email = 'clinician@vdahealth.in';
    user.role = 'CLINICIAN';
    user.status = 'ACTIVE';
    user = await userRepo.save(user);
    console.log(`Clinician user created with ID: ${user.id}`);
  } else {
    console.log(`Clinician user already exists with ID: ${user.id}`);
  }

  console.log('Seeding completed successfully.');
  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('Error during seeding:', err);
  process.exit(1);
});
