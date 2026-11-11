const http = require('http');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'jetpack-jung-multiplayer' }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocket.Server({ server });
const rooms = new Map(), clients = new Map(), waiting = [];
const makeCode = () => Math.random().toString(36).slice(2,8).toUpperCase();
const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
function list(room) {
  return [...room].map(ws => clients.get(ws)).filter(Boolean)
    .map(p => ({id:p.id,name:p.name,avatar:p.avatar,you:false}));
}
function publish(room) { const players=list(room); for (const ws of room) send(ws,{type:'players',players}); }
function detach(ws,p) {
  if (!p.room) return;
  const r=rooms.get(p.room); if(r){r.delete(ws); if(!r.size) rooms.delete(p.room); else publish(r);}
  p.room=null;
}
wss.on('connection', ws => {
  const p={id:makeCode(),name:'Player',avatar:null,room:null,searching:false};
  clients.set(ws,p); send(ws,{type:'welcome',id:p.id,players:[]});
  ws.on('message', raw => {
    if (raw.length > 32768) return;
    let m; try { m=JSON.parse(raw.toString()); } catch { return; }
    if(m.type==='hello'){p.name=String(m.name||'Player').slice(0,16);p.avatar=m.avatar||null;send(ws,{type:'welcome',id:p.id});return;}
    if(m.type==='create_room'){
      detach(ws,p); p.searching=false; let id=makeCode();while(rooms.has(id))id=makeCode();
      const r=new Set([ws]);rooms.set(id,r);p.room=id;
      send(ws,{type:'room',status:'created',code:id,players:list(r)});publish(r);return;
    }
    if(m.type==='join_room'){
      const id=String(m.code||'').toUpperCase(),r=rooms.get(id);
      if(!r||r.size>=8){send(ws,{type:'error',message:'Room not found or full'});return;}
      detach(ws,p);p.searching=false;r.add(ws);p.room=id;
      send(ws,{type:'room',status:'joined',code:id,players:list(r)});publish(r);return;
    }
    if(m.type==='matchmake'){
      detach(ws,p);p.searching=true;
      for(let i=waiting.length-1;i>=0;i--)if(waiting[i]===ws)waiting.splice(i,1);
      let partner;
      while(waiting.length&&!partner){const candidate=waiting.shift();const cp=clients.get(candidate);if(candidate!==ws&&candidate.readyState===WebSocket.OPEN&&cp&&cp.searching&&!cp.room)partner=candidate;}
      if(partner){
        const id=makeCode(),r=new Set([partner,ws]);rooms.set(id,r);
        const pp=clients.get(partner);pp.room=id;pp.searching=false;p.room=id;p.searching=false;
        for(const member of r)send(member,{type:'room',status:'matched',code:id,players:list(r)});
        publish(r);
      }else{
        p.room=null; waiting.push(ws);
        send(ws,{type:'room',status:'searching',code:'',players:[]});
      }return;
    }
    if(m.type==='snapshot'&&p.room&&rooms.has(p.room)){
      for(const member of rooms.get(p.room))if(member!==ws)send(member,{type:'snapshot',id:p.id,player:m.player});
      return;
    }
    if(['shot','grenade_throw','combat_state'].includes(m.type)&&p.room&&rooms.has(p.room)){
      const packet={...m,id:p.id};
      for(const member of rooms.get(p.room))if(member!==ws)send(member,packet);
      return;
    }
  });
  ws.on('close',()=>{p.searching=false;detach(ws,p);clients.delete(ws);const i=waiting.indexOf(ws);if(i>=0)waiting.splice(i,1);});
});
console.log('Jetpack Jung multiplayer server listening on port '+(process.env.PORT||8080));
