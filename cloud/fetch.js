// Workers supports manual redirects; every caller rejects non-2xx responses.
export const cloudFetch=(url,options={})=>globalThis.fetch(url,{...options,redirect:options.redirect==='error'?'manual':options.redirect});
