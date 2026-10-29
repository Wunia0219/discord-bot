import {appendFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {cloudNode,nodeVersion,runNode} from '../lib/node-runtime.js';
import {checkDiscordSdk} from '../security/patch-discord-sdk.js';
import {checkToolchain} from './check-toolchain.js';
import {runVerificationSteps} from './helpers/verification.js';
import {verificationPlan} from './helpers/verification-plan.js';

const ci=process.argv.includes('--ci'),full=ci||process.argv.includes('--full'),list=process.argv.includes('--list');
const args=process.argv.slice(2),suiteArgs=args.filter(arg=>arg.startsWith('--suite=')),suite=suiteArgs.length?suiteArgs[0].slice(8):'all';
if(suiteArgs.length>1||args.some(arg=>!['--ci','--full','--list'].includes(arg)&&!arg.startsWith('--suite=')))throw new Error('Use --ci, --full, --list and/or --suite=browser|wallet|services');
const node=process.execPath,integrationNode=cloudNode();
const steps=verificationPlan({ci,full,suite,node,integrationNode});
if(list){for(const {label,args} of steps)console.log(label+': node '+args.join(' '));process.exit(0);}
mkdirSync('test-results',{recursive:true});
const report={ci,full,suite,ok:false,environment:{node:process.version,platform:process.platform,arch:process.arch,npm:process.env.npm_config_user_agent?.split(' ')[0],revision:process.env.GITHUB_SHA},steps:[]};
const save=()=>writeFileSync('test-results/verification.json',JSON.stringify(report,null,2)+'\n');
save();
try{
 report.toolchain=checkToolchain();checkDiscordSdk();
 const [major,minor,patch]=process.versions.node.split('.').map(Number),[requiredMajor,requiredMinor,requiredPatch]=nodeVersion.split('.').map(Number);
 if(major!==requiredMajor||minor<requiredMinor||(minor===requiredMinor&&patch<requiredPatch))throw new Error(`Verification requires Node.js ${nodeVersion} or a newer patch/minor in the same major; see .node-version`);
 if(!existsSync(integrationNode))throw new Error('Windows ARM cloud validation requires .tools/node-x64; see docs/deployment.md');
 if(steps.some(step=>step.id==='firestore')&&!existsSync('.tools/cloud-firestore-emulator-v1.22.0.jar'))throw new Error('Run npm run firestore:emulator:setup before full verification');
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
 const summary=['| Check | Result | Seconds |','| --- | --- | ---: |',...report.steps.map(step=>`| ${step.label} | ${step.status}${step.reason?`: ${step.reason}`:''} | ${(step.durationMs/1000).toFixed(1)} |`)].join('\n');
 console.log(`\n${summary}\nVerification ${report.ok?'passed':'failed'} (${report.steps.length}/${steps.length} steps); test-results/verification.json`);
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary+'\n');
}
