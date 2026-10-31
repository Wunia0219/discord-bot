const ids=value=>(value||'').split(',').map(value=>value.trim()).filter(Boolean);

// ADMIN_ROLE_IDS is retained for existing Workers; new configurations use CHIP_ADMIN_ROLE_IDS.
export function walletSettings(env,{cloud=false}={}){
  const primary=ids(env.CHIP_ADMIN_ROLE_IDS),legacy=cloud?ids(env.ADMIN_ROLE_IDS):[];
  if(cloud&&env.CHIP_ADMIN_ROLE_IDS!==undefined&&env.ADMIN_ROLE_IDS!==undefined&&
      [...new Set(primary)].sort().join(',')!==[...new Set(legacy)].sort().join(',')){
    throw new Error('Conflicting CHIP_ADMIN_ROLE_IDS and ADMIN_ROLE_IDS');
  }
  const adminRoles=env.CHIP_ADMIN_ROLE_IDS!==undefined?primary:legacy;
  if(adminRoles.some(id=>!/^\d{17,20}$/.test(id)))throw new Error('Invalid CHIP_ADMIN_ROLE_IDS');
  return {
    adminRoles,
    guildIds:ids(env.ALLOWED_GUILD_IDS),
    weeklyRewards:env.WEEKLY_CHECKIN_REWARDS,
    grantMax:Number(env.ADMIN_GRANT_MAX||100000),
    grantDaily:Number(env.ADMIN_DAILY_MAX||1000000),
  };
}
