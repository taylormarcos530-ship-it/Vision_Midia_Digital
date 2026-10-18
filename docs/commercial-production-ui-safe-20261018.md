# Vision Mídia Digital — commercial UI release 18/10/2026
- Source baseline 921f365b7f1ee5c7da7c96b74b3cdf1462e180c3 (current Vercel production build).
- Additive UI only, copied from tested commercial branch: Master advertisers, advertiser portal, CSS and read-only demonstrators.
- All operational runtime unchanged: player.js, APK download, index.html, customer playlists, service workers, Vercel rewrites, backend scripts.
- Published Supabase key is the non-secret publishable key; authentication/RLS and Master authorization remain on the server.
- Master currently blocked at backend until explicitly approved; gateway remains hard disabled on every device.
- Production activation MUST first be validated as preview and then deployed from this exact baseline and commit, not by merging the entire feature branch.
