import {appendFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {cloudNode,nodeVersion,runNode} from '../lib/node-runtime.js';
import {checkDiscordSdk} from '../security/patch-discord-sdk.js';
import {checkToolchain} from './check-toolchain.js';
import {runVerificationSteps} from './helpers/verification.js';

const ci=process.argv.includes('--ci'),full=ci||process.argv.includes('--full'),list=process.argv.includes('--list');
if(process.argv.slice(2).some(arg=>!['--ci','--full','--list'].includes(arg)))throw new Error('Use --ci, --full and/or --list');
const node=process.execPath,integrationNode=cloudNode();
const step=(id,label,args,dependsOn=[],executable=node)=>({id,label,args,dependsOn,executable});
const steps=[
 step('unit','一般回歸',['--test','tests/*.test.js']),
 step('build','前端建置',['node_modules/vite/bin/vite.js','build']),
 step('worker','遊戲 Worker dry-run',['scripts/admin/cloud-local.js','build']),
 step('monitor-build','監控 Worker dry-run',['scripts/admin/cloud-local.js','monitor-build']),
 step('sdk','Discord SDK 安全與登入',['scripts/qa/discord-sdk.js']),
 step('startup','啟動失敗回收',['scripts/qa/startup-resources.js']),
 step('dealer','荷官資源與影格',['scripts/qa/dealer-resources.js']),
 step('numbers','數字繪製像素',['scripts/qa/number-rendering.js']),
 step('reels','停輪體驗',['scripts/qa/reel-experience.js']),
 step('security','正式建置 CSP 與錢包',['scripts/qa/security-smoke.js'],['build']),
];
if(ci)steps.push(
 step('reels-stress','慢幀與輸入延遲',['scripts/qa/reel-experience.js','--slow-frames','--slow-input']),
 step('security-stress','CSP 延遲通知',['scripts/qa/security-smoke.js','--delayed-csp-report'],['build']),
);
if(full)steps.push(
 step('firestore','Firestore SDK／REST／workerd／恢復',['scripts/admin/test-firestore.js',
  'tests/firestore.integration.js','tests/firestore-backup.integration.js','tests/firestore-v2.integration.js','tests/firestore-highlights.integration.js','tests/firestore-live-migration.integration.js','tests/firestore-state-cache.integration.js',
  'tests/cloud-rest.integration.js','tests/cloud-runtime.integration.js','tests/cloud-welcome.integration.js','tests/cloud-backup-scale.integration.js','tests/segmented-runtime.integration.js','tests/customer-recovery.integration.js','tests/test-data-reset.integration.js'],[],integrationNode),
 step('monitor','監控 workerd',['--test','tests/monitor-runtime.integration.js'],[],integrationNode),
);
if(list){for(const {label,args} of steps)console.log(label+': node '+args.join(' '));process.exit(0);}
mkdirSync('test-results',{recursive:true});
const report={ci,full,ok:false,environment:{node:process.version,platform:process.platform,arch:process.arch,npm:process.env.npm_config_user_agent?.split(' ')[0],revision:process.env.GITHUB_SHA},steps:[]};
const save=()=>writeFileSync('test-results/verification.json',JSON.stringify(report,null,2)+'\n');
save();
try{
 report.toolchain=checkToolchain();checkDiscordSdk();
 const [major,minor,patch]=process.versions.node.split('.').map(Number),[requiredMajor,requiredMinor,requiredPatch]=nodeVersion.split('.').map(Number);
 if(major!==requiredMajor||minor<requiredMinor||(minor===requiredMinor&&patch<requiredPatch))throw new Error(`Verification requires Node.js ${nodeVersion} or a newer patch/minor in the same major; see .node-version`);
 if(!existsSync(integrationNode))throw new Error('Windows ARM cloud validation requires .tools/node-x64; see docs/deployment.md');
 if(full&&!existsSync('.tools/cloud-firestore-emulator-v1.22.0.jar'))throw new Error('Run npm run firestore:emulator:setup before full verification');
 const result=await runVerificationSteps(steps,{
  keepGoing:ci,
  execute:({executable,args})=>runNode(executable,args,{FIRESTORE_LIVE_ENABLED:'false',...(ci?{PLAYWRIGHT_BROWSER_CHANNEL:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'bundled'}:{})}),
  onStart:({label},index)=>console.log(`\n[${index+1}/${steps.length}] ${label}`),
  onResult:result=>{report.steps.push(result);save();},
 });
 report.ok=result.ok;
}catch(error){report.failure=error.message;console.error(error);}
finally{
 save();if(!report.ok)process.exitCode=1;
 const summary=['| Check | Result |','| --- | --- |',...report.steps.map(step=>`| ${step.label} | ${step.status}${step.reason?`: ${step.reason}`:''} |`)].join('\n');
 console.log(`\n${summary}\nVerification ${report.ok?'passed':'failed'} (${report.steps.length}/${steps.length} steps); test-results/verification.json`);
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary+'\n');
}
