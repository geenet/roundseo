/**
 * CSV import: upload-and-preview, then a separate commit that reserves
 * capacity and creates monitors. Splitting the two steps lets the UI show
 * accepted/duplicate/invalid/over-limit counts before anything is created
 * (spec: Add and monitor backlinks, steps 4-5), and makes a retried commit
 * of the same import idempotent (AC2).
 */
import type { BacklinkImportPreview, BacklinkImportRowPreview, ImportRowStatus } from '../../shared/backlinks';
import { normalizeMonitorUrl, normalizeUrlForIdentity } from './url-identity';
import { newId } from './capacity';
import { BacklinkCapacityError, createBacklinkMonitor, addMonitorToList } from './monitors';
import { getBacklinkCapacity } from './capacity';

type Database = any;

export interface ColumnMapping {
  sourceUrl: string;
  targetUrl: string;
  anchor?: string;
  rel?: string;
  notes?: string;
  placementDate?: string;
}

const HEADER_ALIASES: Record<keyof ColumnMapping, string[]> = {
  sourceUrl: ['source_url', 'referring_page', 'referring_url', 'source'],
  targetUrl: ['target_url', 'target_page', 'target', 'destination', 'destination_url'],
  anchor: ['expected_anchor', 'anchor_text', 'anchor'],
  rel: ['expected_rel', 'rel', 'rel_attributes'],
  notes: ['notes', 'note'],
  placementDate: ['placement_date', 'first_seen', 'first_seen_at', 'date'],
};

interface ParsedRow { index: number; cells: Record<string, string> }

function parseCsv(text: string): { headers: string[]; rows: ParsedRow[] } {
  const delimiter = detectDelimiter(text);
  const lines = splitRows(text, delimiter);
  const headerLine = lines.shift() || [];
  const headers = headerLine.map(cell => cell.trim());
  const rows = lines.map((cells, index) => ({
    index,
    cells: headers.reduce<Record<string, string>>((acc, header, column) => { acc[header.toLowerCase()] = (cells[column] || '').trim(); return acc; }, {}),
  }));
  return { headers, rows };
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find(line => line.trim()) || '';
  const counts: [string, number][] = [',', '\t', ';'].map(delimiter => [delimiter, countOutsideQuotes(firstLine, delimiter)]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    else if (!quoted && line[i] === delimiter) count += 1;
  }
  return count;
}

function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; } else quoted = !quoted;
      continue;
    }
    if (!quoted && char === delimiter) { row.push(field); field = ''; continue; }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some(cell => cell.trim().length)) rows.push(row);
      row = []; field = '';
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some(cell => cell.trim().length)) rows.push(row);
  return rows;
}

function resolveMapping(headers: string[], mapping?: Partial<ColumnMapping>): ColumnMapping {
  const lowered = headers.map(header => header.toLowerCase());
  const resolve = (key: keyof ColumnMapping): string | undefined => {
    if (mapping?.[key]) return mapping[key]!.toLowerCase();
    return lowered.find(header => HEADER_ALIASES[key].includes(header));
  };
  const sourceUrl = resolve('sourceUrl');
  const targetUrl = resolve('targetUrl');
  if (!sourceUrl) throw new Error('No source-page column could be identified. Map a column to the source URL.');
  return { sourceUrl, targetUrl: targetUrl || '', anchor: resolve('anchor'), rel: resolve('rel'), notes: resolve('notes'), placementDate: resolve('placementDate') };
}

export async function previewBacklinkImport(
  db: Database, websiteId: string, organizationId: string, userId: string,
  csvText: string, idempotencyKey: string, options: { columnMapping?: Partial<ColumnMapping>; defaultListId?: string } = {},
): Promise<BacklinkImportPreview> {
  const existingImport = await db.prepare('SELECT * FROM backlink_imports WHERE website_id = ? AND idempotency_key = ?').bind(websiteId, idempotencyKey).first();
  if (existingImport) return loadImportPreview(db, String(existingImport.id));

  const { headers, rows } = parseCsv(csvText);
  const mapping = resolveMapping(headers, options.columnMapping);
  const { limit, used } = await getBacklinkCapacity(db, organizationId);
  let remaining = Math.max(limit - used, 0);

  const existingIdentities = await loadExistingIdentities(db, websiteId);
  const seenInFile = new Set<string>();
  const previews: Array<BacklinkImportRowPreview & { sourceNormalized?: string; targetNormalized?: string; matchMode: 'exact_page' }> = [];

  for (const row of rows) {
    const sourceUrlRaw = row.cells[mapping.sourceUrl] || '';
    const targetUrlRaw = mapping.targetUrl ? row.cells[mapping.targetUrl] || '' : '';
    const anchor = mapping.anchor ? row.cells[mapping.anchor] || null : null;
    const rel = mapping.rel ? row.cells[mapping.rel] || null : null;
    const notes = mapping.notes ? row.cells[mapping.notes] || null : null;
    const placementDate = mapping.placementDate ? row.cells[mapping.placementDate] || null : null;
    const base = { rowIndex: row.index, sourceUrl: sourceUrlRaw || null, targetUrl: targetUrlRaw || null, expectedAnchor: anchor, expectedRel: rel, notes, placementDate, matchMode: 'exact_page' as const };

    if (!sourceUrlRaw) { previews.push({ ...base, status: 'invalid', errorMessage: 'Source URL is required.' }); continue; }
    let sourceIdentity: ReturnType<typeof normalizeUrlForIdentity>;
    try { sourceIdentity = normalizeMonitorUrl(sourceUrlRaw, 'Source'); } catch (error) {
      previews.push({ ...base, status: 'invalid', errorMessage: error instanceof Error ? error.message : 'Invalid source URL.' }); continue;
    }

    if (!targetUrlRaw) {
      // Source-only row: remains a candidate until a target link is found (AC5).
      previews.push({ ...base, status: 'accepted', errorMessage: null, sourceNormalized: sourceIdentity.normalized });
      continue;
    }

    let targetIdentity: ReturnType<typeof normalizeUrlForIdentity>;
    try { targetIdentity = normalizeMonitorUrl(targetUrlRaw, 'Expected target'); } catch (error) {
      previews.push({ ...base, status: 'invalid', errorMessage: error instanceof Error ? error.message : 'Invalid target URL.' }); continue;
    }
    const identityKey = `${sourceIdentity.normalized}|${targetIdentity.normalized}|exact_page`;
    if (seenInFile.has(identityKey) || existingIdentities.has(identityKey)) {
      previews.push({ ...base, status: 'duplicate', errorMessage: null, sourceNormalized: sourceIdentity.normalized, targetNormalized: targetIdentity.normalized });
      continue;
    }
    seenInFile.add(identityKey);
    if (remaining <= 0) {
      previews.push({ ...base, status: 'over_limit', errorMessage: 'The workspace is at its active monitor capacity.', sourceNormalized: sourceIdentity.normalized, targetNormalized: targetIdentity.normalized });
      continue;
    }
    remaining -= 1;
    previews.push({ ...base, status: 'accepted', errorMessage: null, sourceNormalized: sourceIdentity.normalized, targetNormalized: targetIdentity.normalized });
  }

  const importId = newId('backlink_import');
  const now = new Date().toISOString();
  const counts = tally(previews);
  await db.prepare(`
    INSERT INTO backlink_imports (id, website_id, uploaded_by, status, column_mapping_json, default_list_id, idempotency_key, accepted_count, duplicate_count, invalid_count, over_limit_count, created_at)
    VALUES (?, ?, ?, 'previewed', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(importId, websiteId, userId, JSON.stringify(mapping), options.defaultListId || null, idempotencyKey, counts.accepted, counts.duplicate, counts.invalid, counts.overLimit, now).run();

  for (const preview of previews) {
    await db.prepare(`
      INSERT INTO backlink_import_rows (id, import_id, row_index, source_url, target_url, expected_anchor, expected_rel, notes, placement_date, row_status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(newId('row'), importId, preview.rowIndex, preview.sourceUrl, preview.targetUrl, preview.expectedAnchor, preview.expectedRel, preview.notes, preview.placementDate, preview.status, preview.errorMessage).run();
  }

  return loadImportPreview(db, importId);
}

export async function commitBacklinkImport(db: Database, importId: string, organizationId: string, userId: string): Promise<BacklinkImportPreview> {
  const header = await db.prepare('SELECT * FROM backlink_imports WHERE id = ?').bind(importId).first();
  if (!header) throw new Error('Import not found.');
  if (header.status === 'committed') return loadImportPreview(db, importId);

  const websiteId = String(header.website_id);
  const defaultListId = header.default_list_id ? String(header.default_list_id) : undefined;
  const rows = await db.prepare(`SELECT * FROM backlink_import_rows WHERE import_id = ? AND row_status = 'accepted' ORDER BY row_index ASC`).bind(importId).all();
  let importAnchorJobId: string | null = null;

  for (const row of rows.results || []) {
    const rowId = String(row.id);
    if (row.target_url) {
      try {
        const { monitor } = await createBacklinkMonitor(db, websiteId, organizationId, userId, {
          sourceUrl: String(row.source_url), expectedTargetUrl: String(row.target_url),
          expectedAnchor: row.expected_anchor ? String(row.expected_anchor) : undefined,
          expectedRel: row.expected_rel ? [String(row.expected_rel)] : undefined,
          notes: row.notes ? String(row.notes) : undefined,
          placementDate: row.placement_date ? String(row.placement_date) : undefined,
        });
        if (defaultListId) await addMonitorToList(db, defaultListId, monitor.id);
        await db.prepare(`UPDATE backlink_import_rows SET monitor_id = ? WHERE id = ?`).bind(monitor.id, rowId).run();
      } catch (error) {
        if (error instanceof BacklinkCapacityError) {
          await db.prepare(`UPDATE backlink_import_rows SET row_status = 'over_limit', error_message = ? WHERE id = ?`).bind(error.message, rowId).run();
        } else throw error;
      }
    } else {
      if (!importAnchorJobId) importAnchorJobId = await ensureImportAnchorJob(db, websiteId, importId, userId);
      const candidateId = newId('candidate');
      const now = new Date().toISOString();
      // Plain INSERT OR IGNORE (not a targeted ON CONFLICT) so it's deduped by whichever unique index
      // applies: the website_id+provider+source_url+target_url index for a known target, or the
      // partial website_id+provider+source_url index for target_url IS NULL (migration 014) — SQLite
      // treats every NULL as distinct, so the non-partial index alone never caught a source-only repeat.
      await db.prepare(`
        INSERT OR IGNORE INTO backlink_candidates (id, website_id, discovery_job_id, source_url, target_url, provider, provider_record_id, imported_at, enrollment_status)
        VALUES (?, ?, ?, ?, NULL, 'import', NULL, ?, 'pending')
      `).bind(candidateId, websiteId, importAnchorJobId, String(row.source_url), now).run();
      await db.prepare(`UPDATE backlink_import_rows SET candidate_id = ? WHERE id = ?`).bind(candidateId, rowId).run();
    }
  }

  const finalCounts = await db.prepare(`
    SELECT row_status, COUNT(*) AS count FROM backlink_import_rows WHERE import_id = ? GROUP BY row_status
  `).bind(importId).all();
  const tallyMap = new Map((finalCounts.results || []).map((r: any) => [String(r.row_status), Number(r.count)]));
  await db.prepare(`
    UPDATE backlink_imports SET status = 'committed', committed_at = ?, accepted_count = ?, duplicate_count = ?, invalid_count = ?, over_limit_count = ? WHERE id = ?
  `).bind(
    new Date().toISOString(),
    tallyMap.get('accepted') || 0, tallyMap.get('duplicate') || 0, tallyMap.get('invalid') || 0, tallyMap.get('over_limit') || 0,
    importId,
  ).run();

  return loadImportPreview(db, importId);
}

async function ensureImportAnchorJob(db: Database, websiteId: string, importId: string, userId: string): Promise<string> {
  const id = `discovery_import_${importId}`;
  await db.prepare(`
    INSERT INTO discovery_jobs (id, website_id, provider, status, budget_requested, retrieved_count, unique_count, duplicate_count, idempotency_key, requested_by, created_at, completed_at)
    VALUES (?, ?, 'import', 'complete', 0, 0, 0, 0, ?, ?, ?, ?)
    ON CONFLICT(website_id, idempotency_key) DO NOTHING
  `).bind(id, websiteId, `import:${importId}`, userId, new Date().toISOString(), new Date().toISOString()).run();
  return id;
}

async function loadExistingIdentities(db: Database, websiteId: string): Promise<Set<string>> {
  const rows = await db.prepare(`SELECT source_url_normalized, expected_target_normalized, match_mode FROM backlink_monitors WHERE website_id = ?`).bind(websiteId).all();
  return new Set((rows.results || []).map((row: any) => `${row.source_url_normalized}|${row.expected_target_normalized}|${row.match_mode}`));
}

function tally(previews: Array<{ status: ImportRowStatus }>): { accepted: number; duplicate: number; invalid: number; overLimit: number } {
  return previews.reduce((acc, row) => {
    if (row.status === 'accepted') acc.accepted += 1;
    else if (row.status === 'duplicate') acc.duplicate += 1;
    else if (row.status === 'invalid') acc.invalid += 1;
    else acc.overLimit += 1;
    return acc;
  }, { accepted: 0, duplicate: 0, invalid: 0, overLimit: 0 });
}

export async function loadImportPreview(db: Database, importId: string): Promise<BacklinkImportPreview> {
  const header = await db.prepare('SELECT * FROM backlink_imports WHERE id = ?').bind(importId).first();
  if (!header) throw new Error('Import not found.');
  const rows = await db.prepare('SELECT * FROM backlink_import_rows WHERE import_id = ? ORDER BY row_index ASC').bind(importId).all();
  return {
    importId: header.id,
    websiteId: header.website_id,
    status: header.status,
    acceptedCount: Number(header.accepted_count ?? 0),
    duplicateCount: Number(header.duplicate_count ?? 0),
    invalidCount: Number(header.invalid_count ?? 0),
    overLimitCount: Number(header.over_limit_count ?? 0),
    rows: (rows.results || []).map((row: any) => ({
      rowIndex: Number(row.row_index), sourceUrl: row.source_url, targetUrl: row.target_url,
      expectedAnchor: row.expected_anchor, expectedRel: row.expected_rel, notes: row.notes,
      placementDate: row.placement_date, status: row.row_status, errorMessage: row.error_message,
    })),
    createdAt: header.created_at,
    committedAt: header.committed_at,
  };
}
