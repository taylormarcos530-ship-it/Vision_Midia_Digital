from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'anchor_not_found:{label}:{path}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def append_once(path, marker, block):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if marker in text:
        return
    p.write_text(text.rstrip() + '\n\n' + block.strip() + '\n', encoding='utf-8')


replace_once(
    'index.html',
    '        <button class="nav-item" data-view="reports"><span>▤</span> Relatórios</button>\n        <div id="saas-admin-nav"',
    '        <button class="nav-item" data-view="reports"><span>▤</span> Relatórios</button>\n        <a class="nav-item nav-link-item" href="./downloads.html"><span>⇩</span> Aplicativos / Downloads</a>\n        <div id="saas-admin-nav"',
    'client-download-nav',
)

replace_once(
    'master.html',
    '        <button class="nav-button" data-master-view="audit">≡ Auditoria</button>\n      </nav>',
    '        <button class="nav-button" data-master-view="audit">≡ Auditoria</button>\n        <a class="nav-button nav-download-link" href="./downloads.html">⇩ Aplicativos / Downloads</a>\n      </nav>',
    'master-download-nav',
)

append_once('styles.css', '/* DOWNLOAD_CENTER_LINK */', r'''
/* DOWNLOAD_CENTER_LINK */
.nav-link-item{width:100%;text-decoration:none;color:inherit;cursor:pointer}
''')

append_once('master.css', '/* DOWNLOAD_CENTER_LINK */', r'''
/* DOWNLOAD_CENTER_LINK */
.nav-download-link{display:flex;align-items:center;text-decoration:none;color:inherit}
''')

p = Path('sw.js')
text = p.read_text(encoding='utf-8')
text = text.replace("const CACHE = 'vision-midia-shell-v8';", "const CACHE = 'vision-midia-shell-v9';", 1)
old = "  './master.html', './master.css', './master.js', './master-payment.js', './master-embed.js',\n  './player.html', './player.css', './player.js', './player.webmanifest'"
new = "  './master.html', './master.css', './master.js', './master-payment.js', './master-embed.js',\n  './downloads.html', './downloads.css', './downloads.js',\n  './player.html', './player.css', './player.js', './player.webmanifest'"
if new not in text:
    if old not in text:
        raise SystemExit('anchor_not_found:sw-download-shell')
    text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
