// Staging-only virtual-device proof. No production secrets or devices.
const encoder=new TextEncoder();
const validUuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||'');
const keyFor=secret=>crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const hex=buf=>Array.from(new Uint8Array(buf),b=>b.toString(16).padStart(2,'0')).join('');
export async function issueVirtualToken(secret,deviceId,ttl=120){
 if(!secret||!validUuid(deviceId)||ttl<1||ttl>120)throw Error('bad_virtual_token_request');
 const nonce=crypto.randomUUID();const expiry=Math.floor(Date.now()/1000)+ttl;
 const message=deviceId+':'+expiry+':'+nonce;
 const sig=hex(await crypto.subtle.sign('HMAC',await keyFor(secret),encoder.encode(message)));
 return message+':'+sig;
}
export async function verifyVirtualToken(secret,token,now=Math.floor(Date.now()/1000)){
 const parts=String(token||'').split(':');
 if(!secret||parts.length!==4||!validUuid(parts[0])||!validUuid(parts[2])||!/^[a-f0-9]{64}$/.test(parts[3]))return null;
 const expiry=Number(parts[1]);if(!Number.isSafeInteger(expiry)||expiry<=now||expiry>now+120)return null;
 const message=parts.slice(0,3).join(':');
 const ok=await crypto.subtle.verify('HMAC',await keyFor(secret),Uint8Array.from(parts[3].match(/../g).map(n=>parseInt(n,16))),encoder.encode(message));
 return ok?{deviceId:parts[0],nonce:parts[2],expiresAt:expiry}:null;
}
