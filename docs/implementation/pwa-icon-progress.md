# Ícone do aplicativo instalado — 09/10/2026

Usuário escolheu manter a instalação pelo navegador (PWA). APK nativo/FCM pausados.
Publicação do ícone azul e dourado e botão de troca no menu autorizados em 09/10/2026.

Base: commit dbf598641a829630b43967a299141ed14b701829, deploy atual Netlify 6ac278b1189de00009417126 no site b43723ce-1f6c-4cf1-ba3b-f8c8fdfd5b09 (visionmidiadigitalgo).
Checkout isolado corresponde ao commit efetivamente publicado; não é restauração de baseline.
Branch de trabalho fix/pwa-icon-menu. Não sobrescrever outras branches.

Implementado:
- Logo escolhida como fallback de primeira instalação, em 192/512 e formato maskable.
- Menu Master “Trocar ícone / favicon” com seletor, prévia e salvar.
- PNG normalizado no navegador e validado no servidor por dimensões, assinatura e CRC.
- Autorização do servidor usa a ação whoami da função master-admin existente; só admin/super_admin.
- Ícones salvos no Netlify Blobs do próprio site, fora de dados de empresas; nenhuma migration/Edge Function Supabase.
- Revisões imutáveis e publicação condicional do ponteiro, conflito HTTP 409; ícones antigos continuam acessíveis.
- URL do manifesto, start_url, scope, nome e modo standalone preservados.
- Favicon atualizado ao abrir/retornar ao app; a imagem do launcher depende da revisão pelo navegador.
- Escrita desabilitada fora do contexto de produção. Testes locais usam armazenamento em memória, não Blobs da produção.

Testes: npm test, 19/19 passaram (7 novos, 12 existentes). Build estático executado. Checagem de sintaxe e git diff --check passaram.
Player: git diff --exit-code HEAD -- android-player player.js player.css player.html sw.js passou, nenhum byte alterado.
Pendências: publicação Netlify, verificação HTTP pós-publicação, troca real autenticada e teste no celular instalado.
O navegador pode solicitar confirmação para a nova identidade; não prometer troca silenciosa/imediata em todos os celulares. No iOS pode exigir reinstalação do atalho.
Fontes públicos oficiais: https://developer.chrome.com/blog/improvements-to-web-app-updates e https://web.dev/learn/pwa/update.

Próxima etapa: publicar apenas este patch sobre a versão atual, preservando a função news-feed e demais arquivos; verificar manifesto/ícones/autorização/menu e registrar deploy real.
