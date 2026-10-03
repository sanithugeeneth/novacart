(()=>{
  'use strict';
  const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function refresh(){
    $('#refreshLaunch').disabled=true;$('#launchStatus').textContent='Checking server configuration…';
    try{
      const response=await fetch('/api/admin/launch-readiness',{cache:'no-store'}),data=await response.json();
      if(!response.ok)throw new Error(response.status===401||response.status===403?'Administrator access required. Sign in through the Admin tab to continue.':'Setup status is temporarily unavailable.');
      $('#launchReport').hidden=false;
      $('#launchSummary').textContent=data.configurationPassed?'Server settings are configured.':'A few settings need your attention.';
      $('#databaseStatus').textContent=data.database?.schemaCurrent?'Database connected · release migration applied.':'Database connection or migration needs attention.';
      $('#launchChecks').innerHTML=data.checks.map(item=>`<section class="panel"><span class="kicker">${esc(item.state==='configured'?'SETTINGS PRESENT':item.state==='disabled'?'NOT ENABLED':'SETUP REQUIRED')}</span><h2>${esc(item.label)}</h2>${item.state==='disabled'?'<p class="integration-help">Enable this service after adding its credentials to your private server settings.</p>':''}${item.issues.length?`<ul>${item.issues.map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul>`:''}${item.warnings.map(note=>`<p class="integration-help">${esc(note)}</p>`).join('')}</section>`).join('');
      $('#launchStatus').textContent='Configuration checked. Live customer journeys still need deployment verification.';
    }catch(error){$('#launchReport').hidden=true;$('#launchStatus').textContent=error.message;}
    finally{$('#refreshLaunch').disabled=false;}
  }
  $('#refreshLaunch').addEventListener('click',refresh);refresh();
})();
