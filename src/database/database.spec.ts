/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { DatabaseConfigService } from './database.config';
import { Tenant } from './entities/tenant.entity';
import { User } from './entities/user.entity';
import { ConsentArtifact } from './entities/consent-artifact.entity';
import { ConsentEvent } from './entities/consent-event.entity';
import { Session } from './entities/session.entity';
import { ConversationTurn } from './entities/conversation-turn.entity';

describe('Database Configuration & Entities', () => {
  const mockConfigService = {
    dbHost: 'localhost',
    dbPort: 5432,
    dbUsername: 'postgres',
    dbPassword: 'password',
    dbDatabase: 'vda_health',
    nodeEnv: 'development',
  } as any;

  let configService: DatabaseConfigService;

  beforeEach(() => {
    configService = new DatabaseConfigService(mockConfigService);
  });

  it('should generate correct TypeORM options', () => {
    const options = configService.createTypeOrmOptions() as any;
    expect(options.type).toBe('postgres');
    expect(options.host).toBe('localhost');
    expect(options.port).toBe(5432);
    expect(options.synchronize).toBe(false);
    expect(options.entities).toContain(Tenant);
    expect(options.entities).toContain(User);
    expect(options.entities).toContain(ConsentArtifact);
    expect(options.entities).toContain(ConsentEvent);
    expect(options.entities).toContain(Session);
    expect(options.entities).toContain(ConversationTurn);
  });

  it('should instantiate entities and verify structures', () => {
    const tenant = new Tenant();
    tenant.name = 'Test Tenant';
    tenant.domain = 'test.com';
    expect(tenant.name).toBe('Test Tenant');

    const user = new User();
    user.email = 'test@test.com';
    user.role = 'CLINICIAN';
    expect(user.role).toBe('CLINICIAN');

    const consent = new ConsentArtifact();
    consent.scopes = ['record_read'];
    expect(consent.scopes).toContain('record_read');

    const event = new ConsentEvent();
    event.eventType = 'CREATED';
    expect(event.eventType).toBe('CREATED');

    const session = new Session();
    session.speaker = 'self';
    expect(session.speaker).toBe('self');

    const turn = new ConversationTurn();
    turn.correlationId = 'trace-id-123';
    expect(turn.correlationId).toBe('trace-id-123');
  });
});
