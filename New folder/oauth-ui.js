(()=>{
  'use strict';
  const q=s=>document.querySelector(s);
  const messages={verification_failed:'Sign-in could not be verified. Please start again.',cancelled:'Sign-in was cancelled.',link_required:'An account already uses that email. Sign in with your password, then connect this provider in your account.',admin_required:'Administrators must use the Admin tab and complete verification.'};
  const params=new URLSearchParams(location.search);
  if(q('#authStatus')&&params.has('oauth_error'))q('#authStatus').textContent=messages[params.get('oauth_error')]||messages.verification_failed;
  if(params.get('mode')==='admin')q('[data-tab="admin"]')?.click();
  async function request(url,options){const r=await fetch(url,options);const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not connect your account.');return data;}
  (async()=>{
    try{
      const providers=await request('/api/oauth/providers');
      const box=q('#oauthButtons');
      if(box){for(const name of ['google','apple'])if(providers[name]?.enabled&&providers[name]?.configured){const a=document.createElement('a');a.className='oauth-button';a.href='/api/oauth/'+name;a.textContent='Continue with '+(name==='google'?'Google':'Apple');box.append(a);}box.hidden=!box.children.length;}
      const account=q('#connectedAccounts');if(!account)return;
      const [me,linked]=await Promise.all([request('/api/auth/me'),request('/api/oauth/accounts')]);
      if(me.user.isAdmin)return;
      account.hidden=false;
      const target=q('#providerConnections');
      for(const name of ['google','apple']){
        const linkedAlready=linked.accounts.some(a=>a.provider===name);
        if(!linkedAlready&&!(providers[name]?.enabled&&providers[name]?.configured))continue;
        const button=document.createElement('button');button.className='save';button.disabled=linkedAlready;button.textContent=(name==='google'?'Google':'Apple')+(linkedAlready?' connected':' — connect account');
        button.onclick=async()=>{button.disabled=true;try{const {csrfToken}=await request('/api/auth/csrf');const result=await request('/api/oauth/'+name+'/link',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfToken},body:'{}'});location.assign(result.url);}catch(e){q('#connectionStatus').textContent=e.message;button.disabled=false;}};target.append(button);
      }
      if(!target.children.length){account.hidden=true;return;}
      if(params.get('oauth')==='success')q('#connectionStatus').textContent='Your account is ready.';
    }catch{ /* Password access remains available when a provider is unavailable. */ }
  })();
})();
