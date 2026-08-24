import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  const env=loadEnv(mode,process.cwd(),'');
  return {
  plugins: [react(),{
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
