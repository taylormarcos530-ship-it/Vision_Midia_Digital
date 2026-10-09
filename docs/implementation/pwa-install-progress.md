# Convite de instalação — 09/10/2026

Usuário confirmou que a troca de ícone funcionou após reinstalar no Android.
Novo pedido: convite para instalar, oculto quando instalado, no máximo uma vez por dia ao visitar.
Base: branch de ícone verificada, 7e434beac063a1a801cdf2e9acf97d576d094458; produção anterior de código d5bdde616c062e2671fd3c75cd7b0d87a1621127.

Implementação:
- Convite acessível, dispensável, sem bloquear login; páginas index e Master.
- Dia do calendário local salvo no navegador quando o convite aparece, inclusive se fechado ou instalação cancelada.
- Chrome usa beforeinstallprompt e getInstalledRelatedApps; manifesto relacionado a si próprio sem mudar identidade/start_url/scope.
- Ao instalar ou abrir em standalone, marca instalado e esconde convite. Novo evento de instalação possível permite detectar desinstalação.
- Safari/iPhone oferece Compartilhar → Adicionar à Tela de Início e “Já instalei”. Fora do app, a instalação não é detectável em todos os navegadores.
- Sem persistência local (modo privado/restrições/limpeza dos dados), o limite diário pode ser reiniciado; não prometer detecção universal entre navegadores.
- Iframes não mostram convites duplicados. Player, service worker, app.js, master.js, APK e APIs anteriores intactos.

Verificação: 81/81 testes passaram, incluindo 8 novos cenários de convite, diário, instalação, Android alternativo e iPhone. git diff --check e comparação dos arquivos preservados passaram.
Publicado em produção em 09/10/2026: https://vision-midia-digital.vercel.app/index.html
Deployment: dpl_3ZhCfbaqcCoiLxmVpPjDD6WdYPK7 (READY), código 921f365b7f1ee5c7da7c96b74b3cdf1462e180c3, branch fix/pwa-install-invite.
HTTP final: index.html, master.html, pwa-install.js, pwa-install.css, manifest.webmanifest e app-icon-config retornaram 200 com tipos corretos. Index e Master carregam CSS/JS do convite; manifesto relaciona o próprio app e preserva ícone atual d4441b62-de01-4758-bc1e-971509279b03.
Pendências: testes físicos em Android/iPhone, incluindo navegador fora do app, instalação e visita no dia seguinte.
Nenhuma migration ou Edge Function Supabase alterada/publicada.
