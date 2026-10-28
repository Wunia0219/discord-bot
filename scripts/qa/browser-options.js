// Keep local Windows acceptance on Edge; CI uses installed Chromium.
export const browserOptions=()=>({
  channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined),
  headless:true,args:['--mute-audio'],
});
