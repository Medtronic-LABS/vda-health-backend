import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

const DEMO_SOURCE = 'VDA_SYNTHETIC_FOLLOW_UP_DEMO';
const INDIA_TIMEZONE = 'Asia/Kolkata';

type JsonObject = Record<string, unknown>;
type Env = Record<string, string>;

interface PgPool {
  query(sql: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

interface PgPoolConstructor {
  new (config: { host: string; port: number; user: string; password: string; database: string }): PgPool;
}

const { Pool } = require('pg') as { Pool: PgPoolConstructor };

interface HistoricalCheckup {
  id: string;
  title: string;
  dueDate: string;
}

interface DemoScenario {
  resources: JsonObject[];
  historicalCheckups: HistoricalCheckup[];
}

const indiaToday = (): { year: number; month: number; day: number } => {
  const fields = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => fields.find((field) => field.type === type)?.value || '';
  return { year: Number(part('year')), month: Number(part('month')), day: Number(part('day')) };
};

const isoDate = (year: number, month: number, day: number): string =>
  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

const indiaDate = (offsetDays: number): string => {
  const today = indiaToday();
  return isoDate(today.year, today.month, today.day + offsetDays);
};

/** Calendar-month offsets keep the demo meaningful across month lengths. */
const indiaDateMonthsAgo = (monthsAgo: number): string => {
  const today = indiaToday();
  const targetMonthIndex = today.month - 1 - monthsAgo;
  const targetYear = today.year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return isoDate(targetYear, targetMonth + 1, Math.min(today.day, lastDay));
};

const asAppointment = (id: string, title: string, dueDate: string, status: 'booked' | 'fulfilled' = 'booked'): JsonObject => ({
  resourceType: 'Appointment', id, status, serviceType: [{ text: title }],
  start: `${dueDate}T10:00:00+05:30`, end: `${dueDate}T10:20:00+05:30`,
  extension: [{ url: 'source', valueString: DEMO_SOURCE }],
});

const asCompletedEncounter = (id: string, title: string, visitDate: string): JsonObject => ({
  resourceType: 'Encounter', id, status: 'finished', type: [{ text: title }],
  period: { start: `${visitDate}T10:00:00+05:30`, end: `${visitDate}T10:20:00+05:30` },
  extension: [{ url: 'source', valueString: DEMO_SOURCE }],
});

const historicalCheckups = (patientKey: string, title: string, monthOffsets: number[]): HistoricalCheckup[] =>
  monthOffsets.map((monthsAgo) => ({
    id: `demo-followup-${patientKey}-history-${monthsAgo}m`,
    title,
    dueDate: indiaDateMonthsAgo(monthsAgo),
  }));

const scenarioResources = (): Record<string, DemoScenario> => {
  const vijayHistory = historicalCheckups('001', 'Diabetes follow-up', [3, 2, 1]);
  const vidyaHistory = historicalCheckups('041', 'Blood pressure follow-up', [1]);
  return {
    'synth-patient-001': {
      historicalCheckups: vijayHistory,
      resources: [
        ...vijayHistory.map((event) => asAppointment(event.id, event.title, event.dueDate, 'fulfilled')),
        asAppointment('demo-followup-001-today', 'Diabetes follow-up', indiaDate(0)),
      ],
    },
    'synth-patient-041': {
      historicalCheckups: vidyaHistory,
      resources: [
        ...vidyaHistory.map((event) => asAppointment(event.id, event.title, event.dueDate, 'fulfilled')),
        asAppointment('demo-followup-041-tomorrow', 'Blood pressure follow-up', indiaDate(1)),
      ],
    },
    'synth-patient-071': {
      historicalCheckups: [],
      resources: [asAppointment('demo-followup-071-four-days', 'CKD review', indiaDate(4))],
    },
    'synth-patient-126': {
      historicalCheckups: [],
      resources: [asCompletedEncounter('demo-followup-126-derived', 'Blood pressure follow-up', indiaDate(-26))],
    },
    'synth-patient-146': {
      historicalCheckups: [],
      resources: [asAppointment('demo-followup-146-yesterday', 'Blood pressure follow-up', indiaDate(-1))],
    },
  };
};

const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};

const text = (value: unknown): string => typeof value === 'string' ? value : '';

const isFollowUpDemoResource = (resource: JsonObject): boolean =>
  text(resource.id).startsWith('demo-followup-')
  || (Array.isArray(resource.extension) && resource.extension.some((item) => object(item).valueString === DEMO_SOURCE));

const opaqueFollowUpId = (sourceIdentity: string): string =>
  `cfu_${createHash('sha256').update(sourceIdentity).digest('hex').slice(0, 24)}`;

const readEnvironment = async (): Promise<Env> => {
  const raw = await readFile(resolve(process.cwd(), '.env'), 'utf8');
  return raw.split(/\r?\n/).reduce<Env>((result, line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) result[match[1]] = match[2].trim();
    return result;
  }, {});
};

const required = (env: Env, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is not configured.`);
  return value;
};

async function refreshHistoricalAttendance(env: Env, scenarios: Record<string, DemoScenario>): Promise<void> {
  const pool = new Pool({
    host: required(env, 'DB_HOST'),
    port: Number(required(env, 'DB_PORT')),
    user: required(env, 'DB_USERNAME'),
    password: required(env, 'DB_PASSWORD'),
    database: required(env, 'DB_DATABASE'),
  });
  const tenantId = required(env, 'DEV_AUTH_TENANT_ID');

  try {
    for (const [patientId, scenario] of Object.entries(scenarios)) {
      if (scenario.historicalCheckups.length === 0) continue;
      const patientRef = `local-file:${patientId}`;
      const eventIds = scenario.historicalCheckups.map((event) => opaqueFollowUpId(event.id));

      // The script owns only these deterministic demo event IDs. Clearing them
      // first makes changing India-local dates rerunnable without duplicate rows.
      await pool.query(
        'DELETE FROM clinical_follow_up_attendance WHERE "tenantId" = $1 AND "patientRef" = $2 AND "eventId" = ANY($3::text[])',
        [tenantId, patientRef, eventIds],
      );

      for (const event of scenario.historicalCheckups) {
        const completedAt = `${event.dueDate}T10:20:00+05:30`;
        await pool.query(
          `INSERT INTO clinical_follow_up_attendance
            ("tenantId", "patientRef", "eventId", "dueDate", "dateSource", "attendanceStatus", "respondedAt", "createdAt")
           VALUES ($1, $2, $3, $4, 'EXPLICIT', 'COMPLETED', $5, $5)
           ON CONFLICT ("tenantId", "patientRef", "eventId", "dueDate")
           DO UPDATE SET "attendanceStatus" = EXCLUDED."attendanceStatus", "respondedAt" = EXCLUDED."respondedAt", "createdAt" = EXCLUDED."createdAt"`,
          [tenantId, patientRef, opaqueFollowUpId(event.id), event.dueDate, completedAt],
        );
      }
    }
  } finally {
    await pool.end();
  }
}

async function refresh(): Promise<void> {
  const env = await readEnvironment();
  const bundlesPath = required(env, 'LOCAL_PATIENT_BUNDLES_PATH');
  const bundles = JSON.parse(await readFile(bundlesPath, 'utf8')) as JsonObject[];
  const scenarios = scenarioResources();
  const updated = new Set<string>();

  for (const bundle of bundles) {
    const entries = Array.isArray(bundle.entry) ? bundle.entry.map(object) : [];
    const patientId = entries.map((entry) => object(entry.resource))
      .find((resource) => resource.resourceType === 'Patient')?.id;
    if (typeof patientId !== 'string' || !scenarios[patientId]) continue;

    const retained = entries.filter((entry) => !isFollowUpDemoResource(object(entry.resource)));
    const resources = scenarios[patientId].resources;
    bundle.entry = [...retained, ...resources.map((resource) => ({ fullUrl: `urn:uuid:${text(resource.id)}`, resource }))];
    updated.add(patientId);
  }

  const missing = Object.keys(scenarios).filter((id) => !updated.has(id));
  if (missing.length) throw new Error(`Configured FHIR bundle dataset is missing: ${missing.join(', ')}`);

  await writeFile(bundlesPath, `${JSON.stringify(bundles, null, 2)}\n`, 'utf8');
  await refreshHistoricalAttendance(env, scenarios);
  console.log(`Refreshed Android follow-up scenarios: ${Object.keys(scenarios).join(', ')}`);
  console.log('Historical completed checkups: synth-patient-001 = 3; synth-patient-041 = 1; synth-patient-161 remains a no-history control.');
}

void refresh();
