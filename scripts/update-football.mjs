import fs from 'node:fs';
const key=process.env.API_FOOTBALL_KEY;
if(!key){console.error('API_FOOTBALL_KEY ontbreekt');process.exit(1)}
const base='https://v3.football.api-sports.io/';
const get=async (path)=>{const r=await fetch(base+path,{headers:{'x-apisports-key':key}});if(!r.ok)throw Error('API '+r.status);const j=await r.json();if(j.errors&&Object.keys(j.errors).length)throw Error(JSON.stringify(j.errors));return j.response||[]};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fixtures=await get('fixtures?date='+today+'&timezone=Europe%2FAmsterdam');
const payload={source:'API-Football',date:today,updatedAt:new Date().toISOString(),fixtures:fixtures.map(x=>({id:x.fixture.id,league:x.league.name,country:x.league.country,flag:x.league.flag,home:x.teams.home.name,away:x.teams.away.name,homeLogo:x.teams.home.logo,awayLogo:x.teams.away.logo,h:x.goals.home,a:x.goals.away,status:x.fixture.status.short,minute:x.fixture.status.elapsed,time:x.fixture.date,events:(x.events||[]).map(e=>({minute:e.time.elapsed,team:e.team.name,player:e.player.name,assist:e.assist.name,type:e.type,detail:e.detail}))}))};
fs.mkdirSync('data',{recursive:true});fs.writeFileSync('data/football.json',JSON.stringify(payload));console.log('Updated '+payload.fixtures.length+' fixtures');
