import {execFileSync} from 'node:child_process';
import {fixture} from './configured-qa-env.mjs';
const values=fixture(process.env);
try {
  execFileSync('docker',['build','--build-arg',`BRITELINK_BUILD_COMMIT=${process.env.RELEASE_SHA}`,'--build-arg',`VITE_SUPABASE_URL=${values.PUBLIC_URL}`,'--build-arg',`VITE_SUPABASE_ANON_KEY=${values.ANON_KEY}`,'--build-arg','VITE_PRIVACY_NOTICE_VERSION=ci-synthetic-notice','--build-arg','VITE_ATTACHMENTS_ENABLED=','-t','britelink:configured-candidate','.'],{stdio:['ignore','pipe','pipe'],timeout:900000,maxBuffer:32*1024*1024});
} catch {
  // Native child-process exceptions include command arguments and captured logs.
  throw new Error('Configured fixture Docker build failed; credential-bearing build output withheld');
}
console.log('Built configured CI fixture image; public anon key and build output not logged');
