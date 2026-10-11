const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function onRequestGet({env}){if(!env.VOV_MODEL_URL||!env.VOV_MODEL_KEY)return json({ready:false});try{const r=await fetch(env.VOV_MODEL_URL.replace(/\/$/,'')+'/health',{signal:AbortSignal.timeout(8000)});const d=await r.json();return json({ready:r.ok&&d.ready===true});}catch{return json({ready:false});}}
export async function onRequestPost({request,env}){
 if(new URL(request.url).origin!==request.headers.get('Origin'))return json({detail:'Request not allowed.'},403);
 if(!env.VOV_MODEL_URL||!env.VOV_MODEL_KEY)return json({detail:'Your assistant is being connected. Please try again later.'},503);
 const raw=await request.text();if(raw.length>52000)return json({detail:'Please start a new conversation.'},413);
 let body;try{body=JSON.parse(raw);}catch{return json({detail:'Invalid message.'},400);}
 if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>12||body.messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>4000))return json({detail:'Invalid conversation.'},400);
 try{const response=await fetch(env.VOV_MODEL_URL.replace(/\/$/,'')+'/chat',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.VOV_MODEL_KEY},body:JSON.stringify({messages:body.messages}),signal:AbortSignal.timeout(115000)});if(!response.ok)return json({detail:response.status===429?'Your assistant is busy. Please try again shortly.':'Your assistant is temporarily unavailable.'},response.status===429?429:503);const data=await response.json();if(typeof data.reply!=='string'||!data.reply.trim())throw Error('Empty reply');return json({reply:data.reply});}catch{return json({detail:'Your assistant could not connect. Please try again shortly.'},503);}
}
