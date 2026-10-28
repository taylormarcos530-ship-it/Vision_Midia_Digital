# Vision Mídia Digital — redução de tráfego do servidor (somente QA, 28/10/2026)

## Situação e objetivo
- **Não publicar em produção até homologação.** Nenhum APK, tela, painel, arquivo de download, assinatura ou configuração de TV foi alterado nesta proposta.
- Baseline observado nos logs Supabase da produção, janela aproximada de 24h em 28/10/2026:
  - 901.866 registros de acesso no gateway (edge_logs, **não** equivale automaticamente a 901.866 invocações de Edge Functions faturáveis);
  - aproximadamente 70.316 invocações da Edge Function `device-gateway`;
  - mais de 220 mil requisições de geração de URL assinada para mídias privadas;
  - aproximadamente 24.729 respostas HTTP 403 para `/rest/v1/device_group_members`;
  - `has_table_privilege('service_role','public.device_group_members','SELECT')` retornou `false`.
- A otimização de escrita de credenciais e limpeza de pareamento condicionada já está presente no `device-gateway` implantado (v19). Esta proposta preserva essas correções.

## Alterações isoladas no código do backend
1. Reutilizar URLs assinadas já geradas, com cache **somente em memória da instância da Edge Function** por até 30 minutos (bem abaixo da validade de 6 horas da URL); máximo 256 entradas, substituição LRU e coalescência de chamadas simultâneas.
2. Chave de cache contém ID da empresa, ID da mídia, caminho de armazenamento e `updated_at`, evitando compartilhamento entre clientes ou reutilização após alteração do ativo.
3. Falhas de assinatura **não** são armazenadas. A próxima requisição pode repetir a tentativa, preservando o tratamento atual de erro.
4. Enquanto a tabela opcional `device_group_members` continuar recusando SELECT (SQLSTATE 42501), a instância reduz consultas repetitivas por 15 minutos e retenta depois. **Isso não concede permissões nem habilita grupos**. Continua o comportamento anterior de ignorar grupos quando a consulta não é autorizada.
5. Autenticação dos dispositivos, autorização Master/assinaturas, regras de acesso, playlist e geração de relatórios permanecem avaliadas a cada chamada aplicável — nada disso passa pelo cache.

## Correção de permissão proposta, NÃO aplicada
A melhor correção definitiva da falha 403, sujeita à revisão da estrutura e às políticas de acesso, é conceder SELECT **exclusivamente** ao papel de backend `service_role`, sem novas permissões para `anon` ou `authenticated`:

```sql
-- REVISÃO / HOMOLOGAÇÃO APENAS. NÃO EXECUTADO EM PRODUÇÃO.
grant select on table public.device_group_members to service_role;
select has_table_privilege('service_role', 'public.device_group_members', 'SELECT');
```

Antes de aplicar, revisar RLS, políticas da tabela e escopo dos consumidores; testar consulta via Edge Function em homologação. Em produção, executar somente após backup, homologação e janela de mudança. Evitar habilitar privilégios amplos para clientes.

## Validação obrigatória
- CI executa testes de reutilização, expiração, isolamento entre empresas, concorrência, erro e limite do cache.
- Testes estáticos exigem autenticação de TV, verificação de assinatura e comportamento de fallback de grupos preservados.
- No ambiente isolado, confirmar pareamento, manifest, troca de mídia, programação, revogação de acesso, retorno offline e consumo de Storage.
- Medir tráfego HTTP por rota e quantidade de links temporários por TV antes/depois em janelas comparáveis; o ganho real depende da quantidade de TVs, frequência de manifest e instâncias Edge ativas.
- Confirmar que download e APK oficiais continuam com o mesmo SHA-256, e que não houve alteração em `main`, no deploy Vercel de produção ou na função `device-gateway` implantada.

**Estado desta proposta:** código de QA somente; sem implantação, migração SQL ou teste E2E com TV real. O projeto Supabase de homologação foi listado como INACTIVE em 28/10/2026.
