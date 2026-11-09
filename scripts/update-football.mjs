import fs from 'node:fs';
const key=process.env.API_FOOTBALL_KEY;
if(!key){console.error('API_FOOTBALL_KEY ontbreekt');process.exit(1)}
const base='https://v3.football.api-sports.io/';
const get=async (path)=>{const r=await fetch(base+path,{headers:{'x-apisports-key':key}});if(!r.ok)throw Error('API '+r.status);const j=await r.json();if(j.errors&&Object.keys(j.errors).length)throw Error(JSON.stringify(j.errors));return j.response||[]};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fixtures=await get('fixtures?date='+today+'&timezone=Europe%2FAmsterdam');
const payload={source:'API-Football',date:today,updatedAt:new Date().toISOString(),fixtures:fixtures.map(x=>({id:x.fixture.id,league:x.league.name,country:x.league.country,flag:x.league.flag,home:x.teams.home.name,away:x.teams.away.name,homeLogo:x.teams.home.logo,awayLogo:x.teams.away.logo,h:x.goals.home,a:x.goals.away,status:x.fixture.status.short,minute:x.fixture.status.elapsed,time:x.fixture.date,events:(x.events||[]).map(e=>({minute:e.time.elapsed,team:e.team.name,player:e.player.name,assist:e.assist.name,type:e.type,detail:e.detail}))}))};

const previous=fs.existsSync('data/catalog.json')?JSON.parse(fs.readFileSync('data/catalog.json','utf8')):{};
const leagues=new Map(),teams=new Map();
for(const f of fixtures){const l=f.league,t=f.teams;leagues.set(l.id,{id:l.id,name:l.name,country:l.country,logo:l.logo,flag:l.flag,season:l.season});for(const team of [t.home,t.away])teams.set(team.id,{id:team.id,name:team.name,logo:team.logo,country:l.country,league:l.name,leagueId:l.id})}
const now=Date.now(),fresh=previous.updatedAt&&now-new Date(previous.updatedAt).getTime()<24*3600*1000;
let catalog={updatedAt:new Date().toISOString(),leagues:[...leagues.values()],teams:[...teams.values()],squads:previous.squads||{},statistics:previous.statistics||{}};
if(!fresh){
  const preferred=['PSV','Ajax','Feyenoord','Real Madrid','FC Barcelona','Manchester City','Arsenal','Liverpool'];
  let count=0;
  for(const name of preferred){const team=[...teams.values()].find(t=>t.name.toLowerCase()===name.toLowerCase());if(!team||count>=4)continue;
    try{const response=await get('players/squads?team='+team.id);catalog.squads[team.id]=(response[0]?.players||[]).map(p=>({id:p.id,name:p.name,age:p.age,number:p.number,position:p.position,photo:p.photo}));count++}catch(e){console.warn('Squad skipped: '+e.message)}
  }
  const finished=fixtures.filter(f=>['FT','1H','2H','HT'].includes(f.fixture.status.short)).slice(0,2);
  for(const fixture of finished){try{const data=await get('fixtures/statistics?fixture='+fixture.fixture.id);catalog.statistics[fixture.fixture.id]=data.map(x=>({team:x.team.name,stats:x.statistics.map(z=>({type:z.type,value:z.value}))}))}catch(e){console.warn('Stats skipped: '+e.message)}}
}else catalog.updatedAt=previous.updatedAt;
fs.mkdirSync('data',{recursive:true});fs.writeFileSync('data/catalog.json',JSON.stringify(catalog));
fs.writeFileSync('data/football.json',JSON.stringify(payload));console.log('Updated '+payload.fixtures.length+' fixtures, '+catalog.teams.length+' teams, '+Object.keys(catalog.squads).length+' squads');
