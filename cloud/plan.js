// Subscription metadata only; Firestore enforcement is a separate persisted policy.
export function cloudPlan(value){
  if(!['free','paid'].includes(value))throw new Error('Expected CLOUD_PLAN=free or paid');
  return value;
}

export function activationPlanVerified(input,plan){
  cloudPlan(plan);
  return input.planVerified===true&&input.plan===plan||plan==='free'&&input.freePlanVerified===true;
}
