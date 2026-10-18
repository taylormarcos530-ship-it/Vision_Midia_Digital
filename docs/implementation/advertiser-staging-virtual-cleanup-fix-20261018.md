# Vision Mídia Digital — correção da limpeza de revisões fictícias

**Causa comprovada:** a execução real do ensaio autenticado chegou a baixar mídia assinada, comunicar-se com o gateway virtual e iniciar a telemetria. A etapa posterior de limpeza falhou em função do trigger `private.vision_revision_immutable`, que bloqueia DELETE de todas as revisões, inclusive as criadas pelo próprio teste.

**Consequência constatada:** uma campanha `LAB-VIRTUAL-...` e uma revisão ficaram no banco de homologação, embora a TV, empresa, arquivo Storage e mídia fictícia tenham sido eliminados. A produção não foi modificada.

**Correção estritamente limitada ao staging:** `supabase/sql/staging-virtual-revision-cleanup-20261018.sql` mantém a imutabilidade de todas as revisões normais e de todos os UPDATEs; permite somente DELETE quando nome de campanha `LAB-VIRTUAL-<UUID>` é igual ao checksum UUID da revisão, nome da revisão `LAB ONLY - 1px`, caminhos dos arquivos são dois UUIDs em prefixos de laboratório definidos e `private.vision_staging_guard` identifica exatamente `jmiuitrrhtaeyrpuyohk`. O arquivo deve ser aplicado **somente no Supabase de homologação**, mediante verificação prévia do esquema.

**Aceitação pendente:** após aplicação, comprovar em transação revertida que revisão real ou UPDATE de revisão fictícia seguem proibidos e que a revisão órfã de laboratório pode ser excluída, sem transações de clientes. Em seguida eliminar somente campanha/revisão remanescentes identificadas e confirmar que `vision_menu_lab` permanece inalterado. Reexecutar o ensaio virtual uma vez, validar status e nova leitura de limpeza. Não liberar produção até PASS.

**Não executar:** deploy Vercel de produção, migrações de produção, alterações no gateway real, APK, playlists ou TV Life fundo.
