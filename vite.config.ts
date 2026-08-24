import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  const env=loadEnv(mode,process.cwd(),'');
  return {
  plugins: [react(),{
    name:'llm-gateway',
    configureServer(server){
      // Credentials live on the server only. The client posts here and never
      // sees a key, so the built bundle contains no secret material.
      const keys={gemini:env.GEMINI_API_KEY,groq:env.GROQ_API_KEY};
      server.middlewares.use('/api/llm/status',(_request,response)=>{
        response.setHeader('Content-Type','application/json');
        response.end(JSON.stringify({providers:Object.entries(keys).filter(([,key])=>Boolean(key)).map(([name])=>name)}));
      });
      server.middlewares.use('/api/llm',(request,response)=>{
        const json=(status:number,body:unknown)=>{response.statusCode=status;response.setHeader('Content-Type','application/json');response.end(JSON.stringify(body))};
        if(request.method!=='POST')return json(405,{error:'Method not allowed'});
        let raw='';request.on('data',chunk=>{raw+=chunk;if(raw.length>200000)request.destroy()});
        request.on('end',async()=>{
          try{
            const {provider,prompt,system,temperature}=JSON.parse(raw);
            const key=keys[provider as 'gemini'|'groq'];
            if(!key)return json(503,{error:`${provider} is not configured`});
            if(provider==='gemini'){
              const model='gemini-2.0-flash';
              const result=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({contents:[{parts:[{text:prompt}]}],systemInstruction:system?{parts:[{text:system}]}:undefined,generationConfig:{temperature:temperature??0.2}}),
              });
              if(!result.ok)return json(502,{error:`Gemini returned ${result.status}`});
              const data=await result.json();
              return json(200,{text:data.candidates?.[0]?.content?.parts?.[0]?.text??'',model});
            }
            const model='llama-3.3-70b-versatile';
            const result=await fetch('https://api.groq.com/openai/v1/chat/completions',{
              method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
              body:JSON.stringify({model,temperature:temperature??0.2,messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:prompt}]}),
            });
            if(!result.ok)return json(502,{error:`Groq returned ${result.status}`});
            const data=await result.json();
            return json(200,{text:data.choices?.[0]?.message?.content??'',model});
          }catch(error){return json(400,{error:error instanceof Error?error.message:'LLM request failed'})}
        });
      });
    },
  },{
    name:'slack-webhook-server',
    configureServer(server){server.middlewares.use('/api/slack',(request,response)=>{
      if(request.method!=='POST'){response.statusCode=405;response.end(JSON.stringify({error:'Method not allowed'}));return}
      if(!env.SLACK_WEBHOOK_URL){response.statusCode=503;response.setHeader('Content-Type','application/json');response.end(JSON.stringify({error:'Slack is not configured. Add SLACK_WEBHOOK_URL to .env.local.'}));return}
      let raw='';request.on('data',chunk=>{raw+=chunk;if(raw.length>20000)request.destroy()});request.on('end',async()=>{try{const payload=JSON.parse(raw);if(!payload.provider||!payload.npi||!Number.isFinite(payload.score))throw new Error('Invalid alert payload');const slack={text:`Tempus territory alert: ${payload.provider} moved into an actionable segment.`,blocks:[{type:'header',text:{type:'plain_text',text:'Priority provider signal'}},{type:'section',fields:[{type:'mrkdwn',text:`*Provider*\n${payload.provider}`},{type:'mrkdwn',text:`*Rank / score*\n#${payload.rank} · ${payload.score}/100`},{type:'mrkdwn',text:`*NPI*\n${payload.npi}`},{type:'mrkdwn',text:'*Evidence rule*\nTop 5 · score ≥70 · confidence ≥70'}]},{type:'section',text:{type:'mrkdwn',text:`*Recommended action*\n${payload.reason}`}},{type:'actions',elements:[{type:'button',text:{type:'plain_text',text:'Open public NPI record'},url:payload.profileUrl}]}]};const result=await fetch(env.SLACK_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(slack)});if(!result.ok)throw new Error(`Slack webhook returned ${result.status}`);response.statusCode=200;response.setHeader('Content-Type','application/json');response.end(JSON.stringify({ok:true}))}catch(error){response.statusCode=400;response.setHeader('Content-Type','application/json');response.end(JSON.stringify({error:error instanceof Error?error.message:'Slack request failed'}))}})
    })}
  }],
  server: {
    proxy: {
      '/api/npi': {
        target: 'https://npiregistry.cms.hhs.gov',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/npi/, '/api/'),
      },
    },
  },
}});
