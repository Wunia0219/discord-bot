export async function connectLocalWallet(location,fetchImpl=fetch){
  if(new URLSearchParams(location.search).get('wallet')!=='local')return null;
  if(location.hostname!=='127.0.0.1'||location.protocol!=='http:'||new URLSearchParams(location.search).has('frame_id')){
    throw new Error('本機錢包測試請從這台電腦的測試網址開啟。');
  }
  const response=await fetchImpl('/api/local-session',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:new URLSearchParams(location.search).get('player')||'default'}),cache:'no-store',signal:AbortSignal.timeout(8000),
  });
  if(!response.ok)throw new Error('本機錢包尚未啟動，請確認測試後端已啟動。');
  const activity=await response.json();
  if(activity.mode!=='local'||activity.session?.environment!=='test'||!activity.session.token||activity.user?.id!==activity.session.userId){
    throw new Error('本機測試帳號連接失敗，請重新開啟遊戲。');
  }
  return activity;
}
