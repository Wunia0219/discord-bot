export async function runVerificationSteps(steps,{execute,keepGoing=false,onStart=()=>{},onResult=()=>{}}){
  const results=[];
  for(const [index,step] of steps.entries()){
    if(results.some(result=>result.id===step.id))throw new Error(`Duplicate verification step: ${step.id}`);
    for(const dependency of step.dependsOn??[]){
      if(!results.some(result=>result.id===dependency))throw new Error(`Missing earlier dependency: ${dependency}`);
    }
    const blocked=(step.dependsOn??[]).filter(id=>results.find(result=>result.id===id).status!=='passed');
    const result={id:step.id,label:step.label,status:'skipped',exitCode:null,durationMs:0};
    if(blocked.length)result.reason=`Blocked by ${blocked.join(', ')}`;
    else{
      onStart(step,index);
      const started=Date.now();
      try{result.exitCode=await execute(step);}
      catch(error){result.exitCode=1;result.error=error.message;}
      result.status=result.exitCode===0?'passed':'failed';
      result.durationMs=Date.now()-started;
    }
    results.push(result);onResult(result);
    if(result.status==='failed'&&!keepGoing)break;
  }
  return {steps:results,ok:results.length===steps.length&&results.every(result=>result.status==='passed')};
}
