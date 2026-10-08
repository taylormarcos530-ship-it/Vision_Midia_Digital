/* Original daily reflections. Horoscope is entertainment, not an external forecast. */
var DailyContent = (() => {
  const signs = ['Áries','Touro','Gêmeos','Câncer','Leão','Virgem','Libra','Escorpião','Sagitário','Capricórnio','Aquário','Peixes'];
  const symbols = ['♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓'];
  const messages = [
    'Reserve um momento para ouvir antes de responder. Uma conversa tranquila pode abrir novos caminhos.',
    'Dê atenção ao que já está ao seu alcance. Pequenos passos também fazem parte de grandes mudanças.',
    'Cultive a curiosidade e compartilhe uma ideia. Aprender algo novo pode tornar o dia mais leve.',
    'Valorize quem caminha com você. Um gesto de carinho pode transformar uma rotina comum.',
    'Use sua energia para construir algo positivo. Reconheça também as conquistas de quem está por perto.',
    'Organize uma prioridade de cada vez. Deixe espaço para descansar e apreciar o que já realizou.',
    'Procure equilíbrio entre suas necessidades e as dos outros. Gentileza começa pelo respeito.',
    'Observe seus sentimentos com calma. Escolha uma atitude que ajude você a seguir em frente.',
    'Abra espaço para uma experiência diferente. Novas perspectivas podem nascer de coisas simples.',
    'Cuide dos seus compromissos sem esquecer de você. Constância combina melhor com pausas saudáveis.',
    'Compartilhe uma ideia e escute outras possibilidades. A colaboração pode enriquecer o seu dia.',
    'Encontre beleza nos detalhes. Música, natureza ou uma boa conversa podem renovar seu ânimo.'
  ];
  const verses = [
    ['Salmos 23:1','O Senhor é o meu pastor, nada me faltará.','Respire com calma e lembre-se de que você não precisa carregar tudo sozinho.'],
    ['1 Tessalonicenses 5:16','Regozijai-vos sempre.','Procure uma pequena razão para agradecer hoje. A alegria também vive nos gestos simples.'],
    ['1 Tessalonicenses 5:17','Orai sem cessar.','Faça uma pausa e transforme suas preocupações em uma oração sincera.'],
    ['1 João 4:8','Deus é amor.','Que suas escolhas de hoje expressem cuidado, respeito e amor por quem está ao seu lado.'],
    ['Salmos 119:105','Lâmpada para os meus pés é tua palavra, e luz para o meu caminho.','Não é preciso enxergar todo o caminho para dar o próximo passo com fé.'],
    ['Mateus 5:9','Bem-aventurados os pacificadores.','Escolha uma palavra que aproxime e uma atitude que leve paz à sua casa.'],
    ['1 Coríntios 16:14','Todas as vossas coisas sejam feitas com amor.','O cuidado que você coloca nas pequenas tarefas pode fazer diferença na vida de alguém.']
  ];
  function dayKey(date = new Date()) {
    const p = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const get = type => p.find(x=>x.type===type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function slot(now = Date.now()) { return Math.floor(now / 20000); }
  function card(type, index = slot(), day = dayKey()) {
    const n = Math.floor(Date.parse(day+'T12:00:00Z')/86400000);
    if(type === 'horoscope') { const i=((index%12)+12)%12; return {title:signs[i],symbol:symbols[i],text:messages[(n+i)%messages.length],reflection:'Mensagem original para entretenimento • '+day,position:i+1}; }
    const v=verses[n%verses.length]; return {title:'Versículo do dia',symbol:'✦',text:v[1],reflection:v[2],reference:v[0],position:1};
  }
  return {dayKey,slot,card};
})();
if(typeof document !== 'undefined') {
  const type=new URLSearchParams(location.search).get('type')==='horoscope'?'horoscope':'verse';
  let previous='';
  function render(){const day=DailyContent.dayKey(),index=type==='horoscope'?DailyContent.slot():0,key=day+':'+index;if(key===previous)return;previous=key;const c=DailyContent.card(type,index,day);document.body.dataset.type=type;document.getElementById('category').textContent=type==='horoscope'?'HORÓSCOPO DO DIA':'FÉ E REFLEXÃO';document.getElementById('date').textContent=day.split('-').reverse().join('/');for(const id of ['title','symbol','text','reflection'])document.getElementById(id).textContent=c[id];document.getElementById('reference').textContent=c.reference||`${c.position} / 12 signos`;}
  render();setInterval(render,1000);
}
