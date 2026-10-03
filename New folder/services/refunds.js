import crypto from 'node:crypto';

export async function recordProviderRefund(client,order,refund,{requestId=null,actor=null,reason='Provider refund'}={}) {
  const intent=typeof refund.payment_intent==='object'?refund.payment_intent?.id:refund.payment_intent;
  if(intent!==order.payment_intent_id||String(refund.currency).toLowerCase()!==String(order.currency).trim().toLowerCase()||!Number.isInteger(refund.amount)||refund.amount<=0||!['pending','succeeded','failed','canceled','requires_action'].includes(refund.status))throw new Error('Refund details do not match the payment.');
  const localId=requestId||refund.metadata?.refund_request_id;
  if(localId){
    const row=(await client.query('select * from refunds where id::text=$1 and order_id=$2 for update',[localId,order.id])).rows[0];
    if(!row||Math.round(Number(row.amount)*100)!==refund.amount||(row.stripe_refund_id&&row.stripe_refund_id!==refund.id))throw new Error('Refund does not match the reserved request.');
    await client.query(`update refunds set stripe_refund_id=$2,status=case when $3='pending' and status in ('succeeded','failed','canceled') then status else $3 end,submission_state='recorded' where id=$1`,[row.id,refund.id,refund.status==='requires_action'?'pending':refund.status]);
  }else{
    await client.query(`insert into refunds(id,order_id,stripe_refund_id,amount,currency,status,reason,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(stripe_refund_id) do update set status=case when excluded.status='pending' and refunds.status in ('succeeded','failed','canceled') then refunds.status else excluded.status end,amount=excluded.amount,submission_state='recorded'`,[crypto.randomUUID(),order.id,refund.id,refund.amount/100,refund.currency.toUpperCase(),refund.status==='requires_action'?'pending':refund.status,reason,actor]);
  }
}

export function registerRefunds({app,pool,stripe,adminOnly,csrfOk,fail,ok,audit,queueMail,transitionOrder}) {
  app.post('/api/admin/orders/:id/refund',adminOnly,async(req,res)=>{
    if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');
    if(!stripe)return fail(res,503,'Stripe is not configured.');
    const key=req.get('idempotency-key');
    if(typeof key!=='string'||!/^[-A-Za-z0-9._:]{8,120}$/.test(key))return fail(res,400,'A valid Idempotency-Key is required for a refund.');
    const reason=String(req.body?.reason||'Admin refund').trim().slice(0,250);
    const raw=req.body?.amount;
    if(raw!=null&&!['number','string'].includes(typeof raw))return fail(res,400,'Invalid refund amount.');
    const amount=raw==null||raw===''?null:Number(raw);
    if(amount!==null&&(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)/100!==amount))return fail(res,400,'Refund amount must be positive with at most two decimal places.');
    const request={reason,...(amount===null?{}:{amount})};
    const hash=crypto.createHash('sha256').update(JSON.stringify({orderId:req.params.id,...request})).digest('hex');
    const client=await pool.connect();let order,record,reconcileOnly=false;
    try{
      await client.query('begin');
      order=(await client.query('select * from orders where id=$1 for update',[req.params.id])).rows[0];
      if(!order){await client.query('rollback');return fail(res,404,'Order not found.');}
      record=(await client.query('select * from refunds where request_key=$1 for update',[key])).rows[0];
      if(record&&record.request_hash!==hash){await client.query('rollback');return fail(res,409,'This refund key was already used with different details.');}
      if(record?.stripe_refund_id){await client.query('commit');return ok(res,{ok:true,duplicate:true,refundId:record.stripe_refund_id,status:record.status,amount:Number(record.amount)});}
      if(record?.submission_state==='sending'&&Date.now()-new Date(record.submitted_at).getTime()<120000){await client.query('rollback');return fail(res,409,'This refund request is already being processed. Retry the same request later.');}
      if(!record){
        if(!['paid','partially_refunded'].includes(order.payment_status)||!order.payment_intent_id){await client.query('rollback');return fail(res,400,'Only paid Stripe orders can be refunded.');}
        const busy=await client.query("select id from supplier_orders where order_id=$1 and status in ('submitting','unknown') limit 1",[order.id]);
        if(busy.rowCount){await client.query('rollback');return fail(res,409,'Verify the supplier fulfillment outcome before refunding this order.');}
        const sums=await client.query("select coalesce(sum(amount),0) as amount from refunds where order_id=$1 and status in ('pending','succeeded')",[order.id]);
        const remaining=Math.round(Number(order.total)*100)-Math.round(Number(sums.rows[0].amount)*100);
        const cents=amount===null?remaining:Math.round(amount*100);
        if(cents<=0||cents>remaining){await client.query('rollback');return fail(res,400,'Refund exceeds the remaining amount, including pending or unconfirmed refunds.');}
        record=(await client.query(`insert into refunds(id,order_id,amount,currency,status,reason,created_by,request_key,request_hash,request_payload,submission_state,submitted_at) values($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,'sending',now()) returning *`,[crypto.randomUUID(),order.id,cents/100,order.currency,reason,req.session.uid,key,hash,JSON.stringify(request)])).rows[0];
      }else{
        // Stripe may prune idempotency keys after 24 hours. Old unknown outcomes
        // are reconciled by metadata; they must never create another refund.
        reconcileOnly=Date.now()-new Date(record.created_at).getTime()>23*3600000;
        await client.query("update refunds set submission_state='sending',submitted_at=now() where id=$1",[record.id]);
      }
      await client.query('commit');
    }catch(error){await client.query('rollback').catch(()=>{});return fail(res,503,'Refund request could not be reserved.');}finally{client.release();}
    let refund;
    try{
      if(reconcileOnly){
        let after;
        do{
          const page=await stripe.refunds.list({payment_intent:order.payment_intent_id,limit:100,...(after?{starting_after:after}:{})});
          refund=page.data.find(r=>r.metadata?.refund_request_id===record.id);
          after=!refund&&page.has_more?page.data.at(-1)?.id:null;
        }while(after);
        if(!refund)throw new Error('Manual reconciliation required');
      }else refund=await stripe.refunds.create({payment_intent:order.payment_intent_id,amount:Math.round(Number(record.amount)*100),metadata:{order_id:order.id,reason:record.reason,refund_request_id:record.id}},{idempotencyKey:'novacart-refund:'+record.id});
      const c=await pool.connect();
      try{
        await c.query('begin');
        const latest=(await c.query('select * from orders where id=$1 for update',[order.id])).rows[0];
        await recordProviderRefund(c,latest,refund,{requestId:record.id});
        const sum=await c.query("select coalesce(sum(amount),0) as amount from refunds where order_id=$1 and status='succeeded'",[order.id]);
        const total=Math.round(Number(sum.rows[0].amount)*100),paid=Math.round(Number(latest.total)*100);
        const status=total>=paid?'refunded':total>0?'partially_refunded':'paid';
        if(status==='refunded'&&latest.status!=='refunded')await transitionOrder(c,order.id,'refunded',req.session.uid,'Full payment refunded');
        await c.query("update orders set payment_status=$2,refunded_at=case when $2='refunded' then coalesce(refunded_at,now()) else refunded_at end,updated_at=now() where id=$1",[order.id,status]);
        await c.query('commit');
      }catch(error){await c.query('rollback').catch(()=>{});throw error;}finally{c.release();}
    }catch(error){
      await pool.query("update refunds set submission_state='unknown' where id=$1 and stripe_refund_id is null",[record.id]).catch(()=>{});
      return fail(res,502,reconcileOnly?'Refund outcome needs reconciliation in Stripe. The amount remains reserved; no new refund was sent.':'Refund acceptance could not be confirmed. Retry this same request; its amount is reserved against duplicate refunds.',{retrySameRequest:true});
    }
    await audit(req.session.uid,'order_refund','order',order.id,{refundId:refund.id,amount:Number(record.amount),reason:record.reason});
    if(['pending','succeeded','requires_action'].includes(refund.status))await queueMail(order.customer_email,`NovaCart refund ${order.id}`,`<p>A refund request for ${Number(record.amount).toFixed(2)} ${String(order.currency).toUpperCase()} was submitted.</p>`,`Refund request submitted for order ${order.id}.`).catch(()=>{});
    return ok(res,{ok:true,refundId:refund.id,status:refund.status,amount:Number(record.amount)});
  });
}
