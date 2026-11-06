// Publishes the NHA sources from Dr. Garima's email into a VDA knowledge base.
//  1. Relabels the Beneficiary Identification (BIS) PDF, already uploaded as
//     "2022051092.pdf", so Ayushman card questions can find it; re-processes,
//     approves and publishes it.
//  2. Uploads, approves and publishes the two NHA portal pages
//     (demo_logs/nha-sources/*.md).
// Safe to re-run: a document that is already ACTIVE is left as it is.
//
// Run it in your own terminal (credentials are read from the environment and
// never printed):
//   VDA_API=https://vda-api.mdtlabs.org/api/v1 VDA_ADMIN_ID=<id> VDA_ADMIN_PASSWORD=<password> node scripts/publish-nha-sources.mjs
// or set VDA_ADMIN_TOKEN (the admin portal's session token) instead of id/password.
// Add DRY_RUN=1 to only show what it would do.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.VDA_API;
if (!API) throw new Error('Set VDA_API, e.g. https://vda-api.mdtlabs.org/api/v1');
const DRY_RUN = process.env.DRY_RUN === '1';
const SOURCES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'demo_logs', 'nha-sources');

const NHA = {
  source: 'National Health Authority, Government of India',
  domain: 'government_schemes',
  language: 'en',
};
const BIS = {
  isIt: (doc) =>
    doc.title === '2022051092.pdf' ||
    doc.title === 'AB PM-JAY Beneficiary Identification Guidelines' ||
    String(doc.sourceUrl || '').includes('BeneficiaryIdentification'),
  labels: {
    ...NHA,
    title: 'AB PM-JAY Beneficiary Identification Guidelines',
    // The query normalizer sends Ayushman card application questions here.
    category: 'pmjay_operations',
    sourceUrl: 'https://hem.nha.gov.in/BeneficiaryIdentification.pdf',
    state: null,
  },
};
const PAGES = [
  {
    file: 'nha_pmjay_criteria_coverage.md',
    title: 'PM-JAY Coverage and Eligibility Criteria (NHA Integrated Portal)',
    category: 'pmjay_guideline',
    sourceUrl: 'https://nha.gov.in/criteria-coverage',
  },
  {
    file: 'nha_pmjay_packages_and_rates.md',
    title: 'PM-JAY Packages and Rates: What a Treatment Package Covers (NHA Integrated Portal)',
    category: 'health_benefit_packages',
    sourceUrl: 'https://nha.gov.in/PackagesAndRates',
  },
];

async function call(method, path, token, body) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: response.status, json };
}

async function signIn() {
  if (process.env.VDA_ADMIN_TOKEN) return process.env.VDA_ADMIN_TOKEN;
  const identifier = process.env.VDA_ADMIN_ID;
  const password = process.env.VDA_ADMIN_PASSWORD;
  if (!identifier || !password) throw new Error('Set VDA_ADMIN_TOKEN, or VDA_ADMIN_ID and VDA_ADMIN_PASSWORD.');
  const { status, json } = await call('POST', '/dev/auth/admin-login', null, { identifier, password });
  if (status >= 300 || !json?.token) throw new Error(`Admin sign-in failed (HTTP ${status}). Check the id and password.`);
  return json.token;
}

async function listDocs(token) {
  const { status, json } = await call('GET', '/admin/knowledge/documents', token);
  if (status >= 300) throw new Error(`Could not list documents (HTTP ${status}): ${JSON.stringify(json).slice(0, 200)}`);
  return Array.isArray(json) ? json : json.data || [];
}

/** Moves a document through process -> approve -> publish until it is ACTIVE. */
async function makeActive(token, doc, reprocess) {
  let current = doc;
  const step = async (action) => {
    if (DRY_RUN) return console.log(`  would ${action} "${current.title}"`);
    const { status, json } = await call('POST', `/admin/knowledge/documents/${current.id}/${action}`, token);
    if (status >= 300) throw new Error(`${action} failed for "${current.title}" (HTTP ${status}): ${JSON.stringify(json).slice(0, 300)}`);
    current = { ...current, ...(json?.data || json) };
    console.log(`  ${action}: now ${current.status}`);
  };
  if (reprocess || current.status === 'UPLOADED') await step('process');
  if (DRY_RUN || current.status === 'REVIEW_REQUIRED') await step('approve');
  if (DRY_RUN || current.status === 'APPROVED') await step('publish');
  if (!DRY_RUN && current.status !== 'ACTIVE') throw new Error(`"${current.title}" ended at ${current.status}, not ACTIVE.`);
}

async function publishBis(token, docs) {
  const doc = docs.find(BIS.isIt);
  console.log('\n1. Beneficiary Identification Guidelines (BIS PDF)');
  if (!doc) {
    console.log('  Not found. Upload https://hem.nha.gov.in/BeneficiaryIdentification.pdf in the admin portal first, then re-run.');
    return;
  }
  const labelled = doc.title === BIS.labels.title && doc.category === BIS.labels.category;
  if (doc.status === 'ACTIVE' && labelled) return console.log('  Already ACTIVE with the right labels; nothing to do.');
  if (!labelled) {
    if (DRY_RUN) console.log(`  would relabel "${doc.title}" (${doc.category}) to "${BIS.labels.title}" (${BIS.labels.category})`);
    else {
      const { status, json } = await call('PATCH', `/admin/knowledge/documents/${doc.id}`, token, BIS.labels);
      if (status >= 300) throw new Error(`Relabel failed (HTTP ${status}): ${JSON.stringify(json).slice(0, 300)}`);
      console.log(`  relabelled "${doc.title}" -> "${BIS.labels.title}"`);
    }
  }
  // Processing rebuilds the passages with the new labels.
  await makeActive(token, { ...doc, title: BIS.labels.title }, true);
}

async function publishPage(token, docs, page) {
  console.log(`\n${page.title}`);
  let doc = docs.find((item) => item.title === page.title);
  if (doc?.status === 'ACTIVE') return console.log('  Already ACTIVE; nothing to do.');
  if (!doc) {
    if (DRY_RUN) return console.log(`  would upload ${page.file} and publish it`);
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...NHA, title: page.title, category: page.category, sourceUrl: page.sourceUrl }))
      form.append(key, value);
    const content = await readFile(join(SOURCES, page.file));
    form.append('file', new Blob([content], { type: 'text/markdown' }), page.file);
    const { status, json } = await call('POST', '/admin/knowledge/documents', token, form);
    if (status === 409) {
      doc = (await listDocs(token)).find((item) => item.sourceUrl === page.sourceUrl || item.title === page.title);
      if (!doc) throw new Error(`"${page.file}" is already uploaded under another title; find it in the admin portal.`);
    } else if (status >= 300) {
      throw new Error(`Upload failed (HTTP ${status}): ${JSON.stringify(json).slice(0, 300)}`);
    } else {
      doc = json?.data || json;
      console.log(`  uploaded: ${doc.status}`);
    }
  }
  await makeActive(token, doc, false);
}

const token = await signIn();
const docs = await listDocs(token);
console.log(`Signed in. ${docs.length} documents in the knowledge base.${DRY_RUN ? ' DRY RUN: nothing will change.' : ''}`);
await publishBis(token, docs);
for (const page of PAGES) await publishPage(token, docs, page);
console.log('\nDone. Check the Knowledge Base screen in the admin portal: all three should show ACTIVE.');
