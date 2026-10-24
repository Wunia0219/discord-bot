import test from 'node:test';
import assert from 'node:assert/strict';
import {FirestoreRest} from '../cloud/firestore-rest.js';

test('regional transport accepts only Google Firestore regional endpoints and cannot escape an emulator',()=>{
 const settings={projectId:'demo-jokers-circus',namespace:'endpoint-test'};
 for(const endpoint of ['https://evil.example','https://firestore.us.rep.googleapis.com.evil.example','http://firestore.us.rep.googleapis.com','https://firestore.us.rep.googleapis.com/path'])assert.throws(()=>new FirestoreRest({...settings,endpoint}),/endpoint/);
 assert.throws(()=>new FirestoreRest({...settings,emulator:'127.0.0.1:8787',endpoint:'https://firestore.asia-east1.rep.googleapis.com'}),/endpoint/);
 assert.equal(new FirestoreRest({...settings,endpoint:'https://firestore.asia-east1.rep.googleapis.com'}).base,'https://firestore.asia-east1.rep.googleapis.com');
});
