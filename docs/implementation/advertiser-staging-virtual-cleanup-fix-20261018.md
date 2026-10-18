# Vision Mídia Digital — correção da limpeza de revisões fictícias

**Causa comprovada:** a execução real do ensaio autenticado chegou a baixar mídia assinada, comunicar-se com o gateway virtual e iniciar a telemetria. A etapa posterior de limpeza falhou em função do trigger `private.vision_revision_immutable`, que bloqueia DELETE de todas as revisões, inclusive as criadas pelo próprio teste.

**Consequência constatada:** uma campanha `LAB-VIRTUAL-...` e uma revisão ficaram no banco de homologação, embora a TV, empresa, arquivo Storage e mídia fictícia tenham sido eliminados. A produção não foi modificada.

**Correção estritamente limitada ao staging:** `supabase/sql/staging-virtual-revision-cleanup-20261018.sql` mantém a imutabilidade de todas as revisões normais e de todos os UPDATEs; permite somente DELETE quando nome de campanha `LAB-VIRTUAL-<UUID>` é igual ao checksum UUID da revisão, nome da revisão `LAB ONLY - 1px`, caminhos dos arquivos são dois UUIDs em prefixos de laboratório definidos e `private.vision_staging_guard` identifica exatamente `jmiuitrrhtaeyrpuyohk`. O arquivo deve ser aplicado **somente no Supabase de homologação**, mediante verificação prévia do esquema.

**Aceitação originalmente planejada (já executada, ver resultados abaixo):** após aplicação, comprovar em transação revertida que revisão real ou UPDATE de revisão fictícia seguem proibidos e que a revisão órfã de laboratório pode ser excluída, sem transações de clientes. Em seguida eliminar somente campanha/revisão remanescentes identificadas e confirmar que `vision_menu_lab` permanece inalterado. Reexecutar o ensaio virtual uma vez, validar status e nova leitura de limpeza. Não liberar produção até PASS.

**Não executar:** deploy Vercel de produção, migrações de produção, alterações no gateway real, APK, playlists ou TV Life fundo.

## Aplicação e verificação executadas

- Migration **staging_virtual_revision_cleanup_scoped_20261018** aplicada com sucesso somente em `jmiuitrrhtaeyrpuyohk`.
- `703/703` testes automatizados aprovados na branch isolada.
- Transação com `ROLLBACK` confirmou que a revisão LAB-VIRTUAL pode ser excluída e que um UPDATE da mesma revisão continua resultando em `immutable_revision`.
- Outra transação com `ROLLBACK` criou temporariamente uma revisão `LAB ONLY - 1px` vinculada a uma campanha normal de homologação; o DELETE dessa revisão foi corretamente bloqueado por `immutable_revision`. Assim, apenas o identificador LAB-VIRTUAL exato libera a exceção.
- A campanha e a revisão órfãs do ensaio real de 11h19 foram removidas por IDs e condições exatas, sem tocar nas duas campanhas de demonstração.
- Conferência após a limpeza: `vision_commercial_revisions=0`, `vision_commercial_campaigns=2`, `devices=0`, `storage.objects=0`, `vision_menu_lab.vision_menu_drafts=1`.
- Os logs do ensaio anterior registraram resposta HTTP 200 a duas chamadas de eventos pelo gateway virtual e download assinado HTTP 200. O Master finalizou em HTTP 503 durante a limpeza, coerente com o trigger imutável — causa confirmada por erro `P0001 immutable_revision`.

**Próxima verificação:** o usuário deve clicar uma única vez no botão `Testar entrega à TV virtual e relatório` na Preview já existente. A confirmação depende do status **APROVADO** e de nova conferência de ausência de resíduos. Não usar o botão em produção.
