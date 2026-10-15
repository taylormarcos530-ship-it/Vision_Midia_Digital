# Vision Mídia Digital — Checkpoint PostgreSQL com sessões independentes

**Origem preservada:** `74a203df3dff1c81018e3968cd4b69b3bec50772`.  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`.  
**Ambiente:** serviço descartável **PostgreSQL 16** dentro do GitHub Actions, acessado via `127.0.0.1:5432` no runner, com usuário/banco e senha sintéticos. **Não se conectou ao Supabase, a staging remoto nem à produção.**

## Artefatos desta etapa

- `tests/postgres-commercial-multisession-lab.py`: 12 cenários de banco SQL com sessões PostgreSQL independentes (biblioteca `psycopg2-binary` temporária). Não é importado pelo gateway nem pelo player.
- `.github/workflows/commercial-postgres-multisession-lab.yml`: inicializa um **container temporário** `postgres:16` no GitHub Actions, verifica a inalterabilidade de arquivos operacionais desde o baseline, instala o driver somente no runner e executa a bancada com travas explícitas de host, usuário e banco isolados.
- Este documento de resultados e limites; não foram criadas migrations nem alterados arquivos operacionais.

## Evidências observadas e resultados

**GitHub Actions PostgreSQL multi-sessão:** 12/12 cenários PASS, 0 FAIL:  
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38659537739

**GitHub Actions segurança geral:** 310/310 testes PASS, 0 FAIL, arquivos operacionais protegidos:  
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38659537685

### Cenários de múltiplas conexões efetivamente testados

1. **32 sessões PostgreSQL independentes** disputando o mesmo `(device_id,client_event_id)`: 1 aceita, 31 reconhecidas como reenvio idêntico; exatamente uma linha final.
2. **32 sessões** com IDs de eventos distintos para a mesma ocorrência comercial: exatamente 1 registro final, 31 colisões de ocorrência.
3. IDs de evento idênticos com escopo de TVs diferentes: uma ocorrência final por TV sem interferência entre elas.
4. Trinta e duas ocorrências diferentes com sessões independentes, seguida de novos reenvios: 32 aceitas, nenhuma contagem adicionada pelos retries.
5. Revogação antes do recebimento: tentativa antiga rejeitada; as seis mídias base de oficina não são modificadas.
6. Recibo aceito antes da revogação: fica no histórico; reenvio subsequente é deduplicado.
7. **Lock real `SELECT ... FOR UPDATE`:** uma transação de revogação mantém o lock da TV, enquanto outra sessão tenta confirmar; esta só prossegue após COMMIT, então recusa a programação revogada.
8. Segunda instrução SQL em uma transação causa violação UNIQUE: `ROLLBACK` remove até a primeira inserção não confirmada.
9. Recibo aceito com COMMIT e ACK ficticiamente perdido: reenvio de outra sessão encontra um único registro aceito.
10. Primeira entrega depois de 12 horas, com ocorrência expirada: recusada; playlists-base intactas.
11. Tentativa incompleta conta como tentativa, não como anúncio concluído.
12. Empresa/TV sintética incompatível é recusada, sem alterar o ledger.

As constraints `PRIMARY KEY (device_id,client_event_id)` e `UNIQUE (device_id,occurrence_id)` foram **executadas em PostgreSQL real dentro de container descartável**, não apenas inspecionadas como texto. O teste usa transações, `ON CONFLICT DO NOTHING` e leitura do relógio do servidor após obter lock. Isso é mais forte que a bancada anterior com uma única conexão PGlite.

## Limites e riscos ainda pendentes

- **Autenticação e autorização ainda fictícias:** os IDs verificados da TV/empresa são parâmetros fornecidos pelo teste. Não há autenticação real via token, RLS, Supabase Auth, Storage nem isolamento multi-tenant de produção.
- **Evidência de exibição:** o recibo `completed=true` continua uma declaração do player. Sem evidência do dispositivo físico ou protocolo homologado, não representa exibição auditada nem deve ser usado para cobrança automática.
- **Contrato de agenda e atribuição:** os fixtures não exercitam políticas reais de dias e horas, alterações do cliente, expiração comercial e todas as janelas de segmentação. O dia por chegada ao servidor difere da consolidação SQL existente por início da reprodução.
- **Falhas distribuídas:** o ensaio ainda não simula queda física do PostgreSQL, failover, PgBouncer, credenciais rotacionadas, isolamento `SERIALIZABLE`, impacto de muitas TVs ou interrupção do Android real. Reenvio após 48 horas segue sem política homologada.
- **Nada integrado ao gateway:** o `device-gateway/index.ts`, `player.js`, APK, `playback_logs`, playlists e funções Supabase reais continuam inalterados. Não afirmar que a rede comercial já utiliza esse mecanismo.
- **Duração do teste:** o container GitHub Actions é destruído após a execução; não constitui um projeto PostgreSQL persistente de homologação.

## Próximo portão — sem autorização para staging real

Antes de conectar uma infraestrutura isolada persistente, revisar: associação autenticada empresa/TV, RLS/Storage e planos de acesso, RLS de anunciantes, formatos dos eventos legados, expiração, rebalanceamento entre anúncios, contratos de publicação/cancelamento e reconciliação por dia. Avaliar, com autorização separada, um ensaio no Android TV Box física usando um player de laboratório isolado, sem modificar os players em uso.

### Reversão preservando operação

Em eventual falha futura do módulo comercial, interromper **somente** novas emissões de anúncios; manter ou retomar a playlist de mídias do estabelecimento e o estado `Aguardando playlist` para TVs não atribuídas. Guardar registros aceitos para auditoria sem deletar `playback_logs`; corrigir qualquer migration experimental apenas em staging aprovado, sem rollback destrutivo e sem deploy automático.

## Regras invioláveis

Não alterar `player.js`, `android-player/`, `supabase/functions/device-gateway/index.ts`, playlists, `public.playback_logs` ou qualquer dado real. Não promover para produção, não publicar Edge Functions, não executar migrations nem habilitar anúncios comerciais. **Aprovação explícita será necessária para qualquer integração operacional.**

**Próxima etapa segura:** auditoria estática de autenticação/autorização comercial e matriz de testes RLS usando apenas arquivos e fixtures locais; separar o que já está testado do que falta homologar em Supabase isolado.
