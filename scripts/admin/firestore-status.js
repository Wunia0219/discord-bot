import {firestoreSettings} from '../../server/firestore/settings.js';
import {FirestoreWalletStore} from '../../server/firestore/wallet.js';
const settings=firestoreSettings(),guildIds=(process.env.ALLOWED_GUILD_IDS||'').split(',').filter(Boolean);
const store=new FirestoreWalletStore(settings,{guildIds:process.env.LOCAL_WALLET_TEST==='true'?['100000000000000001']:guildIds});
try{const ready=await store.isReady();console.log(JSON.stringify({...store.status(),ready},null,2));if(!ready)process.exitCode=1;}
finally{await store.close();}
