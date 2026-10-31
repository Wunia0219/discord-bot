export const CI_SUITES=['browser','wallet','services'];

const integrationFiles={
  wallet:['firestore','firestore-v2','firestore-state-cache'],
  services:['firestore-backup','firestore-highlights','firestore-live-migration','cloud-rest','cloud-runtime','cloud-welcome','cloud-backup-scale','segmented-runtime','customer-recovery','test-data-reset'],
};

export function verificationPlan({ci=false,full=false,suite='all',node=process.execPath,integrationNode=node}={}){
  if(suite!=='all'&&(!ci||!CI_SUITES.includes(suite)))throw new Error('Use --suite=browser|wallet|services with --ci');
  const step=(id,label,args,dependsOn=[],executable=node)=>({id,label,args,dependsOn,executable});
  const steps=[];
  if(suite==='all'||suite==='browser'||suite==='services'){
    steps.push(
      step('unit','一般回歸',['--test','tests/*.test.js']),
      step('build','前端建置',['node_modules/vite/bin/vite.js','build']),
      step('worker','遊戲 Worker dry-run',['scripts/cloud/cloud-local.js','build'],['build']),
      step('monitor-build','監控 Worker dry-run',['scripts/cloud/cloud-local.js','monitor-build']),
      step('sdk','Discord SDK 安全與登入',['scripts/qa/discord-sdk.js']),
      step('startup','啟動失敗回收',['scripts/qa/startup-resources.js']),
      step('dealer','荷官資源與影格',['scripts/qa/dealer-resources.js']),
      step('numbers','數字繪製像素',['scripts/qa/number-rendering.js']),
      step('reels','停輪體驗',['scripts/qa/reel-experience.js']),
      step('security','正式建置 CSP 與錢包',['scripts/qa/security-smoke.js'],['build']),
    );
    if(ci)steps.push(
      step('reels-stress','慢幀與輸入延遲',['scripts/qa/reel-experience.js','--slow-frames','--slow-input']),
      step('security-stress','CSP 延遲通知',['scripts/qa/security-smoke.js','--delayed-csp-report'],['build']),
    );
  }
  if((full||ci)&&suite!=='browser'){
    const files=suite==='all'?Object.values(integrationFiles).flat():integrationFiles[suite];
    steps.push(step('firestore','Firestore SDK／REST／workerd／恢復',[
      'scripts/qa/test-firestore.js',...files.map(name=>`tests/${name}.integration.js`),
    ],suite==='wallet'?[]:['worker'],integrationNode));
    if(suite!=='wallet')steps.push(step('monitor','監控 workerd',['--test','tests/monitor-runtime.integration.js'],['monitor-build'],integrationNode));
  }
  if(suite==='browser')return steps.filter(step=>!['worker','monitor-build'].includes(step.id));
  if(suite==='services')return steps.filter(step=>['build','worker','monitor-build','firestore','monitor'].includes(step.id));
  return steps;
}
