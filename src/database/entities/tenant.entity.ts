import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { ConsentArtifact } from './consent-artifact.entity';
import { Session } from './session.entity';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column()
  domain!: string;

  @Column({ default: 'ACTIVE' })
  status!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => User, (user) => user.tenant)
  users?: User[];

  @OneToMany(() => ConsentArtifact, (consent) => consent.tenant)
  consents?: ConsentArtifact[];

  @OneToMany(() => Session, (session) => session.tenant)
  sessions?: Session[];
}
