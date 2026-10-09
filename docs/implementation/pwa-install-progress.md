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

Verificação: 80/80 testes passaram, incluindo 7 novos cenários de convite, diário, instalação e iPhone. git diff --check e comparação dos arquivos preservados passaram.
Pendências: publicação Vercel, HTTP final e testes físicos em Android/iPhone.
Nenhuma migration ou Edge Function Supabase alterada/publicada.
