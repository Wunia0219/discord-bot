import {cloudPlan} from './plan.js';

export function cloudIdentity(env){
  cloudPlan(env.CLOUD_PLAN);
  if(!['test','production'].includes(env.APP_ENV)||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FIRESTORE_PROJECT_ID||'')||!/^[-a-z0-9]{3,80}$/.test(env.FIRESTORE_NAMESPACE||'')||!env.FIRESTORE_NAMESPACE.endsWith('-'+env.APP_ENV))throw new Error('Cloud identity not configured');
  if(env.LOCAL_WALLET_TEST==='true'||env.FIRESTORE_EMULATOR_HOST)throw new Error('Fixture configuration is not deployable');
  return {projectId:env.FIRESTORE_PROJECT_ID,namespace:env.FIRESTORE_NAMESPACE,environment:env.APP_ENV,schemaVersion:2};
}
