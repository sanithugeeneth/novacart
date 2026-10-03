import crypto from 'node:crypto';
import {lockSellerLedger,reconcileRefunds,refundBalance,reserveRefundOffsets,payoutAudit} from './payout-refunds.js';

import {cents,payable} from './payout-math.js';
const amount=value=>value/100;
const reject=(message,status=409)=>Object.assign(new Error(message),{status});
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}

async function eligible(c,order,sellerId,currency){
  if(order.payment_status!=='paid'||!order.paid_at||!['paid','placed','processing','packed','shipped','delivered'].includes(order.status)||String(order.currency).trim().toUpperCase()!==currency.toUpperCase())return false;
  const row=(await c.query(`select
    exists(select 1 from refunds where order_id=$1 and status in ('pending','succeeded')) as refund,
    exists(select 1 from returns_requests where order_id=$1 and status in ('requested','approved','received','refunded')) as returned,
    exists(select 1 from seller_orders where order_id=$1 and seller_id=$2 and status in ('cancelled','refunded')) as cancelled`,[order.id,sellerId])).rows[0];
  return !row.refund&&!row.returned&&!row.cancelled;
}
function summary(p,duplicate=false){return {ok:true,payoutId:p.id,status:p.status,currency:String(p.currency).trim(),gross:Number(p.gross_amount),commission:Number(p.commission_amount),refundDeduction:Number(p.refund_amount),net:Number(p.net_amount),duplicate};}

export function registerPayouts({app,pool,sellerOnly,adminOnly,csrfOk,fail,ok,audit,currency}){
  async function checkSnapshot(c,p){
    const items=(await c.query('select * from seller_payout_items where payout_id=$1 order by order_id',[p.id])).rows;
    if(!items.length)throw reject('This payout has no verified order allocations.');
    let net=0,gross=0,commission=0;
    for(const item of items){
      const order=(await c.query('select * from orders where id=$1 for update',[item.order_id])).rows[0];
      if(!order||!await eligible(c,order,p.seller_id,p.currency))throw reject('Payment, refund or return status changed. Reconcile this payout before recording a transfer.');
      const now=await payable(c,order,p.seller_id);
      if(now.gross!==cents(item.gross_amount)||now.commission!==cents(item.commission_amount)||now.net!==cents(item.net_amount))throw reject('Payout amounts changed and need reconciliation.');
      net+=now.net;gross+=now.gross;commission+=now.commission;
    }
    const offsets=(await c.query('select coalesce(sum(amount),0) as amount from seller_payout_refund_offsets where payout_id=$1',[p.id])).rows[0];
    if(net!==cents(p.net_amount)+cents(p.refund_amount)||gross!==cents(p.gross_amount)||commission!==cents(p.commission_amount)||cents(offsets.amount)!==cents(p.refund_amount))throw reject('Payout totals do not match the order allocations.');
  }
  async function holdInvalidPayout(c,p,actor,reason){
    await c.query('delete from seller_payout_refund_offsets where payout_id=$1',[p.id]);
    const updated=(await c.query(`update seller_payouts set status='failed',refund_amount=0,
      net_amount=gross_amount-commission_amount,reconciliation_note=$2 where id=$1 returning *`,[p.id,reason])).rows[0];
    await payoutAudit(c,actor,'payout_refund_offsets_released',p.id,{released:Number(p.refund_amount),reason});
    return updated;
  }
  async function refreshLedger(c,sellerId,ledgerCurrency,actor){
    await reconcileRefunds(c,sellerId,ledgerCurrency,actor);
    // A later return/refund may invalidate earnings used by an unpaid payout.
    // Release its debt reservation so other valid earnings can still recover it.
    const reserved=(await c.query("select * from seller_payouts where seller_id=$1 and currency=$2 and ledger_version=1 and status not in ('paid','settled') and refund_amount>0 order by id",[sellerId,ledgerCurrency.toUpperCase()])).rows;
    for(const p of reserved){try{await checkSnapshot(c,p);}catch(e){if(e.status!==409)throw e;await holdInvalidPayout(c,p,actor,e.message);}}
  }
  app.post('/api/seller/payouts/reconcile',sellerOnly,async(req,res)=>{
    if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');
    const c=await pool.connect();
    try{
      await c.query('begin');await lockSellerLedger(c,req.seller.id);
      await refreshLedger(c,req.seller.id,currency,req.session.uid);
      const balance=await refundBalance(c,req.seller.id,currency);
      await c.query('commit');return ok(res,{ok:true,balance});
    }catch(e){await c.query('rollback').catch(()=>{});return fail(res,e.status||400,e.message);}finally{c.release();}
  });
  app.post('/api/admin/payouts/:id/reconcile',adminOnly,async(req,res)=>{
    if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');
    const c=await pool.connect();
    try{
      await c.query('begin');let p=(await c.query('select * from seller_payouts where id=$1',[req.params.id])).rows[0];
      if(!p)throw reject('Payout not found.',404);
      if(p.ledger_version!==1)throw reject('Historical payout totals require manual review.');
      await lockSellerLedger(c,p.seller_id);
      await refreshLedger(c,p.seller_id,String(p.currency).trim(),req.session.uid);
      p=(await c.query('select * from seller_payouts where id=$1 for update',[p.id])).rows[0];
      let needsReview=false;
      if(!['paid','settled'].includes(p.status)){
        try{await checkSnapshot(c,p);}catch(e){if(e.status!==409)throw e;p=await holdInvalidPayout(c,p,req.session.uid,e.message);needsReview=true;}
        if(!needsReview){await c.query("update seller_payouts set reconciliation_note='' where id=$1",[p.id]);p.reconciliation_note='';p=await reserveRefundOffsets(c,p,req.session.uid);}
      }
      const balance=await refundBalance(c,p.seller_id,String(p.currency).trim());
      await payoutAudit(c,req.session.uid,'payout_reconcile',p.id,{status:p.status,net:Number(p.net_amount),refundDeduction:Number(p.refund_amount),carryForward:balance.carryForward});
      await c.query('commit');return ok(res,{...summary(p),balance,needsReview,note:p.reconciliation_note});
    }catch(e){await c.query('rollback').catch(()=>{});return fail(res,e.status||400,e.message);}finally{c.release();}
  });
  app.post('/api/seller/payouts/generate',sellerOnly,async(req,res)=>{
    if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');
    const start=req.body?.periodStart||'2000-01-01',end=req.body?.periodEnd||new Date().toISOString().slice(0,10);
    if(!validDate(start)||!validDate(end)||start>end)return fail(res,400,'Enter valid payout dates in YYYY-MM-DD order.');
    const c=await pool.connect();
    try{
      await c.query('begin');
      await lockSellerLedger(c,req.seller.id);
      await refreshLedger(c,req.seller.id,currency,req.session.uid);
      const existing=await c.query('select * from seller_payouts where seller_id=$1 and period_start=$2 and period_end=$3 and ledger_version=1',[req.seller.id,start,end]);
      if(existing.rowCount){
        let p=existing.rows[0];
        if(!['paid','settled'].includes(p.status)){await checkSnapshot(c,p);p=await reserveRefundOffsets(c,p,req.session.uid);}
        const balance=await refundBalance(c,req.seller.id,currency);
        await c.query('commit');return ok(res,{...summary(p,true),balance});
      }
      const legacy=await c.query("select id from seller_payouts where seller_id=$1 and ledger_version=0 and status<>'failed' and period_start<=$3 and period_end>=$2 limit 1",[req.seller.id,start,end]);
      if(legacy.rowCount)throw reject('Historical payouts overlap this period and need reconciliation before new payouts can be generated.');
      const orders=(await c.query(`select o.* from orders o join seller_orders so on so.order_id=o.id
        where so.seller_id=$1 and (so.created_at at time zone 'UTC')::date between $2::date and $3::date
        and not exists(select 1 from seller_payout_items pi where pi.seller_id=$1 and pi.order_id=o.id)
        order by o.id for update of o`,[req.seller.id,start,end])).rows;
      const rows=[];
      for(const order of orders){if(await eligible(c,order,req.seller.id,currency)){const value=await payable(c,order,req.seller.id);if(value.net>0)rows.push({orderId:order.id,...value});}}
      if(!rows.length){
        const balance=await refundBalance(c,req.seller.id,currency);
        await c.query('commit');
        if(balance.outstanding>0)return ok(res,{ok:true,payoutId:null,status:'carried_forward',net:0,refundDeduction:0,balance,message:'No eligible earnings yet. The refund balance will be offset against future payouts.'});
        return fail(res,409,'No new paid orders are eligible for this period.');
      }
      const total=key=>amount(rows.reduce((sum,row)=>sum+row[key],0)),id=crypto.randomUUID();
      let p=(await c.query(`insert into seller_payouts(id,seller_id,period_start,period_end,gross_amount,commission_amount,net_amount,currency,status,ledger_version)
        values($1,$2,$3,$4,$5,$6,$7,$8,'available',1) returning *`,[id,req.seller.id,start,end,total('gross'),total('commission'),total('net'),currency.toUpperCase()])).rows[0];
      for(const row of rows)await c.query('insert into seller_payout_items(payout_id,seller_id,order_id,gross_amount,commission_amount,net_amount) values($1,$2,$3,$4,$5,$6)',[id,req.seller.id,row.orderId,amount(row.gross),amount(row.commission),amount(row.net)]);
      p=await reserveRefundOffsets(c,p,req.session.uid);
      const balance=await refundBalance(c,req.seller.id,currency);
      await payoutAudit(c,req.session.uid,'seller_payout_generate',id,{orders:rows.length,start,end,net:Number(p.net_amount),refundDeduction:Number(p.refund_amount)});
      await c.query('commit');return ok(res,{...summary(p),balance});
    }catch(e){await c.query('rollback').catch(()=>{});return fail(res,e.status||400,e.message||'Could not generate payout.');}finally{c.release();}
  });
  app.patch('/api/admin/payouts/:id',adminOnly,async(req,res)=>{
    if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');
    const status=req.body?.status,reference=String(req.body?.transferReference||'').trim();
    if(!['available','paid','failed'].includes(status))return fail(res,400,'Invalid payout status.');
    const c=await pool.connect();
    try{
      await c.query('begin');
      let p=(await c.query('select * from seller_payouts where id=$1',[req.params.id])).rows[0];
      if(!p)throw reject('Payout not found.',404);
      await lockSellerLedger(c,p.seller_id);
      p=(await c.query('select * from seller_payouts where id=$1 for update',[p.id])).rows[0];
      if(p.status==='paid'){
        if(status!=='paid')throw reject('Paid payouts cannot be reopened or failed.');
        await c.query('commit');return ok(res,summary(p,true));
      }
      if(p.status==='settled')throw reject('This payout was settled entirely by refund offsets and cannot be transferred or reopened.');
      if(p.ledger_version!==1&&status!=='failed')throw reject('Historical payout totals require review. Reject an incorrect unpaid record and generate a verified payout.');
      if(status!=='failed'){
        await refreshLedger(c,p.seller_id,String(p.currency).trim(),req.session.uid);
        p=(await c.query('select * from seller_payouts where id=$1',[p.id])).rows[0];
        await checkSnapshot(c,p);
        const balance=await refundBalance(c,p.seller_id,String(p.currency).trim());
        if(cents(p.net_amount)>0&&balance.carryForward>0)throw reject('New refund adjustments are waiting. Reconcile this payout and review its new net amount before recording a transfer.');
      }
      if(status==='paid'&&(reference.length<3||reference.length>180))throw reject('Enter the completed transfer reference (3–180 characters).',400);
      await c.query("update seller_payouts set status=$1,transfer_reference=case when $1='paid' then $2 else transfer_reference end,paid_at=case when $1='paid' then now() else null end where id=$3",[status,reference,p.id]);
      await payoutAudit(c,req.session.uid,'payout_status_update',p.id,{status,reference});
      await c.query('commit');return ok(res,{ok:true});
    }catch(e){await c.query('rollback').catch(()=>{});return fail(res,e.status||400,e.message||'Could not update payout.');}finally{c.release();}
  });
  app.post('/api/admin/orders/:id/confirm-cod',adminOnly,async(req,res)=>{
    if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');
    const reference=String(req.body?.receiptReference||'').trim();
    if(reference.length<3||reference.length>180)return fail(res,400,'Enter the collection receipt reference (3–180 characters).');
    const c=await pool.connect();
    try{
      await c.query('begin');const order=(await c.query('select * from orders where id=$1 for update',[req.params.id])).rows[0];
      if(!order)throw reject('Order not found.',404);
      if(order.payment_method!=='cod')throw reject('Only COD collections can be recorded here.');
      if(order.payment_status==='paid'){await c.query('commit');return ok(res,{ok:true,duplicate:true});}
      if(order.status!=='delivered'||order.payment_status!=='cod')throw reject('Confirm collection only for a delivered, unpaid COD order.');
      await c.query("update orders set payment_status='paid',paid_at=now(),payment_reference=$2,updated_at=now() where id=$1",[order.id,reference]);
      await c.query('commit');await audit(req.session.uid,'cod_collection_confirmed','order',order.id,{reference});return ok(res,{ok:true});
    }catch(e){await c.query('rollback').catch(()=>{});return fail(res,e.status||400,e.message);}finally{c.release();}
  });
}
