// Refund recovery is a ledger offset, never an external bank/Stripe transfer.
import {cents} from './payout-math.js';
const amount=n=>n/100;

export async function payoutAudit(c,actor,action,id,details){
  await c.query('insert into audit_logs(actor_user_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5)',[actor,action,'seller_payout',id,JSON.stringify(details)]);
}

// Every payout mutation takes the seller mutex, then all related order locks in
// the same order. Refund submission/webhooks take the same parent order locks.
export async function lockSellerLedger(c,sellerId){
  await c.query('select id from sellers where id=$1 for update',[sellerId]);
  await c.query(`select o.id from orders o where exists
    (select 1 from seller_orders so where so.order_id=o.id and so.seller_id=$1)
    order by o.id for update`,[sellerId]);
}

export async function reconcileRefunds(c,sellerId,currency,actor){
  const items=(await c.query(`select pi.*,o.total,o.payment_status,o.currency as order_currency,
    coalesce((select sum(r.amount) from refunds r where r.order_id=o.id and r.status='succeeded'
      and upper(trim(r.currency))=upper(trim(o.currency))),0) as refunded
    from seller_payout_items pi join seller_payouts p on p.id=pi.payout_id
    join orders o on o.id=pi.order_id where pi.seller_id=$1 and p.ledger_version=1
    and p.status in ('paid','settled') and upper(trim(p.currency))=$2 order by pi.order_id`,[sellerId,currency.toUpperCase()])).rows;
  for(const item of items){
    const total=cents(item.total),net=cents(item.net_amount);
    // Full-refund status also supports older records without provider refund rows.
    const refunded=item.payment_status==='refunded'?total:Math.min(total,cents(item.refunded));
    if(!total||!refunded||!net)continue;
    if(String(item.order_currency).trim().toUpperCase()!==currency.toUpperCase())throw new Error('Refund currency needs review.');
    // Floor the cumulative ratio: no per-refund rounding, no fractional-cent
    // overcharge across sellers, monotonic growth, full recovery on a full refund.
    if(net>total)throw new Error('Refund allocation needs review.');
    const debit=Number(BigInt(net)*BigInt(refunded)/BigInt(total));
    const previous=(await c.query('select * from seller_payout_refund_adjustments where seller_id=$1 and order_id=$2',[sellerId,item.order_id])).rows[0];
    if(previous&&cents(previous.debit_amount)>=debit)continue;
    if(!debit)continue;
    await c.query(`insert into seller_payout_refund_adjustments(seller_id,order_id,source_payout_id,currency,original_net_amount,refunded_amount,debit_amount)
      values($1,$2,$3,$4,$5,$6,$7) on conflict(seller_id,order_id) do update
      set refunded_amount=excluded.refunded_amount,debit_amount=excluded.debit_amount,updated_at=now()`,
      [sellerId,item.order_id,item.payout_id,currency.toUpperCase(),amount(net),amount(refunded),amount(debit)]);
    await payoutAudit(c,actor,'payout_refund_adjustment',item.payout_id,{orderId:item.order_id,previousDebit:Number(previous?.debit_amount||0),debit:amount(debit),refunded:amount(refunded),currency:currency.toUpperCase()});
  }
}

export async function refundBalance(c,sellerId,currency){
  const adjustments=(await c.query(`select a.*,coalesce(x.recovered,0) as recovered,coalesce(x.reserved,0) as reserved
    from seller_payout_refund_adjustments a left join lateral (
      select sum(case when p.status in ('paid','settled') then r.amount else 0 end) as recovered,
        sum(case when p.status not in ('paid','settled') then r.amount else 0 end) as reserved
      from seller_payout_refund_offsets r join seller_payouts p on p.id=r.payout_id
      where r.seller_id=a.seller_id and r.order_id=a.order_id
    ) x on true where a.seller_id=$1 and a.currency=$2 order by a.created_at,a.order_id`,[sellerId,currency.toUpperCase()])).rows;
  let debit=0,recovered=0,reserved=0;
  for(const a of adjustments){debit+=cents(a.debit_amount);recovered+=cents(a.recovered);reserved+=cents(a.reserved);}
  if(recovered+reserved>debit)throw new Error('Refund offsets exceed recorded adjustments.');
  return {currency:currency.toUpperCase(),totalDebits:amount(debit),recovered:amount(recovered),reserved:amount(reserved),outstanding:amount(debit-recovered),carryForward:amount(debit-recovered-reserved),adjustments:adjustments.map(a=>({orderId:a.order_id,sourcePayoutId:a.source_payout_id,debit:Number(a.debit_amount),refunded:Number(a.refunded_amount),recovered:Number(a.recovered),reserved:Number(a.reserved),remaining:amount(cents(a.debit_amount)-cents(a.recovered)-cents(a.reserved))}))};
}

// Allocate only the remaining debt. Other available/failed payouts keep their
// reservations so retries and overlapping periods cannot deduct it twice.
export async function reserveRefundOffsets(c,p,actor){
  if(['paid','settled'].includes(p.status))return p;
  const earnings=cents(p.gross_amount)-cents(p.commission_amount);
  if(earnings<0)throw new Error('Invalid payout earnings.');
  let capacity=earnings-cents(p.refund_amount),additional=0;
  const balance=await refundBalance(c,p.seller_id,String(p.currency).trim());
  for(const a of balance.adjustments){
    const take=Math.min(capacity,cents(a.remaining));if(!take)continue;
    await c.query(`insert into seller_payout_refund_offsets(payout_id,seller_id,order_id,amount)
      values($1,$2,$3,$4) on conflict(payout_id,order_id) do update
      set amount=seller_payout_refund_offsets.amount+excluded.amount`,[p.id,p.seller_id,a.orderId,amount(take)]);
    capacity-=take;additional+=take;
  }
  const deduction=cents(p.refund_amount)+additional,net=earnings-deduction;
  if(!additional)return p;
  const updated=(await c.query(`update seller_payouts set refund_amount=$2,net_amount=$3,
    status=case when $3::numeric=0 then 'settled' else status end,
    settled_at=case when $3::numeric=0 then now() else settled_at end where id=$1 returning *`,[p.id,amount(deduction),amount(net)])).rows[0];
  await payoutAudit(c,actor,'payout_refund_offset',p.id,{additional:amount(additional),deduction:amount(deduction),net:amount(net),status:updated.status});
  return updated;
}
