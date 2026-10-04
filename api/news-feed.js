const SOURCES = {
  soccer: 'https://www.espn.com/espn/rss/soccer/news',
  sports_br: 'https://www.mg.superesportes.com.br/rss/noticias/futebol/futebol-nacional/rss.xml'
};
function clean(value='') { return String(value).replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim(); }
function tag(block,name) { const match=block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i')); return match ? clean(match[1]) : ''; }
export default async function handler(req,res) {
  const source=String(req.query?.source||'soccer'), url=SOURCES[source]||SOURCES.soccer;
  try {
    const response=await fetch(url,{headers:{'User-Agent':'VisionMidiaDigital/1.0'}});
    if(!response.ok) throw new Error('Fonte respondeu HTTP '+response.status);
    const xml=await response.text();
    const items=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,12).map(match=>({title:tag(match[1],'title'),description:tag(match[1],'description'),link:tag(match[1],'link'),published_at:tag(match[1],'pubDate')})).filter(item=>item.title);
    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ok:true,source,items,updated_at:new Date().toISOString()});
  } catch(error) { res.status(502).json({ok:false,error:String(error?.message||error)}); }
}