// Manual local verification only. Scheduling is defined in app/vercel.json.
if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET is required.');
const response=await fetch('http://127.0.0.1:3000/api/cron/collect',{
  headers:{authorization:`Bearer ${process.env.CRON_SECRET}`},signal:AbortSignal.timeout(280_000),
});
console.log({status:response.status,jobs:await response.json()});
