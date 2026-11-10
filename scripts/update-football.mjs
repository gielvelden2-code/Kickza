import fs from 'node:fs';
const key=process.env.API_FOOTBALL_KEY;
if(!key){console.error('API_FOOTBALL_KEY ontbreekt');process.exit(1)}
const base='https://v3.football.api-sports.io/';
const get=async (path)=>{const r=await fetch(base+path,{headers:{'x-apisports-key':key}});if(!r.ok)throw Error('API '+r.status);const j=await r.json();if(j.errors&&Object.keys(j.errors).length)throw Error(JSON.stringify(j.errors));return j.response||[]};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let fixtures=[];try{fixtures=await get('fixtures?date='+today+'&timezone=Europe%2FAmsterdam')}catch(e){console.warn('Fixtures unavailable: '+e.message)}
const payload={source:'API-Football',date:today,updatedAt:new Date().toISOString(),fixtures:fixtures.map(x=>({id:x.fixture.id,league:x.league.name,country:x.league.country,flag:x.league.flag,home:x.teams.home.name,away:x.teams.away.name,homeLogo:x.teams.home.logo,awayLogo:x.teams.away.logo,h:x.goals.home,a:x.goals.away,status:x.fixture.status.short,minute:x.fixture.status.elapsed,time:x.fixture.date,events:(x.events||[]).map(e=>({minute:e.time.elapsed,team:e.team.name,player:e.player.name,assist:e.assist.name,type:e.type,detail:e.detail}))}))};

const previous=fs.existsSync('data/catalog.json')?JSON.parse(fs.readFileSync('data/catalog.json','utf8')):{};
const leagues=new Map((previous.leagues||[]).filter(x=>x?.id).map(x=>[x.id,x])),teams=new Map();
for(const f of fixtures){const l=f.league,t=f.teams;leagues.set(l.id,{id:l.id,name:l.name,country:l.country,logo:l.logo,flag:l.flag,season:l.season});for(const team of [t.home,t.away])teams.set(team.id,{id:team.id,name:team.name,logo:team.logo,country:l.country,league:l.name,leagueId:l.id})}
for(const t of previous.teams||[]){if(t?.id&&!teams.has(t.id))teams.set(t.id,t)}
const now=Date.now(),fresh=previous.updatedAt&&now-new Date(previous.updatedAt).getTime()<24*3600*1000;
let catalog={updatedAt:new Date().toISOString(),leagues:[...leagues.values()],teams:[...teams.values()],squads:previous.squads||{},statistics:previous.statistics||{},playerStatistics:previous.playerStatistics||{},discoveryCursor:previous.discoveryCursor||0,playerStatsCursor:previous.playerStatsCursor||0};
if(!fresh){
  const preferred=['PSV','Ajax','Feyenoord','Real Madrid','FC Barcelona','Manchester City','Arsenal','Liverpool'];
  let count=0;
  for(const name of preferred){let team=[...teams.values()].find(t=>t.name.toLowerCase()===name.toLowerCase());if(count>=2)continue;if(!team){try{const found=await get('teams?search='+encodeURIComponent(name));const item=found.find(x=>x.team.name.toLowerCase()===name.toLowerCase())||found[0];if(item){team={id:item.team.id,name:item.team.name,logo:item.team.logo,country:item.team.country,league:'',leagueId:null};teams.set(team.id,team);catalog.teams.push(team)}}catch(e){console.warn('Team lookup skipped: '+e.message)}}if(!team)continue;
    try{const response=await get('players/squads?team='+team.id);catalog.squads[team.id]=(response[0]?.players||[]).map(p=>({id:p.id,name:p.name,age:p.age,number:p.number,position:p.position,photo:p.photo}));count++}catch(e){console.warn('Squad skipped: '+e.message)}
  }
  const finished=fixtures.filter(f=>['FT','1H','2H','HT'].includes(f.fixture.status.short)).slice(0,1);
  for(const fixture of finished){try{const data=await get('fixtures/statistics?fixture='+fixture.fixture.id);catalog.statistics[fixture.fixture.id]=data.map(x=>({team:x.team.name,stats:x.statistics.map(z=>({type:z.type,value:z.value}))}))}catch(e){console.warn('Stats skipped: '+e.message)}}
}else catalog.updatedAt=previous.updatedAt;


// Enrich the catalog progressively, within the provider's daily API allowance.
// All leagues are metadata only until team data is available; never invent squads.
if(!fresh){
  try{
    const allLeagues=await get('leagues?current=true');
    for(const entry of allLeagues){
      const l=entry.league,c=entry.country,season=(entry.seasons||[]).find(x=>x.current)||entry.seasons?.at(-1);
      if(!l?.id||!season?.year)continue;
      leagues.set(l.id,{id:l.id,name:l.name,country:c?.name||'World',logo:l.logo,flag:c?.flag||null,season:season.year,type:l.type||'League'});
    }
  }catch(e){console.warn('League discovery skipped: '+e.message)}
  const candidates=[...leagues.values()].filter(l=>l.type!=='Cup'&&l.season&&l.id).sort((a,b)=>{
    const preferred=['Netherlands','England','Spain','Germany','Italy','France','Portugal','Belgium'];
    const score=x=>{const i=preferred.indexOf(x.country);return i<0?100:i};
    return score(a)-score(b)||a.id-b.id;
  });
  const offset=Number(previous.discoveryCursor||0)%Math.max(1,candidates.length);
  for(let i=0;i<Math.min(3,candidates.length);i++){
    const l=candidates[(offset+i)%candidates.length];
    try{
      const entries=await get('teams?league='+l.id+'&season='+l.season);
      for(const entry of entries){const t=entry.team;if(!t?.id)continue;teams.set(t.id,{id:t.id,name:t.name,logo:t.logo,country:l.country,league:l.name,leagueId:l.id});}
    }catch(e){console.warn('League teams skipped: '+l.name+' '+e.message)}
  }
  catalog.discoveryCursor=offset+Math.min(3,candidates.length);
}
catalog.leagues=[...leagues.values()];
catalog.teams=[...teams.values()];


// Player statistics are fetched from the licensed provider for a small rotating
// sample; missing values remain unavailable rather than being fabricated.
if(!fresh){
 const teamsWithSquads=Object.keys(catalog.squads||{}).filter(id=>(catalog.squads[id]||[]).length);
 const cursor=Number(previous.playerStatsCursor||0);
 for(const id of teamsWithSquads.slice(cursor%Math.max(1,teamsWithSquads.length),cursor%Math.max(1,teamsWithSquads.length)+1)){
  const team=teams.get(Number(id));if(!team?.leagueId)continue;
  const league=leagues.get(team.leagueId);if(!league?.season)continue;
  try{
   const entries=await get('players?team='+id+'&season='+league.season+'&page=1');
   for(const entry of entries){
    const p=entry.player,st=entry.statistics?.[0];if(!p?.id||!st)continue;
    const metrics=[['Wedstrijden',st.games?.appearences],['Basisplaatsen',st.games?.lineups],['Minuten',st.games?.minutes],['Doelpunten',st.goals?.total],['Assists',st.goals?.assists],['Gele kaarten',st.cards?.yellow],['Rode kaarten',st.cards?.red],['Schoten op doel',st.shots?.on],['Passnauwkeurigheid',st.passes?.accuracy]];
    catalog.playerStatistics[p.id]=metrics.filter(x=>x[1]!==null&&x[1]!==undefined).map(([label,value])=>({label,value}));
   }
  }catch(e){console.warn('Player stats skipped: '+e.message)}
 }
 catalog.playerStatsCursor=cursor+1;
}

// Maintain a rolling historical archive without copying third-party website content.
const historyPath='data/history.json';
const oldHistory=fs.existsSync(historyPath)?JSON.parse(fs.readFileSync(historyPath,'utf8')):{fixtures:[]};
const archive=new Map((oldHistory.fixtures||[]).map(f=>[f.id,f]));
const normalize=x=>({id:x.fixture.id,league:x.league.name,country:x.league.country,flag:x.league.flag,home:x.teams.home.name,away:x.teams.away.name,homeLogo:x.teams.home.logo,awayLogo:x.teams.away.logo,h:x.goals.home,a:x.goals.away,status:x.fixture.status.short,minute:x.fixture.status.elapsed,time:x.fixture.date});
for(const f of fixtures)archive.set(f.fixture.id,{...archive.get(f.fixture.id),...normalize(f)});
const lastHistory=oldHistory.backfillAt?new Date(oldHistory.backfillAt).getTime():0;
let backfillAt=oldHistory.backfillAt||null;
if(Date.now()-lastHistory>23*3600*1000 && fixtures.length){
 try{
  const end=new Date(today+'T12:00:00Z'),start=new Date(end);start.setUTCDate(start.getUTCDate()-7);
  const fmt=d=>d.toISOString().slice(0,10);
  const older=await get('fixtures?from='+fmt(start)+'&to='+fmt(end)+'&timezone=Europe%2FAmsterdam');
  for(const f of older)archive.set(f.fixture.id,{...archive.get(f.fixture.id),...normalize(f)});
  backfillAt=new Date().toISOString();
 }catch(e){console.warn('Historical backfill skipped: '+e.message)}
}
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync(historyPath,JSON.stringify({source:'API-Football',updatedAt:new Date().toISOString(),backfillAt,fixtures:[...archive.values()].sort((a,b)=>b.time.localeCompare(a.time)).slice(0,10000)}));
fs.mkdirSync('data',{recursive:true});fs.writeFileSync('data/catalog.json',JSON.stringify(catalog));
if(fixtures.length||!fs.existsSync('data/football.json'))fs.writeFileSync('data/football.json',JSON.stringify(payload));console.log('Updated '+payload.fixtures.length+' fixtures, '+catalog.teams.length+' teams, '+Object.keys(catalog.squads).length+' squads');
