// Currency formatting for operational screens. No exchange-rate conversion.
(()=>{
 let storeCurrency=null;
 const code=value=>{const currency=String(value??'').trim().toUpperCase();return /^[A-Z]{3}$/.test(currency)?currency:null;};
 const format=(value,currency=storeCurrency)=>{
  const selected=code(currency),amount=Number(value??0);
  if(!selected||!Number.isFinite(amount))return '—';
  return new Intl.NumberFormat(undefined,{style:'currency',currency:selected,currencyDisplay:'code'}).format(amount);
 };
 globalThis.WorkspaceMoney={code,format,setCurrency(value){storeCurrency=code(value);if(!storeCurrency)throw new Error('Store currency is unavailable. Refresh to retry.');return storeCurrency;},get currency(){return storeCurrency;}};
})();
