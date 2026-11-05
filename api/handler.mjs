import {createServer} from '../server.mjs';
const listener=createServer().listeners('request')[0];
export default function handler(req,res){
 const url=new URL(req.url,'http://localhost');
 const route=url.searchParams.get('route')||'';
 if(!['health','upload','analyze','chat','proposals','related','compose'].includes(route)){
  res.statusCode=404;res.end('Not found');return;
 }
 req.url='/api/'+route;
 return listener(req,res);
}
