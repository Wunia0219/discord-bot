import {firestoreSettings} from '../../server/firestore-settings.js';
import {FirestoreWalletStore} from '../../server/firestore-wallet.js';
import {firestoreImportPlan,importFirestore} from '../../server/firestore-import.js';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--from')throw new Error('Usage: firestore:migrate -- --from <verified SQLite snapshot>');
const settings=firestoreSettings(),plan=firestoreImportPlan(args[1],settings.environment);
const guildIds=(process.env.ALLOWED_GUILD_IDS||'').split(',').filter(Boolean);
const store=new FirestoreWalletStore(settings,{guildIds});
try{const result=await importFirestore(store,plan);console.log(JSON.stringify({projectId:settings.projectId,namespace:settings.namespace,...result},null,2));}
finally{await store.close();}
