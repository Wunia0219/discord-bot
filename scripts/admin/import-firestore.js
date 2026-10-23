import {firestoreSettings} from '../../server/firestore-settings.js';
import {FirestoreWalletStore} from '../../server/firestore-wallet.js';
import {firestoreImportPlan,importFirestore} from '../../server/firestore-import.js';
const args=process.argv.slice(2),dryRun=args.includes('--dry-run'),input=args.filter(arg=>arg!=='--dry-run');
if(input.length!==2||input[0]!=='--from')throw new Error('Usage: firestore:migrate -- --from <verified SQLite snapshot> [--dry-run]');
const settings=firestoreSettings(),plan=firestoreImportPlan(input[1],settings.environment,{version:settings.schemaVersion});
if(dryRun){
  console.log(JSON.stringify({dryRun:true,schemaVersion:plan.version,projectId:settings.projectId,namespace:settings.namespace,
    documents:plan.resources.length,fingerprint:plan.fingerprint,counts:plan.audit.counts,
    estimatedReservations:{reads:6*(plan.resources.length+Math.ceil(plan.resources.length/50)+10),
      writes:2*(plan.resources.length+Math.ceil(plan.resources.length/50)+2)},
    note:'Local plan only; current remote usage and namespace have not been checked.'},null,2));
  process.exit(0);
}
const guildIds=(process.env.ALLOWED_GUILD_IDS||'').split(',').filter(Boolean);
const store=new FirestoreWalletStore(settings,{guildIds});
try{const result=await importFirestore(store,plan);console.log(JSON.stringify({projectId:settings.projectId,namespace:settings.namespace,...result},null,2));}
finally{await store.close();}
