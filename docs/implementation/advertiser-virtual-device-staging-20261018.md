# Vision Mídia Digital — virtual-device commercial staging gate

**Data:** 18/10/2026  
**Base:** `b209d18271ef4ddd9688051ab0cf395ae9b9f537`  
**Desenvolvimento isolado:** `fix/advertiser-staging-security-gate-20261018`  
**Ambiente de teste:** Supabase `jmiuitrrhtaeyrpuyohk` — **NUNCA** utilizar produção `fpadgedrgcxrrqflzhjt`.

## O que foi comprovado neste bloco

- Foi identificado que o staging é **mínimo** e não tem `device_credentials`, `device_playlist_assignments` ou `playlists` do sistema oficial. Portanto, é incorreto instalar o gateway oficial diretamente nesse Supabase compartilhado com Vision Menu.
- Implementado `commercial-virtual-gateway` (Edge Function **isolada**, v1 no staging, `verify_jwt=true`). Exige Master autenticado, `x-device-token` assinado HMAC/expiração máxima de 120 s, dispositivo e estabelecimento prefixados `LAB-VIRTUAL-` e URL exata do staging.
- O gateway virtual importa o helper real `augmentCommercial`; cria 6 itens locais fictícios, intercala apenas revisões comerciais ativas, assina mídia no Storage e recebe eventos com IDs vinculados à credencial virtual. Reenvio preserva contagem idempotente.
- Adicionado o acionador `commercial_virtual_trial` ao `master-admin` **exclusivo do staging**, publicado em v3 (`verify_jwt=true`). O ensaio gera uma imagem PNG de 1 pixel, cria empresa/TV/mídia/campanha fictícias, obtém manifesto e arquivo assinado pelo gateway remoto, envia quatro eventos fictícios e os reenvia, confere 2 conclusões válidas e elimina as linhas/arquivos de teste por seus IDs.
- A tela `master-advertisers-homologacao.html` tem botão **Testar entrega à TV virtual e relatório**. Nova Preview em `https://vision-midia-digital-kc0m2ilkw-vision-5529.vercel.app/master-advertisers-homologacao.html`.
- Regressão isolada **701/701 PASS** e Git HEAD `c59a1c7` na Preview. O gateway novo e o Master retornam HTTP 401 a tokens inválidos. A Preview Vercel está READY.
- Depois de publicar as funções, conferido staging: 0 TVs, 0 empresas, 0 mídias, 0 eventos, 0 revisões, 0 alvos, 0 agregados, 0 objetos Storage; 3 anunciantes, 2 campanhas existentes e 1 rascunho Vision Menu intactos.
- Vercel de produção **permanece** no commit `921f365b`; TV Life fundo, APK, playlists e gateway da produção não foram alterados.

## Estado pendente — NÃO declarar PASS do ensaio remoto ainda

**O botão autenticado ainda não foi acionado com a sessão Master de homologação.** Os 701 testes são locais; o HTTP 401 comprova o bloqueio a acesso inválido, mas ainda não comprova execução remota íntegra. Só declarar sucesso após uma mensagem de aprovação no botão **e** nova leitura no banco confirmando ausência de resíduos. Caso apareça erro, diagnosticar e corrigir a falha no staging, sem alterar clientes.

## Restrições de liberação final

Mesmo que a TV virtual remota passe, isso não comprova TV Box/APK físico ou a integração comercial em produção. O piloto na **Life fundo** só pode ocorrer depois de planejamento técnico específico, validação de compatibilidade e autorização explícita de mudança em aparelho/TV real; preservar 6 mídias do estabelecimento.

**Não instalar migrations genéricas do gateway oficial** no Supabase compartilhado, não promover Vercel, não publicar player/Edge de produção e não reiniciar homologações já aprovadas.
