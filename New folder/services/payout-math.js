export const cents=value=>{const n=Math.round(Number(value)*100);if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid payout amount.');return n;};
const reject=message=>Object.assign(new Error(message),{status:409});

// Allocate the order discount once across sellers and platform merchandise in cents.
// Shipping and tax are not seller merchandise earnings.
export async function payable(c,order,sellerId){
  const groups=(await c.query('select seller_id,subtotal,commission from seller_orders where order_id=$1 order by seller_id',[order.id])).rows.map(row=>({...row,gross:cents(row.subtotal)}));
  const total=cents(order.subtotal),discount=cents(order.discount),sellerGross=groups.reduce((n,g)=>n+g.gross,0);
  if(sellerGross>total||discount>total)throw reject('Order totals need reconciliation.');
  groups.push({seller_id:'platform',gross:total-sellerGross,commission:0});
  const allocations=groups.map(g=>total?Number(BigInt(discount)*BigInt(g.gross)/BigInt(total)):0);
  const ranked=groups.map((g,i)=>({i,remainder:total?BigInt(discount)*BigInt(g.gross)%BigInt(total):0n})).sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1);
  for(let n=0,left=discount-allocations.reduce((a,b)=>a+b,0);n<left;n++)allocations[ranked[n].i]++;
  const index=groups.findIndex(g=>g.seller_id===sellerId),group=groups[index];
  if(!group)throw reject('Seller order allocation is missing.');
  const gross=group.gross-allocations[index],oldCommission=cents(group.commission);
  if(oldCommission>group.gross)throw reject('Seller commission needs reconciliation.');
  const commission=group.gross?Number((BigInt(oldCommission)*BigInt(gross)*2n+BigInt(group.gross))/(2n*BigInt(group.gross))):0;
  return {gross,commission,net:gross-commission};
}
