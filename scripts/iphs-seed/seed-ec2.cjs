#!/usr/bin/env node
// One-time, tenant-scoped import of the three already-indexed local IPHS PDFs.
// This script does not parse PDFs, generate embeddings, run migrations, or
// automatically delete destination records.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const DATA_FILE = path.join(__dirname, 'iphs-2022-records.json');
const DATA_SHA256 = '137c860076fed02469df0f255336ccc35dd460d179c12730bdaaefce88e6b335';
const SOURCE_TENANT = '00000000-0000-0000-0000-000000000000';
const SOURCE = 'Ministry of Health and Family Welfare, Government of India - Indian Public Health Standards (IPHS) 2022';
const EXPECTED = [
  { id: 'bda9c82c-3626-4eb1-b051-fb4cedcdf670', title: 'IPHS 2022 - CHC Guidelines', checksum: 'db31a48990178bcee23a9bbabb6bf18343ff5ec74340f3ec76cbe73925cee41b', chunks: 295 },
  { id: 'cd70d9e2-2fb5-4dfa-9dfa-508abd58e27d', title: 'IPHS 2022 - SDH DH Guidelines', checksum: 'cea84bdee30f844e227987ed4be6f0a30967d245a44f0dc9a3835a9befe1cb71', chunks: 451 },
  { id: '69f57553-8baf-4ac8-890e-3fef8231ef0c', title: 'IPHS 2022 - SHC HWC UHWC Guidelines', checksum: 'f6756aca4729c731c62952ab8a60c9ed1b090717b9eea7255bf9187bb2fbe2ae', chunks: 182 },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) { throw new Error(message); }
function loadData() {
  const buffer = fs.readFileSync(DATA_FILE);
  const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== DATA_SHA256) fail(`Seed data checksum mismatch: ${actualHash}`);
  const data = JSON.parse(buffer.toString('utf8'));
  if (data.format !== 'vda-iphs-2022-records-v1' || data.sourceTenantId !== SOURCE_TENANT) fail('Unexpected seed data format or source tenant.');
  if (!Array.isArray(data.documents) || !Array.isArray(data.chunks) || !Array.isArray(data.embeddings) || data.documents.length !== 3) fail('Incomplete IPHS seed data.');
  const docs = new Map(data.documents.map(doc => [doc.id, doc]));
  const chunks = new Map(data.chunks.map(chunk => [chunk.id, chunk]));
  if (docs.size !== 3 || chunks.size !== 928 || data.chunks.length !== 928 || data.embeddings.length !== 928) fail('Unexpected document, chunk, or embedding count.');
  for (const expected of EXPECTED) {
    const doc = docs.get(expected.id);
    if (!doc || doc.title !== expected.title || doc.checksum !== expected.checksum || doc.status !== 'ACTIVE' || doc.tenantId !== SOURCE_TENANT || doc.source !== SOURCE || doc.version !== '2022' || doc.language !== 'en' || doc.domain !== 'healthcare_facilities' || doc.category !== 'iphs_2022_facility_standards' || doc.metadata?.standard !== 'IPHS' || doc.metadata?.standardYear !== 2022) fail(`Invalid source document: ${expected.title}`);
    const matching = data.chunks.filter(chunk => chunk.documentId === expected.id);
    if (matching.length !== expected.chunks || new Set(matching.map(chunk => chunk.chunkIndex)).size !== expected.chunks) fail(`Incomplete source chunks: ${expected.title}`);
  }
  const embeddingChunkIds = new Set();
  for (const chunk of data.chunks) {
    if (!docs.has(chunk.documentId) || chunk.tenantId !== SOURCE_TENANT || chunk.documentVersion !== '2022' || chunk.domain !== 'healthcare_facilities' || chunk.category !== 'iphs_2022_facility_standards' || chunk.source !== SOURCE) fail(`Invalid chunk: ${chunk.id}`);
  }
  for (const emb of data.embeddings) {
    if (!chunks.has(emb.chunkId) || embeddingChunkIds.has(emb.chunkId) || emb.embeddingModel !== 'all-MiniLM-L6-v2' || emb.embeddingDimension !== 384 || typeof emb.embedding !== 'string' || !emb.embedding.startsWith('[') || !emb.embedding.endsWith(']') || emb.embedding.slice(1, -1).split(',').length !== 384) fail(`Invalid embedding: ${emb.id}`);
    embeddingChunkIds.add(emb.chunkId);
  }
  return data;
}

async function inspect(client, tenantId) {
  const tenant = await client.query('SELECT id, status FROM tenants WHERE id = $1', [tenantId]);
  if (tenant.rowCount !== 1 || tenant.rows[0].status !== 'ACTIVE') fail(`Target tenant ${tenantId} does not exist or is not ACTIVE.`);
  const result = await client.query(`
    SELECT d.id, d."tenantId" AS "tenantId", d.title, d.status, d.checksum,
           (SELECT count(*)::int FROM knowledge_chunks c WHERE c."documentId" = d.id) AS chunks,
           (SELECT count(*)::int FROM knowledge_embeddings e JOIN knowledge_chunks c ON c.id = e."chunkId" WHERE c."documentId" = d.id) AS embeddings
    FROM knowledge_documents d
    WHERE (d."tenantId" = $1 AND (d.checksum = ANY($2::varchar[]) OR d.title = ANY($3::varchar[])))
       OR d.id = ANY($4::uuid[])
    ORDER BY d.title, d.id`, [tenantId, EXPECTED.map(item => item.checksum), EXPECTED.map(item => item.title), EXPECTED.map(item => item.id)]);
  return result.rows;
}

async function verify(client, tenantId) {
  const result = await client.query(`
    SELECT d.id, d.title, d.version, d.status, d.checksum, d.source, d.domain, d.category,
           count(DISTINCT c.id)::int AS chunks, count(DISTINCT e.id)::int AS embeddings,
           count(DISTINCT c.id) FILTER (WHERE e.id IS NOT NULL AND c.content ~* '(^|[^[:alpha:]])(ECG|electrocardiogram)([^[:alpha:]]|$)')::int AS "ecgEvidenceChunks"
    FROM knowledge_documents d
    LEFT JOIN knowledge_chunks c ON c."documentId" = d.id AND c."tenantId" = d."tenantId"
    LEFT JOIN knowledge_embeddings e ON e."chunkId" = c.id
    WHERE d."tenantId" = $1 AND d.checksum = ANY($2::varchar[])
    GROUP BY d.id ORDER BY d.title`, [tenantId, EXPECTED.map(item => item.checksum)]);
  const byChecksum = new Map(result.rows.map(row => [row.checksum, row]));
  for (const expected of EXPECTED) {
    const row = byChecksum.get(expected.checksum);
    if (!row || row.title !== expected.title || row.status !== 'ACTIVE' || row.version !== '2022' || row.source !== SOURCE || row.domain !== 'healthcare_facilities' || row.category !== 'iphs_2022_facility_standards' || row.chunks !== expected.chunks || row.embeddings !== expected.chunks) fail(`Verification failed for ${expected.title}.`);
  }
  if (!result.rows.some(row => row.ecgEvidenceChunks > 0)) fail('No indexed ECG evidence was found in the three active IPHS documents.');
  console.log(JSON.stringify({ targetTenantId: tenantId, documents: result.rows, allThreeActiveAndEmbedded: true,
    note: 'ecgEvidenceChunks verifies indexed source text; run a patient ECG facility query for end-to-end resolver validation.' }, null, 2));
}

async function insert(client, data, tenantId) {
  for (const d of data.documents) {
    await client.query(`INSERT INTO knowledge_documents
      (id, "tenantId", title, description, source, "sourceUrl", version, language, domain, category,
       role, state, district, status, "effectiveDate", "reviewDate", checksum, metadata, "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20)`,
      [d.id, tenantId, d.title, d.description, d.source, d.sourceUrl, d.version, d.language, d.domain, d.category,
        d.role, d.state, d.district, d.status, d.effectiveDate, d.reviewDate, d.checksum, JSON.stringify(d.metadata), d.createdAt, d.updatedAt]);
  }
  for (const c of data.chunks) {
    await client.query(`INSERT INTO knowledge_chunks
      (id, "documentId", "tenantId", "documentVersion", content, "chunkIndex", language, domain,
       category, role, state, district, source, metadata, "createdAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
      [c.id, c.documentId, tenantId, c.documentVersion, c.content, c.chunkIndex, c.language, c.domain,
        c.category, c.role, c.state, c.district, c.source, JSON.stringify(c.metadata), c.createdAt]);
  }
  for (const e of data.embeddings) {
    await client.query(`INSERT INTO knowledge_embeddings
      (id, "chunkId", embedding, "embeddingModel", "embeddingDimension", "createdAt")
      VALUES ($1,$2,$3::vector,$4,$5,$6)`,
      [e.id, e.chunkId, e.embedding, e.embeddingModel, e.embeddingDimension, e.createdAt]);
  }
  for (const expected of EXPECTED) {
    const result = await client.query(`SELECT count(DISTINCT c.id)::int AS chunks, count(DISTINCT e.id)::int AS embeddings
      FROM knowledge_documents d
      JOIN knowledge_chunks c ON c."documentId" = d.id AND c."tenantId" = d."tenantId"
      LEFT JOIN knowledge_embeddings e ON e."chunkId" = c.id
      WHERE d.id = $1 AND d."tenantId" = $2 AND d.status = 'ACTIVE'`, [expected.id, tenantId]);
    if (result.rows[0].chunks !== expected.chunks || result.rows[0].embeddings !== expected.chunks) fail(`Post-insert verification failed: ${expected.title}`);
  }
}

async function main() {
  const [mode, id, suppliedChecksum, flag] = process.argv.slice(2);
  if (!['check', 'apply', 'verify', 'remove-conflict'].includes(mode)) fail('Usage: node seed-ec2.cjs check|apply|verify|remove-conflict [document-id checksum [--backend-stopped]]');
  const tenantId = process.env.IPHS_SEED_TENANT_ID;
  if (!tenantId || !UUID.test(tenantId)) fail('IPHS_SEED_TENANT_ID must be an existing tenant UUID.');
  if (process.env.MOBILE_AUTH_TENANT_ID && process.env.MOBILE_AUTH_TENANT_ID !== tenantId) fail('IPHS_SEED_TENANT_ID differs from MOBILE_AUTH_TENANT_ID.');
  const data = loadData();
  const client = new Client({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres', password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'vda_health',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false });
  await client.connect();
  try {
    if (mode === 'check') {
      const existing = await inspect(client, tenantId);
      console.log(JSON.stringify({ targetTenantId: tenantId, sourceDocuments: EXPECTED.map(({ title, checksum, chunks }) => ({ title, checksum, chunks })), existing, readyToApply: existing.length === 0 }, null, 2));
      return;
    }
    if (mode === 'verify') {
      await verify(client, tenantId);
      return;
    }
    if (mode === 'remove-conflict') {
      const expected = EXPECTED.find(item => item.checksum === suppliedChecksum);
      if (!UUID.test(id || '') || !expected) fail('Supply an exact conflicting document ID and one of the three expected PDF checksums.');
      await client.query('BEGIN');
      const found = await client.query('SELECT id, title, status, checksum FROM knowledge_documents WHERE id = $1 AND "tenantId" = $2 FOR UPDATE', [id, tenantId]);
      const row = found.rows[0];
      if (!row || row.title !== expected.title || row.checksum !== suppliedChecksum || !['FAILED', 'PROCESSING'].includes(row.status)) fail('Refusing removal: ID, tenant, title, checksum, or status does not match a failed/stale IPHS upload.');
      if (row.status === 'PROCESSING' && flag !== '--backend-stopped') fail('Refusing to remove a PROCESSING record until the backend is stopped; rerun with --backend-stopped after confirming it is stopped.');
      await client.query('DELETE FROM knowledge_documents WHERE id = $1 AND "tenantId" = $2 AND status = $3 AND checksum = $4', [id, tenantId, row.status, suppliedChecksum]);
      await client.query('COMMIT');
      console.log(JSON.stringify({ removed: { id: row.id, title: row.title, status: row.status }, note: 'Only this document and its cascading chunks/embeddings were removed.' }));
      return;
    }
    await client.query('BEGIN');
    const existing = await inspect(client, tenantId);
    if (existing.length) fail(`Destination conflicts; no records were inserted. Run check and resolve exact IDs first: ${JSON.stringify(existing)}`);
    await insert(client, data, tenantId);
    await client.query('COMMIT');
    console.log(JSON.stringify({ seeded: EXPECTED.map(({ id, title, chunks }) => ({ id, title, chunks, embeddings: chunks, status: 'ACTIVE' })), targetTenantId: tenantId }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => { console.error(`IPHS seed stopped: ${error.message}`); process.exitCode = 1; });
