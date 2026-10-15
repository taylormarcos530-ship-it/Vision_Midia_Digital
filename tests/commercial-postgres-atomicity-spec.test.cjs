// Static contract checks only. NO SQL is executed or sent to a database.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const doc=fs.readFileSync('docs/implementation/commercial-postgres-atomicity-spec-only.md','utf8');
const tick=String.fromCharCode(96),fence=tick.repeat(3);
const sql=doc.split(fence+'sql\n')[1]?.split('\n'+fence)[0];

test('design contract is labeled non-executable and is documentation only',()=>{
 assert.match(doc,/SOMENTE ESPECIFICAÇÃO/);
 assert.match(doc,/NÃO EXECUTAR/);
 assert.match(doc,/NÃO É MIGRATION/);
 assert.ok(sql?.length>100);
 assert.match(doc,/sem DDL aplicada/);
});
test('isolated future tables are not in existing operational public schema',()=>{
 assert.match(sql,/lab_commercial\.device_epochs/);
 assert.match(sql,/lab_commercial\.playback_occurrences/);
 assert.match(sql,/lab_commercial\.playback_receipts/);
 assert.doesNotMatch(sql,/\b(?:ALTER|DELETE|TRUNCATE|DROP)\s+(?:TABLE|FROM)\s+public\./i);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*public\.playback_logs/i);
});
test('two unique keys separately protect repeated client events and repeated occurrences',()=>{
 assert.match(sql,/PRIMARY KEY \(device_id, client_event_id\)/);
 assert.match(sql,/UNIQUE \(device_id, occurrence_id\)/);
 assert.match(sql,/FOREIGN KEY \(device_id, occurrence_id, revision_id\)/);
 assert.match(sql,/REFERENCES lab_commercial\.playback_occurrences \(device_id, occurrence_id, revision_id\)/);
 assert.match(sql,/UNIQUE \(device_id, occurrence_id, revision_id\)/);
 assert.match(doc,/client_event_id_collision/);
});
test('feature is disabled by default and requires a synchronized program epoch',()=>{
 assert.match(sql,/commercial_enabled boolean NOT NULL DEFAULT false/);
 assert.match(sql,/program_epoch bigint NOT NULL/);
 assert.match(sql,/program_fingerprint text NOT NULL/);
 assert.match(doc,/mesmo lock em/);
 assert.match(doc,/atualizar/);
});
test('atomic receipt validates identity, row lock, transaction and conflict semantics',()=>{
 assert.match(doc,/token verificado pelo servidor/);
 assert.match(doc,/SELECT \.\.\. FOR UPDATE/);
 assert.match(doc,/todo/);
 assert.match(doc,/INSERT \.\.\. ON CONFLICT DO NOTHING RETURNING/);
 assert.match(doc,/COMMIT/);
 assert.match(doc,/reenvio idêntico/);
});
test('completed claim requires termination but remains only a player declaration',()=>{
 assert.match(sql,/CHECK \(NOT completed OR claimed_ended_at IS NOT NULL\)/);
 assert.match(doc,/RFC3339/);
 assert.match(doc,/não medição auditada da tela/);
 assert.match(doc,/completed=false/);
});
test('batch consolidation is independent and cannot block base playback',()=>{
 assert.match(doc,/lotes de 1 a 100 eventos/);
 assert.match(doc,/independentes/);
 assert.match(doc,/fora do caminho crítico/);
 assert.match(doc,/recomputar/);
 assert.match(doc,/não bloqueia/);
});
test('offline windows and legacy players are not prematurely approved',()=>{
 assert.match(doc,/12\/48 horas/);
 assert.match(doc,/players legados/i);
 assert.match(doc,/Aguardando playlist/);
 assert.match(doc,/nenhuma TV sem playlist recebe anúncios/);
});
test('rollback cannot delete operational data and staging needs approval',()=>{
 assert.match(doc,/desabilitar/);
 assert.match(doc,/Nunca executar/);
 assert.match(doc,/TRUNCATE/);
 assert.match(doc,/aprovação explícita/);
 assert.match(doc,/sem mudanças no APK\/player\/playlists/);
});
test('no production imports or automatic migrations are introduced',()=>{
 const gateway=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 const player=fs.readFileSync('player.js','utf8');
 assert.doesNotMatch(gateway,/commercial-postgres-atomicity-spec-only/);
 assert.doesNotMatch(player,/commercial-postgres-atomicity-spec-only/);
 const workflow=fs.readFileSync('.github/workflows/advertiser-portal-safety.yml','utf8');
 assert.match(workflow,/Protect live player, APK and operational APIs/);
 assert.match(workflow,/No secrets, APK build, remote SQL, Edge Function release, or production deploy/);
});
