import {Firestore} from '@google-cloud/firestore';
import {FirestoreQuota} from './quota.js';
import {FirestoreWalletCore} from './wallet-core.js';

// Node transport; the settlement implementation is shared with the cloud adapter.
export class FirestoreWalletStore extends FirestoreWalletCore {
  constructor(settings,options={}){
    const db=options.db||new Firestore({projectId:settings.projectId,databaseId:'(default)',...(settings.credentials?{credentials:settings.credentials}:{}),...(settings.emulator?{host:settings.emulator,ssl:false,universeDomain:'googleapis.com'}:{}),preferRest:false,maxIdleChannels:1});
    const quota=options.quota||new FirestoreQuota({...settings.quota,...(options.clock?{clock:options.clock}:{})});
    super(settings,{...options,db,quota});
  }
}
