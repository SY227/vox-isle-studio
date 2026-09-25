/** Vercel request handler: no listen(), no background work after response.end(). */
import {createApp} from '../server/index.mjs';
import {getConfig} from '../server/config.mjs';
let app;
export default async function handler(req,res){
  const url=new URL(req.url,'http://localhost');
  const routed=url.searchParams.get('__vox_route');
  if(routed!==null){
    if(!/^[a-z-]+$/.test(routed)){res.statusCode=404;res.end();return;}
    req.url='/api/'+routed;
  }
  app??=createApp(getConfig());
  await app.handle(req,res);
}
