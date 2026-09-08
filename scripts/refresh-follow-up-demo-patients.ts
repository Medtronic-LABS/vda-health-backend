import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

const DEMO_SOURCE = 'VDA_SYNTHETIC_FOLLOW_UP_DEMO';

type JsonObject = Record<string, unknown>;

const indiaDate = (offsetDays: number): string => {
  const fields = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => fields.find((field) => field.type === type)?.value || '';
  const date = new Date(Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')) + offsetDays));
  return date.toISOString().slice(0, 10);
};

const asAppointment = (id: string, title: string, dueDate: string): JsonObject => ({
  resourceType: 'Appointment', id, status: 'booked', serviceType: [{ text: title }],
  start: `${dueDate}T10:00:00+05:30`, end: `${dueDate}T10:20:00+05:30`,
  extension: [{ url: 'source', valueString: DEMO_SOURCE }],
});

const asCompletedEncounter = (id: string, title: string, visitDate: string): JsonObject => ({
  resourceType: 'Encounter', id, status: 'finished', type: [{ text: title }],
  period: { start: `${visitDate}T10:00:00+05:30`, end: `${visitDate}T10:20:00+05:30` },
  extension: [{ url: 'source', valueString: DEMO_SOURCE }],
});

const scenarioResources = (): Record<string, JsonObject> => ({
  'synth-patient-001': asAppointment('demo-followup-001-today', 'Diabetes follow-up', indiaDate(0)),
  'synth-patient-041': asAppointment('demo-followup-041-tomorrow', 'Blood pressure follow-up', indiaDate(1)),
  'synth-patient-071': asAppointment('demo-followup-071-four-days', 'CKD review', indiaDate(4)),
  'synth-patient-126': asCompletedEncounter('demo-followup-126-derived', 'Blood pressure follow-up', indiaDate(-26)),
  'synth-patient-146': asAppointment('demo-followup-146-yesterday', 'Blood pressure follow-up', indiaDate(-1)),
});

const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};

const text = (value: unknown): string => typeof value === 'string' ? value : '';

const isFollowUpDemoResource = (resource: JsonObject): boolean =>
  text(resource.id).startsWith('demo-followup-')
  || (Array.isArray(resource.extension) && resource.extension.some((item) => object(item).valueString === DEMO_SOURCE));

const configuredBundlesPath = async (): Promise<string> => {
  const env = await readFile(resolve(process.cwd(), '.env'), 'utf8');
  const match = env.match(/^LOCAL_PATIENT_BUNDLES_PATH=(.+)$/m);
  if (!match?.[1]?.trim()) throw new Error('LOCAL_PATIENT_BUNDLES_PATH is not configured.');
  return match[1].trim();
};

async function refresh(): Promise<void> {
  const bundlesPath = await configuredBundlesPath();
  const bundles = JSON.parse(await readFile(bundlesPath, 'utf8')) as JsonObject[];
  const scenarios = scenarioResources();
  const updated = new Set<string>();

  for (const bundle of bundles) {
    const entries = Array.isArray(bundle.entry) ? bundle.entry.map(object) : [];
    const patientId = entries.map((entry) => object(entry.resource))
      .find((resource) => resource.resourceType === 'Patient')?.id;
    if (typeof patientId !== 'string' || !scenarios[patientId]) continue;

    const retained = entries.filter((entry) => !isFollowUpDemoResource(object(entry.resource)));
    retained.push({ fullUrl: `urn:uuid:${text(scenarios[patientId].id)}`, resource: scenarios[patientId] });
    bundle.entry = retained;
    updated.add(patientId);
  }

  const missing = Object.keys(scenarios).filter((id) => !updated.has(id));
  if (missing.length) throw new Error(`Configured FHIR bundle dataset is missing: ${missing.join(', ')}`);

  await writeFile(bundlesPath, `${JSON.stringify(bundles, null, 2)}\n`, 'utf8');
  console.log(`Refreshed Android follow-up scenarios: ${Object.keys(scenarios).join(', ')}`);
  console.log('Control patient synth-patient-161 was intentionally not modified.');
}

void refresh();
