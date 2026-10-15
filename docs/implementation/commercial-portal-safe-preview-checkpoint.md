# Vision Mídia Digital — Checkpoint de compatibilidade do portal e assinatura de prévias

**Origem:** `7466e3b2e828e9cfbda5a4c5110f04e5755762e8`  
**Branch de laboratório:** `fix/advertiser-portal-safety-20261013`  
**Escopo:** reforço mínimo de `commercial-ui.mjs` e novos testes offline, sem publicação, sem conexão com Supabase e sem atualizar player, APK ou gateway.

## Resultado

**GitHub Actions:** 341/341 testes aprovados, 0 falhas; verificação de proteção dos arquivos operacionais aprovada.  
https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38663451941

- `commercial-ui.mjs`: valida `commercialPreviewPath` antes de pedir assinatura da prévia. Aceita somente cópias imutáveis `commercial-ads/<uuid>` com extensões comerciais reconhecidas (ou sem extensão). Rejeita mídia operacional, caminhos relativos/traversal, extensões não permitidas e URLs com parâmetros embutidos no caminho.
- `loadThumbnails`: só solicita uma URL assinada por arquivo comercial aprovado, com validade solicitada de 60 segundos. Aceita uma resposta somente se origem **e pathname exato** coincidirem com o Supabase configurado e a cópia comercial pedida. Imagens/vídeos continuam usando seus elementos originais, sem alterar o funcionamento de login, sessões, campanhas, métricas, refresh ou layout.
- Se o Storage recusar a assinatura, a prévia falha de forma não bloqueante e mantém o card com `Prévia indisponível no momento.`.
- `tests/commercial-portal-safe-preview.test.cjs`: 10 cenários que validam renderização da resposta comercial reduzida, contadores, proteção de paths, geração da requisição correta, vídeo, rejeição de paths privados/traversal, isolamento das cópias, URL em outro domínio, URL de outro objeto, falha de assinatura e escape de caracteres HTML. Todos sem chamadas de rede real.

## Controles de segurança e limitações

A validação de caminho no navegador é apenas **defesa adicional**. Não substitui a política RLS, autorização da cópia comercial e assinatura de URL pelo Supabase Storage. Os testes de carregamento simulam o endpoint e o DOM; **não comprovam** que um Storage remoto real emitirá a URL, que tokens reais estão vinculados corretamente à empresa ou que a mídia é exibida fisicamente em um dispositivo Android TV.

O SQL principal `supabase/sql/advertiser-portal.sql` **permanece inalterado** nesta etapa, e nele ainda existe o achado da exposição de `source_storage_path`/`source_media_id` quando usado **sem** o patch de laboratório. A versão corrigida de GRANT por coluna e JSON explícito está apenas em `tests/fixtures/commercial-safe-projection-lab.sql`, testada com PGlite, sem migration nem deploy.

**Não liberar o portal comercial real com base somente neste checkpoint.** Para homologação de staging futura é obrigatório revisar o SQL de acesso, RPC, permissões por anunciante, Storage, autenticação e URLs assinadas sob identidades reais **de laboratório**.

## Preservação da operação

A comparação com o checkpoint anterior mostra somente dois arquivos alterados: `commercial-ui.mjs` (rotina de prévia) e o novo teste. Nenhum arquivo de player, APK, playlists, controle das TVs, backend operacional ou configuração de deploy sofreu alteração.

**Próximo bloco seguro:** teste de navegação e renderização do portal em Chromium real com a resposta reduzida e imagens/vídeos fictícios, incluindo simulação de recusa do Storage, erro de sessão, usuário bloqueado e visualização no celular; continuar offline, sem tocar na produção.

**Regras permanentes:** não aplicar migrations, publicar Edge Functions, alterar Supabase remoto, liberar anúncios comerciais ou promover deploy sem autorização explícita.
