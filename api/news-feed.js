const SOURCES = {
  soccer: 'https://ge.globo.com/rss/ge/futebol/brasileirao-serie-a/',
  sports_br: 'https://ge.globo.com/rss/ge/futebol/brasileirao-serie-a/',
  news_br: 'https://g1.globo.com/rss/g1/',
  cinema_br: 'https://cinepop.com.br/feed/'
};
function clean(value='') { return String(value).replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):''}).replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim(); }
function tag(block,name) { const match=block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i')); return match ? clean(match[1]) : ''; }
function imageUrl(block) {
  const decoded = block.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const matches = [...decoded.matchAll(/<(?:media:(?:content|thumbnail)|enclosure|img)\b[^>]*\b(?:url|src)=["']([^"']+)["']/gi)];
  for (const match of matches) {
    try {
      const url = new URL(match[1]);
      if (url.protocol === 'https:' && /(?:^|\.)(?:glbimg\.com|globo\.com|cinepop\.com\.br)$/.test(url.hostname)) return url.href;
    } catch {}
  }
  return '';
}
export default async function handler(req,res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const source=String(req.query?.source||'soccer'), url=SOURCES[source];
  if(!url) return res.status(400).json({ok:false,error:'Fonte desconhecida'});
  try {
    const response=await fetch(url,{headers:{'User-Agent':'VisionMidiaDigital/1.0'},signal:AbortSignal.timeout(8000)});
    if(!response.ok) throw new Error('Fonte respondeu HTTP '+response.status);
    const xml=await response.text();
    if(!/<rss[\s>]/i.test(xml) || !/<language>\s*pt-BR\s*<\/language>/i.test(xml)) throw new Error('Fonte brasileira em português indisponível');
    const items=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,12).map(match=>({title:tag(match[1],'title'),description:(tag(match[1],'atom:subtitle')||tag(match[1],'description')).slice(0,320),image_url:imageUrl(match[1]),link:tag(match[1],'link'),published_at:tag(match[1],'pubDate')})).filter(item=>item.title);
    if(!items.length) throw new Error('Fonte sem notícias');
    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ok:true,schema_version:2,language:'pt-BR',source,items,updated_at:new Date().toISOString()});
  } catch(error) { res.status(502).json({ok:false,error:String(error?.message||error)}); }
}
