export function mailConfig(env) {
  const port=Number(env.SMTP_PORT||587);
  return {host:env.SMTP_HOST,port,secure:port===465,requireTLS:String(env.SMTP_REQUIRE_TLS||'true')==='true',auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},pool:true,maxConnections:5,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,tls:{minVersion:'TLSv1.2'}};
}
