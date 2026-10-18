# Portal do Anunciante — limite de acesso e próximo bloqueio comercial

**Checkpoint isolado, 18/10/2026.** Usuário confirmou que a seleção de vídeos do Player de teste era apenas homologação, e pediu continuar a integração comercial.

## Regra de produto — separação de papéis

- **Anunciante (portal próprio):** login independente e leitura das campanhas, prévias de arquivos comerciais aprovados e registros de reprodução. Pode atualizar a senha; **não pode enviar, criar, alterar, ativar ou publicar anúncios comerciais**.
- **Estabelecimento (cliente/ponto):** mantém as permissões já existentes para suas **próprias mídias** e playlists. Esse upload operacional não equivale a publicar anúncios externos.
- **Master Vision:** único papel para cadastrar anunciantes, criar/pausar/ativar campanhas e selecionar mídia comercial e TVs autorizadas. Os próprios arquivos comerciais devem ter origem e aprovação controladas pela Vision.
- **Laboratório:** os campos de arquivo usam `blob:` local, CSP `connect-src 'none'` e não chamam APIs; não são um caminho para qualquer cliente publicar arquivos.

## Segurança conferida no Supabase de testes (somente consulta)

Supabase staging `jmiuitrrhtaeyrpuyohk`: nenhum `INSERT/UPDATE/DELETE` para `authenticated` nas tabelas comerciais de campanhas/revisões; `authenticated` não executa RPC `vision_commercial_save_campaign(uuid,jsonb)`; `service_role` pode fazê-lo via backend Master autenticado. A Storage operacional exige vínculo de empresa com papel owner/admin/operator.

A UI do anunciante também é só consulta. Avisos adicionais no portal, no Master e no laboratório tornam a distinção explícita; o novo teste de contrato garante que o acesso do anunciante não expanda indevidamente.

## Fase seguinte — sem ativação

A gestão oficial de campanhas ainda depende de integração comercial seletiva, preparo seguro da biblioteca de anúncios controlada pelo Master e homologação do gateway/Player no dispositivo real. O Supabase de produção ainda não tem as tabelas comerciais instaladas; a branch isolada diverge substancialmente do código publicado. **Não publicar branch inteira**.

**Proibições mantidas:** sem deploy de produção, merge, migrations no banco oficial, APK ou comandos na TV Life fundo. Preservar todas as mídias e playlists já ativas.
