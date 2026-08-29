import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Existing Delhi facility rows were imported before FacilityScheme existed.
 * Their authoritative pmjayStatus=true flag represents a source-backed
 * AYUSHMAN_BHARAT listing, so create the missing normalized association once.
 */
export class BackfillLegacyPmjayFacilitySchemes1723818000000 implements MigrationInterface {
  name = 'BackfillLegacyPmjayFacilitySchemes1723818000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "facility_schemes" ("tenantId", "facilityId", "scheme", "status", "source", "active")
      SELECT f."tenantId", f.id, 'AYUSHMAN_BHARAT', 'SOURCE_LISTED', 'Legacy structured facility source', true
      FROM "facilities" f
      WHERE f.active = true AND f."pmjayStatus" = true
      ON CONFLICT ("tenantId", "facilityId", "scheme") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "facility_schemes"
      WHERE "scheme" = 'AYUSHMAN_BHARAT'
        AND "source" = 'Legacy structured facility source'
    `);
  }
}
