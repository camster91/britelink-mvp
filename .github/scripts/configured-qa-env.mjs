// Disposable fixture keys shared by the image build and a fresh CI runner.
// These deterministic keys never configure an existing staging/production service.
import { createHash,createHmac } from 'node:crypto';
import { writeFileSync,existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function fixture(env){
  if(env.GITHUB_ACTIONS!=='true'||!/^[a-f0-9]{40}$/.test(env.RELEASE_SHA||'')||!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||''))throw new Error('A complete disposable CI identity is required');
  const identity=`${env.RELEASE_SHA}:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}`;
  const secret=createHash('sha256').update('britelink-ci-only-signing:'+identity).digest('hex');
  const password=createHash('sha256').update('britelink-ci-only-database:'+identity).digest('hex');
  const key=role=>{
    const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({role,iss:'supabase-staging',iat:1700000000,exp:2700000000})).toString('base64url');
    return `${header}.${payload}.${createHmac('sha256',secret).update(`${header}.${payload}`).digest('base64url')}`;
  };
  return {STACK_NAME:'britelink-staging',COMPOSE_PROJECT_NAME:'britelink-staging',POSTGRES_PASSWORD:password,JWT_SECRET:secret,ANON_KEY:key('anon'),SERVICE_KEY:key('service_role'),GATEWAY_PORT:'8099',PUBLIC_URL:'http://127.0.0.1:8099',SITE_URL:'http://127.0.0.1:8099'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const path='supabase/selfhosted/.env';
  if(existsSync(path))throw new Error('Refusing to overwrite existing stack configuration');
  const values=fixture(process.env);
  writeFileSync(path,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
  console.log('Created disposable CI configuration; no credential values logged');
}
