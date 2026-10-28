import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {cloudNode,runNode} from '../lib/node-runtime.js';
import {checkDiscordSdk} from '../security/patch-discord-sdk.js';

const full=process.argv.includes('--full'),list=process.argv.includes('--list');
if(process.argv.slice(2).some(arg=>!['--full','--list'].includes(arg)))throw new Error('Use --full and/or --list');
const node=process.execPath;
const integrationNode=cloudNode();
const steps=[
 ['一般回歸',node,['--test','tests/*.test.js']],
 ['前端建置',node,['node_modules/vite/bin/vite.js','build']],
 ['遊戲 Worker dry-run',node,['scripts/admin/cloud-local.js','build']],
 ['監控 Worker dry-run',node,['scripts/admin/cloud-local.js','monitor-build']],
 ['Discord SDK 安全與登入',node,['scripts/qa/discord-sdk.js']],
 ['啟動失敗回收',node,['scripts/qa/startup-resources.js']],
 ['荷官資源與影格',node,['scripts/qa/dealer-resources.js']],
 ['數字繪製像素',node,['scripts/qa/number-rendering.js']],
 ['停輪體驗',node,['scripts/qa/reel-experience.js']],
 ['正式建置 CSP 與錢包',node,['scripts/qa/security-smoke.js']],
];
if(full)steps.push(
 ['Firestore SDK／REST／workerd／恢復',integrationNode,['scripts/admin/test-firestore.js',
  'tests/firestore.integration.js','tests/firestore-backup.integration.js','tests/firestore-v2.integration.js','tests/firestore-highlights.integration.js','tests/firestore-live-migration.integration.js','tests/firestore-state-cache.integration.js',
  'tests/cloud-rest.integration.js','tests/cloud-runtime.integration.js','tests/cloud-welcome.integration.js','tests/cloud-backup-scale.integration.js','tests/segmented-runtime.integration.js','tests/customer-recovery.integration.js','tests/test-data-reset.integration.js']],
 ['監控 workerd',integrationNode,['--test','tests/monitor-runtime.integration.js']],
);
if(list){for(const [label,,args] of steps)console.log(label+': node '+args.join(' '));process.exit(0);}
checkDiscordSdk();
if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Verification requires Node.js 24; see .node-version');
if(!existsSync(integrationNode))throw new Error('Windows ARM cloud validation requires .tools/node-x64; see docs/deployment.md');
if(full&&!existsSync('.tools/cloud-firestore-emulator-v1.22.0.jar'))throw new Error('Run npm run firestore:emulator:setup before full verification');
mkdirSync('test-results',{recursive:true});const report={full,steps:[]};
try{
 for(const [label,executable,args] of steps){
  console.log(`\n[${report.steps.length+1}/${steps.length}] ${label}`);
  const started=Date.now(),code=await runNode(executable,args,{FIRESTORE_LIVE_ENABLED:'false'});
  report.steps.push({label,exitCode:code,durationMs:Date.now()-started});
  if(code!==0){process.exitCode=code;break;}
 }
}finally{
 report.ok=report.steps.length===steps.length&&report.steps.every(step=>step.exitCode===0);
 writeFileSync('test-results/verification.json',JSON.stringify(report,null,2)+'\n');
 console.log(`\nVerification ${report.ok?'passed':'failed'} (${report.steps.length}/${steps.length} steps); test-results/verification.json`);
}
