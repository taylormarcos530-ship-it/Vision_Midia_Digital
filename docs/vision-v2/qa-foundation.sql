-- Vision Midia Digital V2 - F0: esquema QA isolado (sem dados reais).
-- Alvo EXCLUSIVO: Supabase yuwvgpvwgeowhgtxssvr, organizacao Ofertas TV.
-- NAO aplicar a Vision atual. NAO adicionar este schema em "Exposed schemas".
-- Nao ativa Edge, cron, limpeza de historico, Storage ou migracao de clientes.
create schema if not exists vision_v2_qa;
comment on schema vision_v2_qa is 'Estrutura sintética Vision V2; nao exposta por Data API e sem integracao com TVs';
revoke all on schema vision_v2_qa from public, anon, authenticated;

create table if not exists vision_v2_qa.companies (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 120),
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

create table if not exists vision_v2_qa.devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references vision_v2_qa.companies(id),
  label text not null check (char_length(label) between 1 and 120),
  manifest_revision bigint not null default 0 check (manifest_revision >= 0),
  last_seen_at timestamptz,
  last_heartbeat_write_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

-- Manifestos versionados: gravar somente quando a programacao for alterada,
-- nao quando a TV consulta a mesma revisao.
create table if not exists vision_v2_qa.manifest_revisions (
  device_id uuid not null references vision_v2_qa.devices(id),
  revision bigint not null check (revision > 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz not null default now(),
  primary key (device_id, revision)
);

-- Identidades pequenas e duraveis contra reenvio duplicado, mesmo
-- quando os recibos brutos forem futuramente compactados.
-- SHA-256 deve ser calculado pelo backend sobre o ID original autenticado.
create table if not exists vision_v2_qa.playback_event_keys (
  device_id uuid not null references vision_v2_qa.devices(id),
  event_sha256 bytea not null check (octet_length(event_sha256) = 32),
  received_at timestamptz not null default now(),
  primary key (device_id, event_sha256)
);

-- Recibos recentes; por enquanto, sem exclusao/retencao automatica.
create table if not exists vision_v2_qa.playback_recent (
  receipt_id bigint generated always as identity primary key,
  company_id uuid not null,
  device_id uuid not null,
  media_id uuid not null,
  event_sha256 bytea not null check (octet_length(event_sha256) = 32),
  played_at timestamptz not null,
  received_at timestamptz not null default now(),
  completed boolean not null,
  duration_seconds numeric(12,3) not null default 0
    check (duration_seconds >= 0 and duration_seconds <= 86400),
  foreign key (company_id, device_id) references vision_v2_qa.devices(company_id, id),
  unique (device_id, event_sha256)
);

-- Resumos comerciais independentes do bruto; nenhum dado e removido
-- enquanto relatorio hibrido, backup e ledger nao forem homologados.
create table if not exists vision_v2_qa.playback_daily (
  company_id uuid not null,
  day date not null,
  device_id uuid not null,
  media_id uuid not null,
  starts bigint not null default 0 check (starts >= 0),
  completes bigint not null default 0 check (completes >= 0),
  total_seconds numeric(18,3) not null default 0 check (total_seconds >= 0),
  first_play timestamptz,
  last_play timestamptz,
  primary key (company_id, day, device_id, media_id),
  foreign key (company_id, device_id) references vision_v2_qa.devices(company_id, id),
  check (completes <= starts)
);

-- Nenhum acesso direto anon/authenticated. O futuro gateway deve fazer
-- verificacao de token/empresa antes de usar credenciais secretas no servidor.
alter table vision_v2_qa.companies enable row level security;
alter table vision_v2_qa.devices enable row level security;
alter table vision_v2_qa.manifest_revisions enable row level security;
alter table vision_v2_qa.playback_event_keys enable row level security;
alter table vision_v2_qa.playback_recent enable row level security;
alter table vision_v2_qa.playback_daily enable row level security;
revoke all on all tables in schema vision_v2_qa from public, anon, authenticated;
revoke all on all sequences in schema vision_v2_qa from public, anon, authenticated;

-- Nao criar endpoints, usuarios, chaves, policies permissivas nem jobs nesta fase.
