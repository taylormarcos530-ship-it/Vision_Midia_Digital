# Ícone do app — Vercel, 09/10/2026

Endereço confirmado pelo usuário: https://vision-midia-digital.vercel.app/index.html.
Alias verificado: dpl_FhWKceGCFzFZneb18GiVaTxsYw4T, commit ea967f19511f47c7705096ceaa07cda80460022f.
Patch mínimo sobre esse commit atualmente servido, sem restaurar outra versão.
Projeto prj_RlmVVQe6rGhaGDWDUafDfmygf2k3, equipe team_WPRNcARM6Smx7VtZGPduQrMI.

Menu Master “Trocar ícone / favicon”, prévia e upload com imagens PNG normalizadas.
Storage privado Vercel Blob store_9oNp42hAI1CwSaII, conectado ao mesmo projeto.
Credenciais somente no runtime; nenhuma chave privada nos fontes ou no navegador.
Autorização pela ação whoami do master-admin existente; somente admin/super_admin.
Escritas recusadas fora de produção. Origem obrigatória igual à do app.
Revisões imutáveis, publicação do ponteiro com ETag e detecção de conflito.
Manifesto mantém URL, nome, start_url e scope. Ícone inicial usa logo escolhida.
Player, APK de TV, sw.js, app.js, master.js e funções anteriores preservados sem alterações.
Nenhuma migration ou Edge Function Supabase aplicada/publicada.

Verificação local: 73/73 testes passaram, incluindo ícones, armazenamento e abertura do menu Master do app instalado; git diff --check passou.
Preview Vercel confirmado: manifesto dinâmico HTTP 200, application/manifest+json e Cache-Control no-store; configuração e três PNGs HTTP 200.
Manifesto estático removido para evitar precedência do filesystem do Vercel; a URL pública continua igual e é gerada pela função.
Botão também inserido no menu SaaS Master do index.html, pois o iframe Master embutido oculta a própria sidebar.
Pendente: deploy de produção e verificação HTTP final, troca autenticada real e celular instalado.
Navegadores podem pedir aceitação da nova imagem; iOS pode precisar adicionar novamente à Tela de Início.
Notificações fechadas e testes físicos anteriores ainda não comprovados por esta alteração.

## Publicação concluída

Deployment de produção dpl_8q7KSw2EcMw6Pr7gY6SfwfpxjKfY READY, código d5bdde616c062e2671fd3c75cd7b0d87a1621127.
Alias vision-midia-digital.vercel.app confirmado apontando para esse deployment em 09/10/2026.
Verificação no endereço principal: index, master, script, configuração, manifesto e três PNGs retornaram HTTP 200 com os tipos esperados. Manifesto e configuração sem cache.
Script confirmado no index e Master; menu SaaS Master do app instalado incluído.
Comparação Git do commit publicado com a versão anterior confirmou Player, APK/Android, service worker, app.js, master.js e APIs news-feed/player-proxy sem alterações.
Ainda falta a troca autenticada real pelo usuário e observar a atualização no launcher do celular; testes locais e HTTP não comprovam essa etapa física.
Próxima etapa: entrar como Master, abrir Trocar ícone / favicon, selecionar uma imagem e salvar; validar nova revisão no manifesto e aceitação no Android/iPhone. Não retomar APK nativo nem modificar Supabase sem novo escopo.
