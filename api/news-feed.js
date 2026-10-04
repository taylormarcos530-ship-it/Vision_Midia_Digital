const SOURCES = {
  soccer: 'https://ge.globo.com/rss/ge/futebol/brasileirao-serie-a/',
  sports_br: 'https://ge.globo.com/rss/ge/futebol/brasileirao-serie-a/',
  news_br: 'https://g1.globo.com/rss/g1/brasil/'
};
function clean(value='') { return String(value).replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim(); }
function tag(block,name) { const match=block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i')); return match ? clean(match[1]) : ''; }
export default async function handler(req,res) {
  const source=String(req.query?.source||'soccer'), url=SOURCES[source]||SOURCES.soccer;
  try {
    const response=await fetch(url,{headers:{'User-Agent':'VisionMidiaDigital/1.0'}});
    if(!response.ok) throw new Error('Fonte respondeu HTTP '+response.status);
    const xml=await response.text();
    if(!/<rss[\s>]/i.test(xml) || !/<language>\s*pt-BR\s*<\/language>/i.test(xml)) throw new Error('Fonte brasileira em português indisponível');
    const items=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,12).map(match=>({title:tag(match[1],'title'),description:tag(match[1],'description'),link:tag(match[1],'link'),published_at:tag(match[1],'pubDate')})).filter(item=>item.title);
    if(!items.length) throw new Error('Fonte sem notícias');
    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ok:true,source,items,updated_at:new Date().toISOString()});
  } catch(error) { res.status(502).json({ok:false,error:String(error?.message||error)}); }
}